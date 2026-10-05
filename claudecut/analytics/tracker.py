"""
Anthropic Cost and Token Analytics Tracker.
Calculates real-world dollar spend, baseline costs (without optimization/routing),
and exact percentage saved.
"""

import sqlite3
import threading
from typing import Any, Dict, Optional
from datetime import datetime, timezone

PRICING_TABLE = {
    # Per million tokens: [input, output, cache_read, cache_write]
    "claude-3-7-sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_write": 3.75},
    "claude-3-5-sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_write": 3.75},
    "claude-3-5-haiku": {"input": 0.80, "output": 4.0, "cache_read": 0.08, "cache_write": 1.0},
    "claude-3-haiku": {"input": 0.25, "output": 1.25, "cache_read": 0.025, "cache_write": 0.30},
    "claude-3-opus": {"input": 15.0, "output": 75.0, "cache_read": 1.50, "cache_write": 18.75},
    "claude-opus-5": {"input": 10.0, "output": 50.0, "cache_read": 1.00, "cache_write": 12.50},
    "default": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_write": 3.75}
}

class CostTracker:
    def __init__(self, db_path: str = "claudecut_analytics.db"):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self._lock, sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT,
                    model TEXT,
                    requested_model TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    cache_read_tokens INTEGER,
                    cache_creation_tokens INTEGER,
                    baseline_cost_usd REAL,
                    actual_cost_usd REAL,
                    saved_usd REAL
                )
            """)
            conn.commit()

    def _get_model_pricing(self, model_name: str) -> Dict[str, float]:
        for key, rates in PRICING_TABLE.items():
            if key in model_name.lower():
                return rates
        return PRICING_TABLE["default"]

    def record_usage(self, model: str, usage: Dict[str, Any], requested_model: Optional[str] = None) -> Dict[str, Any]:
        """
        Processes Anthropic usage object:
        {
          "input_tokens": int,
          "output_tokens": int,
          "cache_read_input_tokens": int,
          "cache_creation_input_tokens": int
        }
        """
        req_model = requested_model or model
        req_rates = self._get_model_pricing(req_model)
        actual_rates = self._get_model_pricing(model)
        
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        cache_read = usage.get("cache_read_input_tokens", 0)
        cache_creation = usage.get("cache_creation_input_tokens", 0)

        # Baseline cost (what it would have cost if client used requested model with zero caching)
        total_input_tokens_if_uncached = input_tokens + cache_read + cache_creation
        baseline_cost = (
            (total_input_tokens_if_uncached * req_rates["input"] / 1_000_000.0) +
            (output_tokens * req_rates["output"] / 1_000_000.0)
        )

        # Actual cost with Anthropic ephemeral cache discounts and smart routing applied
        actual_cost = (
            (input_tokens * actual_rates["input"] / 1_000_000.0) +
            (output_tokens * actual_rates["output"] / 1_000_000.0) +
            (cache_read * actual_rates["cache_read"] / 1_000_000.0) +
            (cache_creation * actual_rates["cache_write"] / 1_000_000.0)
        )

        saved_usd = max(0.0, baseline_cost - actual_cost)

        with self._lock, sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT INTO requests (
                    timestamp, model, requested_model, input_tokens, output_tokens,
                    cache_read_tokens, cache_creation_tokens,
                    baseline_cost_usd, actual_cost_usd, saved_usd
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now(timezone.utc).isoformat(),
                model,
                req_model,
                input_tokens,
                output_tokens,
                cache_read,
                cache_creation,
                baseline_cost,
                actual_cost,
                saved_usd
            ))
            conn.commit()

        return {
            "baseline_cost": round(baseline_cost, 6),
            "actual_cost": round(actual_cost, 6),
            "saved_usd": round(saved_usd, 6),
            "savings_percent": round((saved_usd / baseline_cost * 100), 2) if baseline_cost > 0 else 0.0
        }

    def get_summary_stats(self) -> Dict[str, Any]:
        """Returns overall aggregated stats for the dashboard."""
        with self._lock, sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    COUNT(*),
                    SUM(input_tokens),
                    SUM(output_tokens),
                    SUM(cache_read_tokens),
                    SUM(cache_creation_tokens),
                    SUM(baseline_cost_usd),
                    SUM(actual_cost_usd),
                    SUM(saved_usd)
                FROM requests
            """)
            row = cursor.fetchone()

            # Breakdown by routed model tier
            cursor.execute("""
                SELECT model, COUNT(*)
                FROM requests
                GROUP BY model
            """)
            model_breakdown = dict(cursor.fetchall())

        total_reqs = row[0] or 0
        input_tokens = row[1] or 0
        output_tokens = row[2] or 0
        cache_read = row[3] or 0
        cache_creation = row[4] or 0
        baseline_cost = row[5] or 0.0
        actual_cost = row[6] or 0.0
        saved_usd = row[7] or 0.0

        savings_pct = (saved_usd / baseline_cost * 100.0) if baseline_cost > 0 else 0.0
        total_tokens = input_tokens + output_tokens + cache_read + cache_creation

        return {
            "total_requests": total_reqs,
            "total_tokens_processed": total_tokens,
            "cached_read_tokens": cache_read,
            "cache_hit_ratio": round((cache_read / max(1, input_tokens + cache_read)) * 100, 2),
            "baseline_cost_usd": round(baseline_cost, 4),
            "actual_cost_usd": round(actual_cost, 4),
            "total_saved_usd": round(saved_usd, 4),
            "savings_percent": round(savings_pct, 2),
            "model_breakdown": model_breakdown
        }
