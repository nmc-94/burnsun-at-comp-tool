"""Structured (JSON) logging.

Every record is emitted as one JSON object so container logs are uniformly
machine-parseable. Records at or below INFO go to stdout; WARNING and above go to
stderr, so a log processor can separate normal output from problems.
"""

from __future__ import annotations

import json
import logging
import logging.config
from datetime import UTC, datetime

# Attributes present on a bare LogRecord; anything else is a caller-supplied "extra".
_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"taskName"}


class JsonFormatter(logging.Formatter):
    """Render a record as a single-line JSON object, merging structured extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), default=str)


class MaxLevelFilter(logging.Filter):
    """Pass only records at or below ``max_level`` (lets stdout carry just <= INFO)."""

    def __init__(self, max_level: int) -> None:
        super().__init__()
        self.max_level = max_level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= self.max_level


def build_logging_config(level: str = "INFO") -> dict:
    level = level.upper()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"json": {"()": "comptool.logging_config.JsonFormatter"}},
        "filters": {
            "max_info": {
                "()": "comptool.logging_config.MaxLevelFilter",
                "max_level": logging.INFO,
            }
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "json",
                "filters": ["max_info"],
            },
            "stderr": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
                "formatter": "json",
                "level": "WARNING",
            },
        },
        "root": {"level": level, "handlers": ["stdout", "stderr"]},
        "loggers": {
            name: {"level": level, "handlers": ["stdout", "stderr"], "propagate": False}
            for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
        },
    }


def configure_logging(level: str = "INFO") -> None:
    logging.config.dictConfig(build_logging_config(level))
