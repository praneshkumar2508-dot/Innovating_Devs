"""Application configuration for the ResilienceOS Cascade Analyst."""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Settings loaded from environment / .env file."""

    # General
    resilience_env: str = "development"
    log_level: str = "INFO"
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Impact-score severity thresholds (configurable)
    impact_low_max: float = Field(0.24, ge=0, le=1)
    impact_moderate_max: float = Field(0.49, ge=0, le=1)
    impact_high_max: float = Field(0.74, ge=0, le=1)

    # Valid dependency types – extend by editing config, not code
    valid_dependency_types: list[str] = [
        "electricity",
        "water",
        "telecommunications",
        "transport",
        "fuel",
        "cooling",
        "data",
    ]

    # Maximum cascade iterations to prevent infinite loops
    max_cascade_iterations: int = 10_000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
