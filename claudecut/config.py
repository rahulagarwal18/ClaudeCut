import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    
    # Upstream Anthropic configuration
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com"
    ANTHROPIC_VERSION: str = "2023-06-01"
    
    # Optimization feature flags
    ENABLE_AUTO_PROMPT_CACHING: bool = True
    ENABLE_CONTEXT_PRUNING: bool = True
    ENABLE_RESPONSE_CACHE: bool = True
    
    # Prompt cache threshold (Anthropic requires >= 1024 tokens for caching)
    PROMPT_CACHE_MIN_TOKENS: int = 1024
    
    # Automatic Model Switching & Routing
    # Options: 'auto' (dynamic full tiering), 'conservative' (only downscales simple tasks to Haiku), 'disabled'
    ROUTING_MODE: str = "auto"
    LIGHT_TIER_MODEL: str = "claude-3-5-haiku-20241022"
    STANDARD_TIER_MODEL: str = "claude-3-7-sonnet-20250219"
    HEAVY_TIER_MODEL: str = "claude-3-opus-20240229"
    
    # Storage
    DATABASE_PATH: str = "claudecut_analytics.db"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
