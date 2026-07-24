"""Run the service: ``python -m comptool``.

Starts uvicorn with our JSON logging config so container logs stay uniform (rather
than uvicorn's default plain-text loggers).
"""

from __future__ import annotations

import uvicorn

from .logging_config import build_logging_config
from .settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "comptool.main:app",
        host="0.0.0.0",
        port=settings.port,
        log_config=build_logging_config(settings.log_level),
    )


if __name__ == "__main__":
    main()
