"""Ingestion: turning captured source data into a served, version-stamped ruleset.

This package is deliberately isolated from the request path. It reads files, resolves them
against ship-reference data, and produces the payload the client legality engine consumes —
so a scheduled sync job could later drive exactly the same code with no changes.
"""

from .errors import IngestError

__all__ = ["IngestError"]
