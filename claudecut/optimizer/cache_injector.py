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

def inject_prompt_cache(payload: Dict[str, Any], min_tokens_threshold: int = 1024) -> Dict[str, Any]:
    """
    Analyzes the incoming Anthropic Messages API payload and strategically
    places up to 4 ephemeral cache breakpoints:
    1. System prompt (if large or complex)
    2. The last tool definition (caching all preceding tool schemas)
    3. The 2nd-to-last user/assistant turn (caching conversation history)
    """
    optimized = copy.deepcopy(payload)
    breakpoints_used = 0
    max_breakpoints = 4

    # 1. System Prompt Caching
    if "system" in optimized and optimized["system"]:
        sys_data = optimized["system"]
        if isinstance(sys_data, str):
            if estimate_tokens(sys_data) >= 100:  # Mark large system prompts
                optimized["system"] = [
                    {
                        "type": "text",
                        "text": sys_data,
                        "cache_control": EPHEMERAL_CACHE
                    }
                ]
                breakpoints_used += 1
        elif isinstance(sys_data, list) and len(sys_data) > 0:
            # Add cache_control to the last element of the system array
            last_idx = len(sys_data) - 1
            if isinstance(sys_data[last_idx], dict) and "cache_control" not in sys_data[last_idx]:
                sys_data[last_idx]["cache_control"] = EPHEMERAL_CACHE
                breakpoints_used += 1

    # 2. Tools Schema Caching (Place breakpoint on the last tool)
    if breakpoints_used < max_breakpoints and "tools" in optimized and optimized["tools"]:
        tools = optimized["tools"]
        if isinstance(tools, list) and len(tools) > 0:
            last_tool = tools[-1]
            if isinstance(last_tool, dict) and "cache_control" not in last_tool:
                last_tool["cache_control"] = EPHEMERAL_CACHE
                breakpoints_used += 1

    # 3. Message History Caching (Cache earlier dialogue checkpoints)
    if breakpoints_used < max_breakpoints and "messages" in optimized and optimized["messages"]:
        messages: List[Dict[str, Any]] = optimized["messages"]
        n_msgs = len(messages)
        
        # If we have a multi-turn conversation, cache earlier message turns
        # Ideal checkpoint is the message right before the latest user turn
        if n_msgs >= 2:
            target_indices = []
            if n_msgs >= 4 and (max_breakpoints - breakpoints_used) >= 2:
                target_indices.append(n_msgs - 3)
            target_indices.append(n_msgs - 2)

            for idx in target_indices:
                if breakpoints_used >= max_breakpoints:
                    break
                msg = messages[idx]
                content = msg.get("content")
                
                if isinstance(content, str):
                    msg["content"] = [
                        {
                            "type": "text",
                            "text": content,
                            "cache_control": EPHEMERAL_CACHE
                        }
                    ]
                    breakpoints_used += 1
                elif isinstance(content, list) and len(content) > 0:
                    last_block = content[-1]
                    if isinstance(last_block, dict) and "cache_control" not in last_block:
                        last_block["cache_control"] = EPHEMERAL_CACHE
                        breakpoints_used += 1

    return optimized
