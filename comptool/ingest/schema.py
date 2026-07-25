"""The payload's shape, as the emitter sees it.

This mirrors the ``Ruleset`` type in ``web/src/engine/types.ts``. It is not a shared schema
— there is no codegen between the two — it is the ingester's own typed target, so assembly
mistakes surface here rather than in a browser. The actual guard against the two definitions
drifting apart is the Vitest case that loads an emitted payload and runs the engine over it.

Field names are snake_case in Python and serialize camelCase, because the client engine is
the payload's only consumer.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

HullSize = Literal[
    "Corvette",
    "Frigate",
    "Destroyer",
    "Cruiser",
    "Battlecruiser",
    "Battleship",
    "Industrial",
]
LogisticsGroup = Literal["cruiser", "frigate"]
BanSide = Literal["red", "blue"]


class _Payload(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class RulesetShip(_Payload):
    type_id: int
    name: str
    #: ``None`` means "fall back to the class value".
    points: int | None
    ship_class: str
    hull_size: HullSize
    inflation_value: int
    logistics_group: LogisticsGroup | None
    banned: bool
    flagship_eligible: bool


class LogisticsLimits(_Payload):
    cruiser: int
    frigate: int
    exclusive: bool


class Flagship(_Payload):
    allowed: bool
    battleship_allowance: int


class BanRound(_Payload):
    side: BanSide
    bans: int
    #: Whether the preliminary tournament plays this round.
    in_prelims: bool


class BanCaps(_Payload):
    #: Per side, per hull size. Logistics hulls are exempt and answer to ``logistics``.
    per_hull_size: int
    #: Per side, across both logistics groups.
    logistics: int


class BanPhase(_Payload):
    """§8's captain ban phase: who bans when, and how much of one kind a side may take out.

    Not to be confused with ``RulesetShip.banned``, which is the ruleset's own standing
    exclusion. A captain's ban is made at the table; this is only the shape of the procedure.
    """

    #: The rounds in order. Empty for a format with no ban phase.
    sequence: tuple[BanRound, ...]
    caps: BanCaps


class Ruleset(_Payload):
    version: str
    point_cap: int
    field_size: int
    ships: dict[int, RulesetShip]
    class_points: dict[str, int]
    hull_size_caps: dict[HullSize, int]
    logistics_limits: LogisticsLimits
    flagship: Flagship
    ban_phase: BanPhase
