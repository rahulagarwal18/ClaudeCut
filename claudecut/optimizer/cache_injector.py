"""
Prompt Cache Injector for Anthropic Claude.
Automatically places up to 4 'cache_control': {'type': 'ephemeral'} breakpoints
on system prompts, tools, and previous conversation turns so you get a 90% discount on cached reads.
"""

from typing import Any, Dict, List
import copy

EPHEMERAL_CACHE = {"type": "ephemeral"}

def estimate_tokens(text: str) -> int:
    """Rough estimation: ~4 chars per token."""
    if not text:
        return 0
    return len(text) // 4

def count_breakpoints(payload: Dict[str, Any]) -> int:
    """Count cache_control markers already present (top-level, system, tools, messages)."""
    n = 1 if payload.get("cache_control") else 0

    def visit(blocks):
        nonlocal n
        if not isinstance(blocks, list):
            return
        for b in blocks:
            if isinstance(b, dict):
                if b.get("cache_control"):
                    n += 1
                visit(b.get("content"))

    visit(payload.get("system"))
    visit(payload.get("tools"))
    for m in payload.get("messages") or []:
        if isinstance(m, dict):
            visit(m.get("content"))
    return n


def inject_prompt_cache(payload: Dict[str, Any], min_tokens_threshold: int = 1024) -> Dict[str, Any]:
    """
    Adds ephemeral cache breakpoints (the API allows at most 4 per request):
    1. The last tool definition (caches all tool schemas)
    2. The end of the system prompt
    3. The last block of the final user message (caches the conversation so far)

    If the client already set its own breakpoints (Claude Code does), the payload is
    returned unchanged: adding more would exceed the limit and the API returns a 400.
    Earlier messages are never modified, so the cached prefix stays byte-identical.
    """
    optimized = copy.deepcopy(payload)
    max_breakpoints = 4
    if count_breakpoints(optimized) > 0:
        return optimized
    used = 0

    tools = optimized.get("tools")
    if isinstance(tools, list) and tools and isinstance(tools[-1], dict):
        tools[-1]["cache_control"] = EPHEMERAL_CACHE
        used += 1

    sys_data = optimized.get("system")
    if isinstance(sys_data, str) and sys_data:
        optimized["system"] = [{"type": "text", "text": sys_data, "cache_control": EPHEMERAL_CACHE}]
        used += 1
    elif isinstance(sys_data, list) and sys_data and isinstance(sys_data[-1], dict):
        sys_data[-1]["cache_control"] = EPHEMERAL_CACHE
        used += 1

    messages: List[Dict[str, Any]] = optimized.get("messages") or []
    if used < max_breakpoints and messages and messages[-1].get("role") == "user":
        last = messages[-1]
        content = last.get("content")
        if isinstance(content, str) and content:
            last["content"] = [{"type": "text", "text": content, "cache_control": EPHEMERAL_CACHE}]
        elif isinstance(content, list):
            for block in reversed(content):
                if isinstance(block, dict) and block.get("type") in ("text", "image", "document", "tool_result", "tool_use"):
                    block["cache_control"] = EPHEMERAL_CACHE
                    break

    return optimized
