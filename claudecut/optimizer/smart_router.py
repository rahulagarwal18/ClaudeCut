"""
Dynamic Multi-Tier Task Classifier and Smart Auto-Model Selector for Claude.
Automatically routes requests to Haiku, Sonnet, or Opus depending on task complexity,
saving up to 90% on simple tasks while preserving maximum intelligence for hard engineering problems.
"""

from typing import Any, Dict, Tuple
import re

# Tier 1: Lightweight tasks suitable for Claude 3.5 Haiku (Fast & 80-95% cheaper)
LIGHTWEIGHT_PATTERNS = [
    r"\b(git\s+commit|commit\s+message)\b",
    r"\b(format|pretty\s*print|prettify)\b",
    r"\b(fix\s+(typo|spelling|grammar))\b",
    r"\b(translate|translation)\b",
    r"\b(regex|regular\s+expression)\b",
    r"\b(convert\s+to\s+(json|yaml|csv|xml|toml|sql))\b",
    r"\b(generate\s+(docstring|comment|type\s+hints?))\b",
    r"\b(bash|powershell|shell|cli\s+command\s+to)\b",
    r"\b(explain\s+briefly|quick\s+summary|one\s+sentence)\b",
    r"\b(status\s+code|http\s+error\s+\d{3})\b",
    r"\b(is\s+this\s+valid\s+(json|syntax))\b",
]

# Tier 3: Complex / Heavy tasks that benefit from Opus or Deep Reasoning
HEAVY_PATTERNS = [
    r"\b(system\s+architecture|architectural\s+design)\b",
    r"\b(security\s+(audit|vulnerability|exploit|penetration))\b",
    r"\b(race\s+condition|deadlock|multi-?threaded\s+concurrency)\b",
    r"\b(mathematical\s+proof|formal\s+verification|cryptograph(y|ic))\b",
    r"\b(distributed\s+consensus|raft|byzantine|sharding\s+strategy)\b",
    r"\b(deep\s+analysis|think\s+deeply|reason\s+step[- ]by[- ]step|prove\s+that)\b",
]

COMPILED_LIGHT = [re.compile(p, re.IGNORECASE) for p in LIGHTWEIGHT_PATTERNS]
COMPILED_HEAVY = [re.compile(p, re.IGNORECASE) for p in HEAVY_PATTERNS]


def extract_prompt_text(payload: Dict[str, Any]) -> str:
    """Extracts combined prompt text from messages and system prompt."""
    text_chunks = []
    
    # System prompt
    sys_content = payload.get("system", "")
    if isinstance(sys_content, str):
        text_chunks.append(sys_content)
    elif isinstance(sys_content, list):
        for b in sys_content:
            if isinstance(b, dict) and b.get("type") == "text":
                text_chunks.append(b.get("text", ""))

    # Last 2 messages
    messages = payload.get("messages", [])
    for msg in messages[-2:]:
        content = msg.get("content", "")
        if isinstance(content, str):
            text_chunks.append(content)
        elif isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "text":
                    text_chunks.append(b.get("text", ""))

    return " ".join(text_chunks)


def classify_task_complexity(payload: Dict[str, Any]) -> Tuple[str, str]:
    """
    Classifies task into:
    - 'light' (Haiku tier)
    - 'standard' (Sonnet tier)
    - 'heavy' (Opus / High Reasoning tier)
    Returns (tier, rationale)
    """
    text = extract_prompt_text(payload)
    text_len = len(text)
    tools = payload.get("tools", [])
    messages = payload.get("messages", [])

    # Check for Heavy / Deep Reasoning indicators first
    for pattern in COMPILED_HEAVY:
        if pattern.search(text):
            return "heavy", f"Matched complex reasoning pattern: '{pattern.pattern}'"

    # Check for Lightweight indicators
    # Conditions: no heavy tool calls, short-to-medium prompt, matches simple patterns
    if len(messages) <= 3 and len(tools) == 0 and text_len < 1200:
        for pattern in COMPILED_LIGHT:
            if pattern.search(text):
                return "light", f"Matched lightweight utility pattern: '{pattern.pattern}'"

    # Default to Standard (Sonnet) for regular coding, tools, refactoring, long context
    return "standard", "Standard engineering workload"


def route_model(
    payload: Dict[str, Any],
    light_model: str = "claude-3-5-haiku-20241022",
    standard_model: str = "claude-3-7-sonnet-20250219",
    heavy_model: str = "claude-3-opus-20240229",
    routing_mode: str = "auto",  # 'auto', 'conservative', 'disabled'
    force_override: bool = False
) -> Tuple[str, str]:
    """
    Returns (selected_model, rationale).
    """
    requested_model = payload.get("model", standard_model)

    if routing_mode == "disabled" or force_override:
        return requested_model, "Routing disabled / Forced model requested"

    tier, rationale = classify_task_complexity(payload)

    if routing_mode == "conservative":
        # Conservative mode only downgrades simple tasks to Haiku, never upgrades to Opus
        if tier == "light":
            return light_model, f"[Auto-Router: Light] {rationale} (Switched to {light_model})"
        return requested_model, f"[Auto-Router: Conservative] Retained requested {requested_model}"

    # Default 'auto' mode
    if tier == "light":
        return light_model, f"[Auto-Router: Light] {rationale} -> Routed to {light_model}"
    elif tier == "heavy" and "opus" not in requested_model.lower():
        return heavy_model, f"[Auto-Router: Heavy] {rationale} -> Upgraded to {heavy_model}"
    else:
        return standard_model, f"[Auto-Router: Standard] {rationale} -> Routed to {standard_model}"
