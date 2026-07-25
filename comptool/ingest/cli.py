"""The ingestion command: ``python -m comptool.ingest``.

Ingesting a ruleset is a maintenance action, not a request, so it lives here rather than
behind an HTTP route — no authentication surface to get wrong, runnable in a container, and
importable by tests.

Two ways in, for two different audiences. ``import-points`` reads the captured snapshots
that live beside the repo's documentation, and is how a maintainer publishes a new capture;
its sources are arguments rather than baked-in paths, and are not shipped in the image.
``seed`` publishes the payload that *is* shipped, under ``comptool/data/`` — because the
tournament's rules are codified, and a deployment should arrive with them rather than wait
for someone to supply them. The bundled payload is this command's own output, committed and
pinned by a test against the sources, so the two cannot disagree.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import atxxii, points_csv, ruleset, sde
from .errors import IngestError

_CAPTURE_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _capture_date(path: Path) -> str:
    """The day a snapshot was taken, which is also the version it publishes under."""
    match = _CAPTURE_DATE.search(path.name)
    if match is None:
        raise IngestError(
            f"{path.name}: no capture date in the filename; pass --version-label explicitly"
        )
    return match.group()


def _write(text: str, out: Path | None) -> None:
    if out is None:
        sys.stdout.write(text)
        return
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out}", file=sys.stderr)


def _build_ship_index(args: argparse.Namespace) -> None:
    index = sde.build(args.sde_zip)
    _write(sde.dump(index), args.out)
    print(
        f"{len(index.hulls)} published hulls from static data build {index.sde_build} "
        f"({index.sde_release_date})",
        file=sys.stderr,
    )


def _payload(args: argparse.Namespace) -> tuple[dict, str]:
    snapshot = points_csv.parse(args.csv)
    index = sde.load(args.ships)
    version = args.version_label or _capture_date(args.csv)
    return ruleset.build(snapshot, index, version), version


def _emit_payload(args: argparse.Namespace) -> None:
    payload, version = _payload(args)
    _write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", args.out)
    print(f"{version}: {len(payload['ships'])} ships", file=sys.stderr)


def _open_session():
    """A database session for a command.

    Imported here, not at module scope: building a payload needs neither a database nor
    app settings, and emit-payload should stay runnable without either.
    """
    from ..db import get_session, init_db
    from ..settings import get_settings

    init_db(get_settings())
    sessions = get_session()
    return sessions, next(sessions)


def _import_points(args: argparse.Namespace) -> None:
    from .store import store_version

    payload, version = _payload(args)

    sessions, session = _open_session()
    try:
        store_version(
            session,
            payload=payload,
            version_label=version,
            slug=args.slug,
            name=args.name,
            organizer=args.organizer,
            source_url=args.source_url,
        )
        session.commit()
    finally:
        sessions.close()

    print(f"imported {args.slug} {version}: {len(payload['ships'])} ships", file=sys.stderr)


def _seed(args: argparse.Namespace) -> None:
    """Publish the ruleset that ships with the application.

    Run at deploy time, beside the migrations. Idempotent, so a restart is a no-op rather
    than an error — which is what makes it safe to put in the entrypoint.
    """
    from .bundled import seed

    sessions, session = _open_session()
    try:
        added = seed(session)
        session.commit()
    finally:
        sessions.close()

    if not added:
        print("ruleset already published; nothing to seed", file=sys.stderr)
        return
    for version in added:
        print(f"seeded {args.slug} {version.version_label}", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m comptool.ingest", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    index_command = commands.add_parser(
        "build-ship-index",
        help="extract the ship-reference index from a downloaded EVE static data archive",
    )
    index_command.add_argument("--sde-zip", type=Path, required=True)
    index_command.add_argument("--out", type=Path, help="defaults to stdout")
    index_command.set_defaults(run=_build_ship_index)

    for name, help_text, run in (
        ("emit-payload", "build the ruleset payload without touching the database", _emit_payload),
        ("import-points", "build the payload and store it as a ruleset version", _import_points),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--csv", type=Path, required=True, help="the points snapshot")
        command.add_argument("--ships", type=Path, required=True, help="the ship-reference index")
        command.add_argument(
            "--version-label", help="defaults to the capture date in the snapshot's filename"
        )
        command.set_defaults(run=run)

    emit, importer = commands.choices["emit-payload"], commands.choices["import-points"]
    emit.add_argument("--out", type=Path, help="defaults to stdout")
    importer.add_argument("--slug", default=atxxii.SLUG)
    importer.add_argument("--name", default=atxxii.NAME)
    importer.add_argument("--organizer", default=atxxii.ORGANIZER)
    importer.add_argument("--source-url", default=atxxii.SOURCE_URL)

    seed_command = commands.add_parser(
        "seed", help="publish the ruleset bundled with the application (idempotent)"
    )
    seed_command.set_defaults(run=_seed, slug=atxxii.SLUG)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.run(args)
    except IngestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0
