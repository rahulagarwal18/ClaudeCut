"""
Response Cache Module.
Provides in-memory and SQLite-backed exact matching cache for deterministic API calls.
"""

import hashlib
import json
import time
from typing import Any, Dict, Optional

class ResponseCache:
    def __init__(self, ttl_seconds: int = 3600):
        self.ttl = ttl_seconds
        self._memory_cache: Dict[str, Dict[str, Any]] = {}

    def _hash_payload(self, payload: Dict[str, Any]) -> str:
        """Computes deterministic sha256 hash for cacheable payloads."""
        # Only cache if temperature is 0 or not set/deterministic
        temp = payload.get("temperature", 1.0)
        if temp != 0:
            return ""
            
        key_data = {
            "model": payload.get("model"),
            "messages": payload.get("messages"),
            "system": payload.get("system"),
            "tools": payload.get("tools"),
        }
        raw_str = json.dumps(key_data, sort_keys=True)
        return hashlib.sha256(raw_str.encode("utf-8")).hexdigest()

    def get(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        cache_key = self._hash_payload(payload)
        if not cache_key:
            return None
            
        entry = self._memory_cache.get(cache_key)
        if not entry:
            return None
            
        if time.time() > entry["expires_at"]:
            del self._memory_cache[cache_key]
            return None
            
        return entry["response"]

    def set(self, payload: Dict[str, Any], response: Dict[str, Any]) -> None:
        cache_key = self._hash_payload(payload)
        if not cache_key:
            return
            
        self._memory_cache[cache_key] = {
            "response": response,
            "expires_at": time.time() + self.ttl
        }
