import pytest
from claudecut.optimizer.cache_injector import inject_prompt_cache
from claudecut.optimizer.context_pruner import prune_payload, minify_text
from claudecut.optimizer.smart_router import route_model
from claudecut.analytics.tracker import CostTracker
import os

def test_minify_text():
    raw = "def foo():\n\n\n\n    x = 1   \n    return x\n"
    minified = minify_text(raw)
    assert "\n\n\n\n" not in minified
    assert "x = 1   " not in minified
    assert "x = 1" in minified

def test_cache_injector_system_and_tools():
    payload = {
        "model": "claude-3-7-sonnet-20250219",
        "system": "You are a very helpful assistant with a large context prompt... " * 30,
        "tools": [
            {"name": "tool_a", "description": "Does A", "input_schema": {}},
            {"name": "tool_b", "description": "Does B", "input_schema": {}},
        ],
        "messages": [
            {"role": "user", "content": "Hello!"}
        ]
    }
    optimized = inject_prompt_cache(payload)
    
    # Check system prompt received ephemeral cache
    assert isinstance(optimized["system"], list)
    assert optimized["system"][0]["cache_control"] == {"type": "ephemeral"}
    
    # Check last tool received ephemeral cache
    assert optimized["tools"][-1]["cache_control"] == {"type": "ephemeral"}

def test_cost_tracker_calculation(tmp_path):
    db_file = str(tmp_path / "test_tracker.db")
    tracker = CostTracker(db_path=db_file)
    
    # Simulate a request where 50,000 tokens were read from cache and 500 generated
    usage = {
        "input_tokens": 1000,
        "output_tokens": 500,
        "cache_read_input_tokens": 50000,
        "cache_creation_input_tokens": 0
    }
    
    result = tracker.record_usage("claude-3-7-sonnet", usage)
    
    # Baseline: 51,000 input tokens * $3/M = $0.153 + 500 output * $15/M = $0.0075 -> total $0.1605
    # Actual: 1000 input * $3/M + 50000 cache read * $0.30/M + 500 output * $15/M -> $0.003 + $0.015 + $0.0075 = $0.0255
    # Savings: > 80%
    assert result["savings_percent"] > 70.0
    assert result["saved_usd"] > 0.10
    
    stats = tracker.get_summary_stats()
    assert stats["total_requests"] == 1
    assert stats["cached_read_tokens"] == 50000
