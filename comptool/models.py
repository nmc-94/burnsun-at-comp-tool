"""Database models (SQLAlchemy 2.0 typed ORM).

Phase A defines only ``app_meta`` — a tiny key/value table that lets the deploy spine
prove itself end to end (a real migration to apply, a real row for the migration drift
check to compare, and a real read/write for the health probe). The domain model
(teams, comps, rulesets, ...) arrives with the next phase.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AppMeta(Base):
    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
