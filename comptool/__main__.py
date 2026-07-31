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
        # Explicit, and load-bearing. ``uvicorn.Config`` reads ``WEB_CONCURRENCY`` *only*
        # when ``workers`` is ``None``, so passing nothing is not what makes one worker run
        # — it is what lets that variable decide. The live stream fans out in-process, so a
        # second worker stops delivering half the events with no log line; ``settings.py``
        # refuses the variable outright and this is what makes the refusal unnecessary.
        workers=1,
        log_config=build_logging_config(settings.log_level),
    )


if __name__ == "__main__":
    main()
