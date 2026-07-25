"""The app's slim ship-reference index, derived from the official EVE static data export.

The tournament ruleset names hulls; everything else in the app keys off EVE type ids. This
module bridges the two and does nothing else: it reads CCP's static data export and produces
a small, sorted document describing every published ship hull.

Two properties of that document exist for the ruleset ingester rather than for display.
``faction`` and ``special_edition`` are what let it recognize the two *classes* of hull the
tournament rules exclude wholesale — everything from ORE, and every special edition — so
those bans need no hand-maintained list.

The index is a build-time artifact, committed next to the point snapshot it is paired with.
The export it comes from is ~100 MB and versioned independently of this app, so extraction
is a maintainer command, not part of the import path; nothing here touches the network.

Keys are snake_case: the ingester reads this document, the browser never does.
"""

from __future__ import annotations

import json
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .errors import IngestError

# The export's own name for the category of things a comp can field.
SHIP_CATEGORY = "Ship"

# Market groups nest. A hull is a special edition when this group sits anywhere above it,
# which is how the export expresses a distinction the rules care about but types don't.
SPECIAL_EDITION_MARKET_GROUP = "Special Edition Ships"

# The export carries its own provenance, so neither a filename nor a network call is needed
# to say which build an index was cut from.
_PROVENANCE_MEMBER = "_sde.jsonl"

_DOWNLOAD_URL = (
    "https://developers.eveonline.com/static-data/tranquility/"
    "eve-online-static-data-{build}-jsonl.zip"
)


@dataclass(frozen=True, slots=True)
class ShipReference:
    """One published hull, as the app needs to know it."""

    type_id: int
    name: str
    group: str
    group_id: int
    #: The export's meta group — "Tech I", "Tech II", "Faction" and so on. Not every hull
    #: declares one.
    tech: str | None
    faction: str | None
    special_edition: bool


@dataclass(frozen=True, slots=True)
class ShipIndex:
    """Every published hull in one export, plus which export it was."""

    source: str
    sde_build: int
    sde_release_date: str
    hulls: tuple[ShipReference, ...]

    def by_name(self) -> dict[str, list[ShipReference]]:
        """Hulls grouped by name, so a duplicate name is visible rather than overwritten."""
        grouped: dict[str, list[ShipReference]] = {}
        for hull in self.hulls:
            grouped.setdefault(hull.name, []).append(hull)
        return grouped

    def resolve(self, names: Iterable[str]) -> dict[str, int]:
        """Map each name to its type id, refusing to guess.

        A name that matches no published hull, or more than one, fails the whole resolution
        — a ruleset that silently drops or mis-assigns a hull is not worth importing.
        """
        grouped = self.by_name()
        resolved: dict[str, int] = {}
        unknown: list[str] = []
        ambiguous: list[str] = []
        for name in names:
            matches = grouped.get(name, [])
            if not matches:
                unknown.append(name)
            elif len(matches) > 1:
                ambiguous.append(f"{name} ({', '.join(str(m.type_id) for m in matches)})")
            else:
                resolved[name] = matches[0].type_id
        if unknown or ambiguous:
            problems = []
            if unknown:
                problems.append(f"{len(unknown)} unresolved: {', '.join(sorted(unknown))}")
            if ambiguous:
                problems.append(f"{len(ambiguous)} ambiguous: {', '.join(sorted(ambiguous))}")
            raise IngestError(
                f"ship names could not be resolved against SDE build {self.sde_build} — "
                + "; ".join(problems)
            )
        return resolved

    def to_document(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "sde_build": self.sde_build,
            "sde_release_date": self.sde_release_date,
            "hulls": [asdict(hull) for hull in self.hulls],
        }


def from_document(document: dict[str, Any]) -> ShipIndex:
    try:
        hulls = tuple(ShipReference(**hull) for hull in document["hulls"])
        return ShipIndex(
            source=document["source"],
            sde_build=document["sde_build"],
            sde_release_date=document["sde_release_date"],
            hulls=hulls,
        )
    except (KeyError, TypeError) as exc:
        raise IngestError(f"ship index document is malformed: {exc}") from exc


def load(path: Path) -> ShipIndex:
    with path.open(encoding="utf-8") as handle:
        return from_document(json.load(handle))


def dump(index: ShipIndex) -> str:
    """Serialize deterministically, so re-running the extractor produces a reviewable diff."""
    return json.dumps(index.to_document(), indent=2, ensure_ascii=False) + "\n"


def _records(archive: zipfile.ZipFile, member: str) -> Iterator[dict[str, Any]]:
    try:
        handle = archive.open(member)
    except KeyError as exc:
        raise IngestError(f"{member} is missing from the SDE archive") from exc
    with handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _english(record: dict[str, Any]) -> str:
    """The export localizes every name; the app is English-only."""
    return record["name"]["en"]


def _special_edition_group_ids(archive: zipfile.ZipFile) -> set[int]:
    """Every market group at or below the special-edition root."""
    children: dict[int | None, list[int]] = {}
    root: int | None = None
    for record in _records(archive, "marketGroups.jsonl"):
        group_id = record["_key"]
        children.setdefault(record.get("parentGroupID"), []).append(group_id)
        if _english(record) == SPECIAL_EDITION_MARKET_GROUP:
            root = group_id
    if root is None:
        raise IngestError(
            f"no {SPECIAL_EDITION_MARKET_GROUP!r} market group in the SDE archive — "
            "the special-edition ban can no longer be derived"
        )

    descendants: set[int] = set()
    frontier = [root]
    while frontier:
        current = frontier.pop()
        if current in descendants:
            continue
        descendants.add(current)
        frontier.extend(children.get(current, []))
    return descendants


def build(sde_zip: Path) -> ShipIndex:
    """Extract the ship-reference index from a downloaded SDE archive."""
    with zipfile.ZipFile(sde_zip) as archive:
        provenance = next(_records(archive, _PROVENANCE_MEMBER), None)
        if provenance is None:
            raise IngestError(f"{_PROVENANCE_MEMBER} is empty; cannot identify the build")
        build_number = provenance["buildNumber"]

        ship_category_ids = {
            record["_key"]
            for record in _records(archive, "categories.jsonl")
            if _english(record) == SHIP_CATEGORY
        }
        if not ship_category_ids:
            raise IngestError(f"no {SHIP_CATEGORY!r} category in the SDE archive")

        groups = {
            record["_key"]: record
            for record in _records(archive, "groups.jsonl")
            if record.get("categoryID") in ship_category_ids
        }
        meta_groups = {r["_key"]: _english(r) for r in _records(archive, "metaGroups.jsonl")}
        factions = {r["_key"]: _english(r) for r in _records(archive, "factions.jsonl")}
        special_edition = _special_edition_group_ids(archive)

        hulls = [
            ShipReference(
                type_id=record["_key"],
                name=_english(record),
                group=_english(group),
                group_id=record["groupID"],
                tech=meta_groups.get(record.get("metaGroupID")),
                faction=factions.get(record.get("factionID")),
                special_edition=record.get("marketGroupID") in special_edition,
            )
            for record in _records(archive, "types.jsonl")
            if record.get("published") and (group := groups.get(record.get("groupID")))
        ]

    return ShipIndex(
        source=_DOWNLOAD_URL.format(build=build_number),
        sde_build=build_number,
        sde_release_date=provenance["releaseDate"],
        hulls=tuple(sorted(hulls, key=lambda hull: hull.type_id)),
    )
