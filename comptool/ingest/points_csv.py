"""Reading the captured points snapshot.

The snapshot is a CSV export of a spreadsheet tab holding *two* tables side by side: a
class/faction fallback table in columns A–C, a blank separator in D–E, and the fully
resolved per-ship table in F–J. Row 0 is blank and row 1 is the header, so data starts at
row 2.

This module only reads the file. It knows nothing about hull sizes, buckets or point
resolution — those are the ruleset's business, not the CSV's — which keeps the shape of the
source decoupled from the shape of the payload.

The blank separator is checked rather than assumed: if the sheet ever gains a column there,
every field after it shifts, and reading the wrong column silently is exactly the failure
this ingester exists to prevent.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .errors import IngestError

#: The header the two-table layout produces, blank separator included.
HEADER = (
    "Ship Class",
    "Points",
    "Hull Size",
    "",
    "",
    "Ship Name",
    "Ship Class",
    "Points",
    "Hull Type",
    "Inflation Value",
)

_COLUMNS = len(HEADER)
_SEPARATOR = (3, 4)
_FIRST_DATA_ROW = 2


@dataclass(frozen=True, slots=True)
class ClassRow:
    """One row of the fallback table: a bucket, or a per-hull override written as one."""

    ship_class: str
    points: int
    hull_size: str


@dataclass(frozen=True, slots=True)
class ShipRow:
    """One fully resolved hull from the per-ship table."""

    name: str
    ship_class: str
    points: int
    hull_type: str
    inflation_value: int


@dataclass(frozen=True, slots=True)
class PointsSnapshot:
    class_rows: tuple[ClassRow, ...]
    ship_rows: tuple[ShipRow, ...]


def _int(value: str, field: str, where: str) -> int:
    try:
        return int(value.strip())
    except ValueError as exc:
        raise IngestError(f"{where}: {field} is not a whole number ({value!r})") from exc


def parse(path: Path) -> PointsSnapshot:
    """Split the snapshot into its two tables, normalizing whitespace in names."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = [(row + [""] * _COLUMNS)[:_COLUMNS] for row in csv.reader(handle)]

    if len(rows) <= _FIRST_DATA_ROW:
        raise IngestError(f"{path.name}: no data rows")
    if any(cell.strip() for cell in rows[0]):
        raise IngestError(f"{path.name}: expected a blank first row, got {rows[0]}")
    header = tuple(cell.strip() for cell in rows[1])
    if header != HEADER:
        raise IngestError(f"{path.name}: unexpected header {header}")

    class_rows: list[ClassRow] = []
    ship_rows: list[ShipRow] = []
    for number, row in enumerate(rows[_FIRST_DATA_ROW:], start=_FIRST_DATA_ROW + 1):
        where = f"{path.name} row {number}"
        if any(row[column].strip() for column in _SEPARATOR):
            raise IngestError(f"{where}: the D–E separator is not blank; columns have shifted")

        if row[0].strip():
            class_rows.append(
                ClassRow(
                    ship_class=row[0].strip(),
                    points=_int(row[1], "Points", where),
                    hull_size=row[2].strip(),
                )
            )
        if row[5].strip():
            ship_rows.append(
                ShipRow(
                    name=row[5].strip(),
                    ship_class=row[6].strip(),
                    points=_int(row[7], "Points", where),
                    hull_type=row[8].strip(),
                    inflation_value=_int(row[9], "Inflation Value", where),
                )
            )

    if not class_rows or not ship_rows:
        raise IngestError(f"{path.name}: one of the two tables is empty")
    return PointsSnapshot(class_rows=tuple(class_rows), ship_rows=tuple(ship_rows))
