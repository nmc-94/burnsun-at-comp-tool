"""The one error ingestion raises.

Ingestion has a single failure stance: a snapshot that cannot be resolved exactly is not
imported at all. Every check raises this rather than dropping a row, defaulting a value, or
warning and continuing — a silently wrong ruleset is worse than no ruleset.
"""

from __future__ import annotations


class IngestError(RuntimeError):
    """A source snapshot could not be read, resolved, or validated."""
