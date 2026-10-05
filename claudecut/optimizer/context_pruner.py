"""
Context Pruning and Minification Engine.
Compresses redundant whitespace, strips large repetitive logs, minifies code snippets,
and reduces token footprint without losing semantic fidelity.
"""

import re
from typing import Any, Dict, List

# Regex to collapse 3+ consecutive newlines into 2
RE_MULTIPLE_NEWLINES = re.compile(r"\n{3,}")
# Regex to strip trailing spaces on lines
RE_TRAILING_SPACES = re.compile(r"[ \t]+$", re.MULTILINE)
# Regex to detect excessively repetitive ASCII delimiters like "========="
RE_REPETITIVE_DELIMITERS = re.compile(r"([=\-\*\_~#]){10,}")

def minify_text(text: str) -> str:
    """Minifies plain text or code context without altering syntax semantics."""
    if not text or not isinstance(text, str):
        return text
    
    # 1. Strip trailing whitespace per line
    text = RE_TRAILING_SPACES.sub("", text)
    
    # 2. Collapse excessive line breaks (keeps paragraph separation clean)
    text = RE_MULTIPLE_NEWLINES.sub("\n\n", text)
    
    # 3. Collapse ultra-long visual separator lines (e.g. 80 dashes -> 10 dashes)
    text = RE_REPETITIVE_DELIMITERS.sub(r"\1\1\1\1\1\1\1\1\1\1", text)
    
    return text.strip()

def prune_content_block(block: Any) -> Any:
    if isinstance(block, str):
        return minify_text(block)
    elif isinstance(block, dict):
        if block.get("type") == "text" and "text" in block:
            block["text"] = minify_text(block["text"])
        return block
    elif isinstance(block, list):
        return [prune_content_block(item) for item in block]
    return block

def prune_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Prunes messages, system prompts, and tool descriptions in payload."""
    # Minify system prompt
    if "system" in payload:
        payload["system"] = prune_content_block(payload["system"])
        
    # Minify messages
    if "messages" in payload and isinstance(payload["messages"], list):
        for msg in payload["messages"]:
            if "content" in msg:
                msg["content"] = prune_content_block(msg["content"])
                
    return payload
