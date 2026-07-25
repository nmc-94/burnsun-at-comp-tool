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


class Ruleset(_Payload):
    version: str
    point_cap: int
    field_size: int
    ships: dict[int, RulesetShip]
    class_points: dict[str, int]
    hull_size_caps: dict[HullSize, int]
    logistics_limits: LogisticsLimits
    flagship: Flagship
