"""What the ATXXII points snapshot does not carry.

The spreadsheet gives point values and hull types; the rules article gives the budget, the
caps, the limits and the exclusions. This module is that second half — a small,
hand-maintained block of facts, each pointing at the section of ``docs/ruleset-atxxii.md``
it was read from.

It is deliberately per-ruleset-version and deliberately dumb data. A new tournament, or a
rules amendment, is a new block beside this one rather than an edit with a conditional in it.
"""

from __future__ import annotations

#: How this ruleset identifies itself, and who publishes it. The organizer is the body that
#: makes the rules, which is not the game's publisher.
SLUG = "atxxii"
NAME = "Alliance Tournament XXII"
ORGANIZER = "Fenris Creations"

#: The spreadsheet tab the points snapshot is exported from; ``docs/sources/README.md``
#: records each capture.
SOURCE_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1AVYlWlvuMKnA3yuqqDCcAkia8pvhpb9OBcM29WFw5rM/export?format=csv&gid=284772315"
)

#: §3 — up to 10 ships on the field, 200 points total.
POINT_CAP = 200
FIELD_SIZE = 10

#: §4.3 — at most three hulls of a size, except battleships, capped at two.
HULL_SIZE_CAPS = {
    "Corvette": 3,
    "Frigate": 3,
    "Destroyer": 3,
    "Cruiser": 3,
    "Battlecruiser": 3,
    "Battleship": 2,
    "Industrial": 3,
}

#: §4.4 — one logistics cruiser *or* two logistics frigates per match, never both.
LOGISTICS_LIMITS = {"cruiser": 1, "frigate": 2, "exclusive": True}

#: §7 — a flagship is allowed, and raises the battleship cap to three.
FLAGSHIP = {"allowed": True, "battleship_allowance": 3}

#: §7 — the one battleship the rules bar from flagship status. Every other pointed
#: battleship qualifies, the Praxis included: §5 permits that hull explicitly, and §7's
#: intent reads as "any battleship you may field, except this one".
FLAGSHIP_INELIGIBLE = frozenset({"Bhaalgorn"})

#: §4.3 — the snapshot's ``Hull Type`` is not quite the engine's hull size. Logistics is
#: expressed as a size in the data but as an exemption in the engine, so it maps to the size
#: the hull actually is, plus the allowance it draws from.
HULL_TYPES: dict[str, tuple[str, str | None]] = {
    "Corvette": ("Corvette", None),
    "Frigate": ("Frigate", None),
    "Destroyer": ("Destroyer", None),
    "Cruiser": ("Cruiser", None),
    "Battlecruiser": ("Battlecruiser", None),
    "Battleship": ("Battleship", None),
    "Industrial": ("Industrial", None),
    "Logistics": ("Cruiser", "cruiser"),
    "Logistics Frigate": ("Frigate", "frigate"),
}

#: The fallback table writes per-hull overrides as ``Name (Bucket)``, which is also how one
#: genuine bucket is written — except its parenthetical is a hull *size*, not a bucket. The
#: four racial corvettes fall back to it, so it has to survive as a bucket in its own right.
CLASS_ROW_ALIASES = {"Rookie Ship (Corvette)": "Rookie Ship"}

#: §8.2 — the previous-AT uniques. Each is individually priced and labelled with a bespoke
#: class of its own, so these are the only hulls whose fallback bucket does not exist. They
#: never need one; the label is carried through for display and asserted, not invented.
UNIQUE_CLASS_LABELS = frozenset(
    {
        "Assault Frigate Unique",
        "Battlecruiser, Unique",
        "Covert Ops Unique",
        "Destroyer, Unique",
        "Heavy Assault Cruiser Unique",
        "Recon Unique",
    }
)

#: §5 — hulls the article excludes by name. None of them appear in the points table, so
#: omission already bans every one; the list is kept as an assertion that this stays true,
#: not as payload. If a future snapshot lists one of these, the import stops.
EXCLUDED_HULLS = frozenset(
    {
        # Special editions the article enumerates.
        "Adrestia",
        "Apocalypse Imperial Issue",
        "Armageddon Imperial Issue",
        "Caedes",
        "Cambion",
        "Chameleon",
        "Chremoas",
        "Etana",
        "Fiend",
        "Freki",
        "Gold Magnate",
        "Guardian-Vexor",
        "Hydra",
        "Imp",
        "Laelaps",
        "Malice",
        "Megathron Federate Issue",
        "Mimir",
        "Moracha",
        "Python",
        "Rabisu",
        "Raiju",
        "Raven State Issue",
        "Silver Magnate",
        "Stratios Emergency Responder",
        "Tempest Tribal Issue",
        "Tiamat",
        "Utu",
        "Vangel",
        "Victor",
        "Virtuoso",
        "Whiptail",
        # Named separately as not allowed.
        "Enforcer",
        "Marshal",
        "Monitor",
        "Nestor",
        "Odysseus",
        "Pacifier",
        # Removed for this tournament.
        "Cenotaph",
        "Outrider",
        "Pioneer",
        "Pioneer Consortium Issue",
        "Venture Consortium Issue",
    }
)

#: §5 — the two blanket exclusions the static data states exactly, so neither needs listing
#: hull by hull: everything ORE builds, and every special edition (bar the four the article
#: names as exceptions, all of which are in the points table and therefore never checked
#: against this).
ORE_FACTION = "ORE"

#: §5 — anything larger than a battleship, plus the two groups nobody fields. Used only by
#: the audit that proves the points table still covers every hull the tool should offer.
OVERSIZED_HULL_GROUPS = frozenset(
    {
        "Capital Industrial Ship",
        "Carrier",
        "Command Carrier",
        "Dreadnought",
        "Flag Cruiser",
        "Force Auxiliary",
        "Freighter",
        "Jump Freighter",
        "Lancer Dreadnought",
        "Supercarrier",
        "Titan",
    }
)
UNFIELDABLE_HULL_GROUPS = frozenset({"Capsule", "Shuttle"})
