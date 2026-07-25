"""Turning a points snapshot into the payload the legality engine consumes.

The snapshot is not the ruleset. Two things happen here that the CSV cannot express on its
own, and both are the point of this module:

**The fallback layer is only the generic buckets.** The class table mixes real buckets
(``Battleship`` = 40) with per-hull overrides written as class rows (``Megathron
(Battleship)`` = 39), and the per-ship table mostly repeats the *override* string. Copying
those through would give every hull a bucket of its own, and the fallback layer could never
differ from the individual value — inert, and quietly so. So a class string is normalized to
the bucket it falls back to, and only genuine buckets reach ``classPoints``.

**Exclusion is by omission.** The article's ban list needs no ingestion: none of the hulls it
names are in the points table, so a hull absent from the payload resolves to nothing and the
engine refuses it. ``banned`` therefore stays false throughout, and the ban list survives
here only as an assertion that this remains true.

Inflation values are read straight from the row. They are not derived from hull size, ever —
the snapshot carries deliberate per-hull exceptions and the rule is the data, not the table
in the article.
"""

from __future__ import annotations

from . import atxxii
from .errors import IngestError
from .points_csv import PointsSnapshot, ShipRow
from .schema import Flagship, LogisticsLimits, Ruleset, RulesetShip
from .sde import ShipIndex, ShipReference


def _is_generic(ship_class: str) -> bool:
    """Whether a class-table row states a bucket rather than a single hull's override."""
    return ship_class in atxxii.CLASS_ROW_ALIASES or "(" not in ship_class


def _bucket(ship_class: str) -> str:
    """The bucket a class string names: its parenthetical, or the whole string."""
    alias = atxxii.CLASS_ROW_ALIASES.get(ship_class)
    if alias is not None:
        return alias
    if ship_class.endswith(")") and "(" in ship_class:
        return ship_class[ship_class.rindex("(") + 1 : -1].strip()
    return ship_class


def _class_points(snapshot: PointsSnapshot) -> dict[str, int]:
    points: dict[str, int] = {}
    for row in snapshot.class_rows:
        if not _is_generic(row.ship_class):
            continue
        bucket = _bucket(row.ship_class)
        previous = points.get(bucket)
        if previous is not None and previous != row.points:
            raise IngestError(
                f"class bucket {bucket!r} is listed twice with different values "
                f"({previous} and {row.points})"
            )
        points[bucket] = row.points
    return points


def _ship(row: ShipRow, type_id: int) -> RulesetShip:
    hull = atxxii.HULL_TYPES.get(row.hull_type)
    if hull is None:
        raise IngestError(f"{row.name}: unknown Hull Type {row.hull_type!r}")
    hull_size, logistics_group = hull
    return RulesetShip(
        type_id=type_id,
        name=row.name,
        points=row.points,
        ship_class=_bucket(row.ship_class),
        hull_size=hull_size,
        inflation_value=row.inflation_value,
        logistics_group=logistics_group,
        banned=False,
        flagship_eligible=(
            hull_size == "Battleship" and row.name not in atxxii.FLAGSHIP_INELIGIBLE
        ),
    )


def _check_fallback(ship: RulesetShip, class_points: dict[str, int]) -> None:
    """Every hull must be priceable: individually, or through a bucket that exists."""
    if ship.ship_class in class_points:
        return
    if ship.ship_class not in atxxii.UNIQUE_CLASS_LABELS:
        raise IngestError(
            f"{ship.name}: class {ship.ship_class!r} is neither a bucket in the class table "
            "nor a known unique"
        )
    if ship.points is None:
        raise IngestError(f"{ship.name}: no individual value and no bucket to fall back to")


def _check_not_excluded(ships: dict[int, RulesetShip]) -> None:
    listed = sorted(ship.name for ship in ships.values() if ship.name in atxxii.EXCLUDED_HULLS)
    if listed:
        raise IngestError(
            "the points table now prices hulls the rules exclude by name, so omission no "
            f"longer bans them: {', '.join(listed)}"
        )


def build(snapshot: PointsSnapshot, index: ShipIndex, version: str) -> dict:
    """Assemble and validate the payload for one ruleset version."""
    class_points = _class_points(snapshot)
    type_ids = index.resolve(row.name for row in snapshot.ship_rows)

    ships: dict[int, RulesetShip] = {}
    for row in snapshot.ship_rows:
        ship = _ship(row, type_ids[row.name])
        _check_fallback(ship, class_points)
        if ship.type_id in ships:
            raise IngestError(f"{ship.name} and {ships[ship.type_id].name} share a type id")
        ships[ship.type_id] = ship
    _check_not_excluded(ships)

    ruleset = Ruleset(
        version=version,
        point_cap=atxxii.POINT_CAP,
        field_size=atxxii.FIELD_SIZE,
        ships=ships,
        class_points=class_points,
        hull_size_caps=atxxii.HULL_SIZE_CAPS,
        logistics_limits=LogisticsLimits(**atxxii.LOGISTICS_LIMITS),
        flagship=Flagship(**atxxii.FLAGSHIP),
    )
    return ruleset.model_dump(mode="json", by_alias=True)


def omitted_legal_hulls(payload: dict, index: ShipIndex) -> tuple[ShipReference, ...]:
    """Hulls the tool will not offer that the rules would nonetheless price.

    The payload offers exactly the hulls the points table names individually. Everything
    else is either banned — by size, by builder, by being a special edition, or by name —
    or is a hull the class layer alone would price. This reports that last set.

    It is not empty: the nine Tech 2 industrials (four blockade runners, five deep space
    transports) fall through the ``Tech 2 Industrial Ships`` bucket, and the decision is to
    leave them out, since the tool offers only what the snapshot lists. Keeping the audit
    means that decision stays a decision — if a snapshot or a static-data build ever changes
    which hulls land here, it is visible rather than assumed.
    """
    offered = {ship["name"] for ship in payload["ships"].values()}
    banned_groups = atxxii.OVERSIZED_HULL_GROUPS | atxxii.UNFIELDABLE_HULL_GROUPS
    return tuple(
        hull
        for hull in index.hulls
        if hull.name not in offered
        and hull.group not in banned_groups
        and hull.faction != atxxii.ORE_FACTION
        and not hull.special_edition
        and hull.name not in atxxii.EXCLUDED_HULLS
    )
