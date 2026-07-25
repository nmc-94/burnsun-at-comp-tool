"""Reading the captured points snapshot.

Two kinds of test: what the committed snapshot actually contains — measured once so later
changes to it are visible — and what the reader refuses. The second kind matters more. The
file is a spreadsheet export, and a spreadsheet can gain a column without anyone noticing.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from comptool.ingest import points_csv
from comptool.ingest.errors import IngestError

BLANK = ",,,,,,,,,"
HEADER = "Ship Class,Points,Hull Size,,,Ship Name,Ship Class,Points,Hull Type,Inflation Value"
A_SHIP = ",,,,,Rifter,Frigate,4,Frigate,0"


def write(tmp_path: Path, *lines: str) -> Path:
    path = tmp_path / "points-2026-01-01.csv"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_splits_the_two_tables(snapshot):
    assert len(snapshot.class_rows) == 156
    assert len(snapshot.ship_rows) == 278


def test_normalizes_names_that_carry_stray_whitespace(snapshot):
    names = [row.name for row in snapshot.ship_rows]
    assert "Shapash" in names
    assert "Corax Navy Issue" in names
    assert not [name for name in names if name != name.strip()]


def test_every_hull_is_priced(snapshot):
    points = [row.points for row in snapshot.ship_rows]
    assert min(points) == 1
    assert max(points) == 53


def test_reads_inflation_per_ship_rather_than_per_hull_size(snapshot):
    by_name = {row.name: row for row in snapshot.ship_rows}
    # The one hull whose inflation disagrees with its hull size, and its near-twin, which
    # does not. Any rule derived from hull size would flatten the pair.
    assert by_name["Geri"].inflation_value == 3
    assert by_name["Geri"].hull_type == "Frigate"
    assert by_name["Shapash"].inflation_value == 0


def test_keeps_the_class_table_verbatim(snapshot):
    by_class = {row.ship_class: row for row in snapshot.class_rows}
    assert by_class["Battleship"].points == 40
    # An override written as a class row, which the fallback layer must not absorb.
    assert by_class["Megathron (Battleship)"].points == 39


def test_rejects_a_shifted_separator(tmp_path):
    shifted = ",,,Total,,Rifter,Frigate,4,Frigate,0"
    with pytest.raises(IngestError, match="columns have shifted"):
        points_csv.parse(write(tmp_path, BLANK, HEADER, shifted))


def test_rejects_an_unexpected_header(tmp_path):
    renamed = HEADER.replace("Inflation Value", "Inflation")
    with pytest.raises(IngestError, match="unexpected header"):
        points_csv.parse(write(tmp_path, BLANK, renamed, A_SHIP))


def test_rejects_a_point_value_that_is_not_a_number(tmp_path):
    unpriced = ",,,,,Rifter,Frigate,TBD,Frigate,0"
    with pytest.raises(IngestError, match="Points is not a whole number"):
        points_csv.parse(write(tmp_path, BLANK, HEADER, unpriced))


def test_rejects_a_file_whose_layout_has_lost_a_table(tmp_path):
    class_only = "Frigate,4,Frigate,,,,,,,"
    with pytest.raises(IngestError, match="one of the two tables is empty"):
        points_csv.parse(write(tmp_path, BLANK, HEADER, class_only))
