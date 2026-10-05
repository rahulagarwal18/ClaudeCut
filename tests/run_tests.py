import unittest
import os
import shutil
import tempfile
from claudecut.optimizer.cache_injector import inject_prompt_cache
from claudecut.optimizer.context_pruner import prune_payload, minify_text
from claudecut.optimizer.smart_router import route_model, classify_task_complexity
from claudecut.analytics.tracker import CostTracker

class TestClaudeCutOptimizer(unittest.TestCase):
    def test_minify_text(self):
        raw = "def foo():\n\n\n\n    x = 1   \n    return x\n"
        minified = minify_text(raw)
        self.assertNotIn("\n\n\n\n", minified)
        self.assertNotIn("x = 1   ", minified)
        self.assertIn("x = 1", minified)

    def test_cache_injector_system_and_tools(self):
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
        self.assertIsInstance(optimized["system"], list)
        self.assertEqual(optimized["system"][0]["cache_control"], {"type": "ephemeral"})
        
        # Check last tool received ephemeral cache
        self.assertEqual(optimized["tools"][-1]["cache_control"], {"type": "ephemeral"})

    def test_dynamic_model_routing(self):
        # 1. Lightweight task -> Routes to Haiku
        light_payload = {
            "model": "claude-3-7-sonnet-20250219",
            "messages": [{"role": "user", "content": "generate a git commit message for adding auth"}]
        }
        tier, _ = classify_task_complexity(light_payload)
        self.assertEqual(tier, "light")
        model, _ = route_model(light_payload, routing_mode="auto")
        self.assertIn("haiku", model)

        # 2. Heavy / Complex reasoning task -> Routes to Opus
        heavy_payload = {
            "model": "claude-3-7-sonnet-20250219",
            "messages": [{"role": "user", "content": "Perform a deep security audit and mathematical proof of this distributed consensus protocol"}]
        }
        tier, _ = classify_task_complexity(heavy_payload)
        self.assertEqual(tier, "heavy")
        model, _ = route_model(heavy_payload, routing_mode="auto")
        self.assertIn("opus", model)

        # 3. Standard coding task with tools -> Retains Sonnet
        standard_payload = {
            "model": "claude-3-7-sonnet-20250219",
            "tools": [{"name": "read_file", "description": "reads file", "input_schema": {}}],
            "messages": [{"role": "user", "content": "Refactor the authentication handler to use JWT tokens"}]
        }
        tier, _ = classify_task_complexity(standard_payload)
        self.assertEqual(tier, "standard")
        model, _ = route_model(standard_payload, routing_mode="auto")
        self.assertIn("sonnet", model)

    def test_cost_tracker_calculation(self):
        tmp_dir = tempfile.mkdtemp()
        db_file = os.path.join(tmp_dir, "test_tracker.db")
        try:
            tracker = CostTracker(db_path=db_file)
            usage = {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_read_input_tokens": 50000,
                "cache_creation_input_tokens": 0
            }
            result = tracker.record_usage("claude-3-7-sonnet", usage, requested_model="claude-3-7-sonnet")
            self.assertGreater(result["savings_percent"], 70.0)
            self.assertGreater(result["saved_usd"], 0.10)
            
            stats = tracker.get_summary_stats()
            self.assertEqual(stats["total_requests"], 1)
            self.assertEqual(stats["cached_read_tokens"], 50000)
            self.assertIn("claude-3-7-sonnet", stats["model_breakdown"])
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == "__main__":
    unittest.main()
