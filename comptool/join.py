"""Getting into a team you were invited to, and the controls its owner uses to invite.

Both halves in one module, the way ``share.py`` keeps minting and reading together: the rules
about what a link discloses are the same rules that decide what minting one costs, and a reader
who has to open two files to see both will eventually change one of them alone.

**The link identifies, the password authorizes.** Two things rather than one, and the split is
what makes this different from a share link — there, holding the slug *is* the authorization,
so a forwarded link is a leak with nothing behind it. Here a forwarded link is worth nothing on
its own, and the owner can change the password without re-issuing it, or re-roll the link
without changing the password. They fail independently because they answer different questions.

**A join writes an ordinary ``TeamGrant``.** That is the whole reason this feature is small:
``permissions.resolve_level``, ``access.authorize`` and the access list already know what to do
with one, and none of them can tell a member who typed a password from a member an owner added
by name. It also means the roster is *durable* — changing the password stops new joins and
evicts nobody, which is exactly the property the environment-variable password could not have.

**One refusal for four situations.** An unknown slug, a wrong password, a team that has set no
password, and a team that has been archived all answer 401 with the same sentence. Not
``share.no_such_link``'s 404, because here there is a credential and "you got it wrong" is the
useful thing to say — but the same discipline underneath, for the same reason: anything that
told these apart would turn this route into a way to discover which links are real and which
teams have closed themselves.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import local_accounts, share_slug
from .access import authorize
from .auth import sessions
from .auth.crypto import hash_password, verify_password
from .auth.dependencies import current_viewer, optional_session
from .db import get_session
from .models import AccessLevel, AuthPasswordAttempt, AuthSession, SubjectKind, Team, TeamGrant
from .permissions import Viewer
from .ratelimit import FixedWindow, caller_of
from .settings import Settings, SignInMode, get_settings

logger = logging.getLogger("comptool")

router = APIRouter(prefix="/api/v1", tags=["join"])

#: How long a wrong password counts against whoever tried it.
FAILURE_WINDOW_SECONDS = 900
#: Three buckets, and they answer three different attacks. One person mistyping stops at their
#: own limit and contributes only that much to the team's; a crowd guessing at one team stops
#: at the team's; and a crowd spread across teams stops at the global one.
#:
#: The middle bucket is the one that carries this, and it costs something worth naming: an
#: attacker who fills it stalls that team's *legitimate* joins for the window. That trade is
#: taken deliberately — joining is a once-per-person action, a quarter hour of it being
#: unavailable is an inconvenience, and the alternative is letting somebody grind the password
#: of one named team from a thousand addresses.
PER_CALLER_LIMIT = 5
PER_TEAM_LIMIT = 20
GLOBAL_LIMIT = 100
#: The fixed key every failure is also counted under. Not a hash, so it can never collide.
GLOBAL_SCOPE = "*"

#: A floor on what an owner may choose, and much lower than the environment key's 24. It is
#: deliberately not the same number: a creation key is generated once and pasted into a
#: deployment, while this is chosen by a person and dictated to a team over voice comms. What
#: protects it is the throttle above rather than its length, which is the opposite of how
#: ``TEAM_CREATION_KEY_MIN_LENGTH`` is argued.
TEAM_PASSWORD_MIN_LENGTH = 10

#: How many times to re-roll on a slug collision before giving up — ``share._mint``'s number,
#: for its reason: a collision in a space of four billion is a lottery win, but a bounded loop
#: answering 503 is the difference between a wedged constraint being a failed request and a
#: hung one.
MINT_ATTEMPTS = 8

#: The lookup behind a link, budgeted like the share read. Generous: somebody opening an invite,
#: reloading it and following it from their phone as well should never meet this.
_lookup_window = FixedWindow(
    limit=30,
    window_seconds=60,
    detail="Too many requests; wait a moment and try again",
)


def reset_rate_limit() -> None:
    """Tests only, like ``share.reset_rate_limit``."""
    _lookup_window.reset()


class _Model(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
#: Not trimmed, deliberately — leading and trailing spaces are legitimate in a passphrase, and
#: eating them would make a correct password fail with nothing on screen to explain it. The
#: floor is checked where it is *set*, not here: an old password shorter than a later floor must
#: still let its holders in.
JoinPassword = Annotated[str, Field(min_length=1, max_length=1024)]


class JoinTarget(_Model):
    """What a link discloses before anybody proves anything.

    The team's name and nothing else. Enough for a screen to say what it is asking about —
    "Join Sun Reavers" rather than "Join a team" — and deliberately not a member list, a comp
    count or an owner. Under this deployment's identity model a disclosed *person's* name is a
    disclosed identity, so this route must never grow one.
    """

    team_name: str
    #: True when the caller is already in. Lets the screen offer the team instead of demanding
    #: a password somebody has no reason to still have.
    already_member: bool


class JoinRequest(_Model):
    password: JoinPassword
    #: Required only when nobody is signed in. An invitee arriving cold claims their name here
    #: rather than meeting a sign-in screen first and a join screen second.
    display_name: DisplayName | None = None


class Joined(_Model):
    team_id: uuid.UUID
    team_name: str
    #: What they got, so the screen can say so rather than let them discover it by finding
    #: everything read-only.
    level: str


class JoinPasswordSet(_Model):
    password: JoinPassword
    #: ``viewer`` or ``editor``. The owner's choice, changeable without changing the password.
    level: str = "viewer"


class JoinSettings(_Model):
    """What an owner sees. Never the password — there is only a hash, by design."""

    join_slug: str
    has_password: bool
    level: str


#: Inbound: the two levels a password may be set to grant. Owner is absent for the reason
#: ``teams.GrantLevel`` gives — ownership is a column no grant can confer.
_LEVELS = {"viewer": AccessLevel.VIEWER, "editor": AccessLevel.EDITOR}
#: Outbound, and it needs the third rung the map above does not: an owner following their own
#: link is told "owner", which is true and is not something the password granted them.
_LEVEL_NAMES = {
    AccessLevel.VIEWER: "viewer",
    AccessLevel.EDITOR: "editor",
    AccessLevel.OWNER: "owner",
}


def _require_local_auth(settings: Settings) -> None:
    """404 the whole feature on a deployment that does not use it.

    Load-bearing, not tidiness. Every team carries a ``join_slug`` in both modes because the
    column is NOT NULL, so without this an EVE-SSO deployment would still answer these routes —
    and a join by somebody with no session would call ``local_accounts.claim`` and mint a
    *negative* principal into a database whose every other identity is an EVE character. That
    is precisely the mixing the settings validator refuses to boot with, arriving through a
    side door instead.

    404 rather than the 503 ``auth/local.py`` uses for the same condition, and the difference is
    which question is being asked. There, an operator is debugging a sign-in they configured and
    needs "not configured" rather than "missing". Here the caller is holding a link, and the
    honest answer to "what team is this" on an instance with no joining is that there is no such
    thing.
    """
    if settings.sign_in_mode is not SignInMode.LOCAL:
        raise HTTPException(status_code=404, detail="No such join link")


def _refused() -> HTTPException:
    """The one answer for an unknown link, a wrong password, a closed team and an archived one.

    401 rather than ``share.no_such_link``'s 404: there *is* a credential here, and "that is not
    the password" is something the person typing can act on. What it does not do is say which
    of the four happened — that would make this route a way to find out which links are real,
    and which teams have shut their door, without ever knowing a password.
    """
    return HTTPException(status_code=401, detail="That link or password is not right.")


def mint_join_slug(session: Session) -> str:
    """A slug nothing else is using.

    Checked here as well as by the unique index, because the alternative is an
    ``IntegrityError`` surfacing from a team *creation* — a confusing place to learn that a
    four-word name collided. The index is still the arbiter; this only makes the common path
    quiet. Public because ``teams.create_team`` mints one for every team, in both sign-in modes:
    the column is NOT NULL, and a team under EVE SSO simply never has a password to go with it.
    """
    for _ in range(MINT_ATTEMPTS):
        slug = share_slug.generate()
        if session.scalar(select(Team.id).where(Team.join_slug == slug)) is None:
            return slug
    raise HTTPException(status_code=503, detail="Could not mint a join link; try again")


def _scopes_for(slug: str, request: Request) -> list[tuple[str, int]]:
    """The three buckets a failed attempt counts against, with their limits."""
    caller = caller_of(request)
    return [
        (hashlib.sha256(f"{slug}:{caller}".encode()).hexdigest(), PER_CALLER_LIMIT),
        (hashlib.sha256(f"team:{slug}".encode()).hexdigest(), PER_TEAM_LIMIT),
        (GLOBAL_SCOPE, GLOBAL_LIMIT),
    ]


def _refuse_if_throttled(session: Session, scopes: list[tuple[str, int]], now: datetime) -> None:
    """429 when any bucket is full, with an honest ``Retry-After``.

    A throttled attempt is **not recorded**. Recording it would let somebody already locked out
    push their own lockout forward for as long as they cared to knock — which through the middle
    bucket is a denial of service against a whole team's joins, and through the global one
    against everybody's.
    """
    cutoff = now - timedelta(seconds=FAILURE_WINDOW_SECONDS)
    for scope, limit in scopes:
        count = (
            session.scalar(
                select(func.count())
                .select_from(AuthPasswordAttempt)
                .where(
                    AuthPasswordAttempt.scope == scope,
                    AuthPasswordAttempt.failed_at > cutoff,
                )
            )
            or 0
        )
        if count < limit:
            continue
        oldest = session.scalar(
            select(func.min(AuthPasswordAttempt.failed_at)).where(
                AuthPasswordAttempt.scope == scope,
                AuthPasswordAttempt.failed_at > cutoff,
            )
        )
        wait = FAILURE_WINDOW_SECONDS
        if oldest is not None:
            leaves = oldest + timedelta(seconds=FAILURE_WINDOW_SECONDS)
            wait = max(1, int((leaves - now).total_seconds()))
        if scope == GLOBAL_SCOPE:
            logger.warning(
                "join_throttled_globally", extra={"event": "join_throttled_globally"}
            )
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Wait a few minutes and try again.",
            headers={"Retry-After": str(wait)},
        )


def _record_failure(session: Session, scopes: list[tuple[str, int]], now: datetime) -> None:
    """One row per bucket, after purging what has aged out.

    Purged here rather than on success, so the table stays tidy on a deployment where nobody
    ever gets a password right — and bounded even under attack, because a throttled attempt
    returns above without reaching this.
    """
    session.execute(
        delete(AuthPasswordAttempt).where(
            AuthPasswordAttempt.failed_at <= now - timedelta(seconds=FAILURE_WINDOW_SECONDS)
        ),
        execution_options={"synchronize_session": False},
    )
    for scope, _limit in scopes:
        session.add(AuthPasswordAttempt(scope=scope, failed_at=now))


def _clear_failures(session: Session, scopes: list[tuple[str, int]]) -> None:
    """Forgive the two buckets this caller filled, having established it was fumbling.

    Not the global one: one correct password says nothing about a hundred failures arriving
    from elsewhere, and clearing it would hand an attacker a reset button operated by any
    legitimate joiner.
    """
    keep = {GLOBAL_SCOPE}
    session.execute(
        delete(AuthPasswordAttempt).where(
            AuthPasswordAttempt.scope.in_([s for s, _ in scopes if s not in keep])
        ),
        execution_options={"synchronize_session": False},
    )


def _team_by_slug(session: Session, slug: str) -> Team | None:
    if len(slug) > share_slug.MAX_SLUG_LENGTH:
        # Bounded before it reaches the database, the way share.read_share bounds it: an
        # unbounded path segment has no business becoming a query parameter, and only short
        # slugs are the interesting ones.
        return None
    return session.scalar(select(Team).where(Team.join_slug == slug))


@router.get("/join/{slug}", response_model=JoinTarget)
def join_target(
    slug: str,
    request: Request,
    record: AuthSession | None = Depends(optional_session),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> JoinTarget:
    """What team a link points at, so the screen can name it.

    Anonymous and rate limited. Answers 404 rather than the 401 below, and the difference is
    deliberate: nothing has been attempted here, so there is no credential to be wrong about,
    and a 401 on a plain lookup would ask a browser for authentication it has no way to give.
    """
    _require_local_auth(settings)
    _lookup_window.check(caller_of(request))
    team = _team_by_slug(session, slug)
    # A team with no password set is not joinable, so its link names nothing. Same for an
    # archived one. Reported as a missing link rather than a closed door, for _refused's reason.
    if team is None or team.access_password_hash is None or team.archived_at is not None:
        raise HTTPException(status_code=404, detail="No such join link")

    already = False
    if record is not None:
        already = team.owner_character_id == record.character_id or (
            session.scalar(
                select(TeamGrant.id).where(
                    TeamGrant.team_id == team.id,
                    TeamGrant.subject_kind == SubjectKind.CHARACTER,
                    TeamGrant.subject_id == record.character_id,
                )
            )
            is not None
        )
    return JoinTarget(team_name=team.name, already_member=already)


@router.post("/join/{slug}", response_model=Joined)
def join(
    slug: str,
    body: JoinRequest,
    request: Request,
    response: Response,
    record: AuthSession | None = Depends(optional_session),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Joined:
    """Present the password, and be let in.

    Mints a session too when nobody is signed in, which is what keeps an invitee to one screen:
    they were sent a link, and the link asks for the password and their name together rather
    than sending them to sign in first and come back.
    """
    _require_local_auth(settings)
    now = datetime.now(tz=UTC)
    scopes = _scopes_for(slug, request)
    _refuse_if_throttled(session, scopes, now)

    team = _team_by_slug(session, slug)
    if (
        team is None
        or team.access_password_hash is None
        or team.archived_at is not None
        or not verify_password(body.password, team.access_password_hash)
    ):
        _record_failure(session, scopes, now)
        session.commit()
        logger.warning("join_rejected", extra={"event": "join_rejected"})
        raise _refused()

    _clear_failures(session, scopes)

    if record is None:
        if body.display_name is None:
            # A 422 rather than the blanket 401: the password was right, and refusing without
            # saying what is missing would leave somebody retyping a password that was never
            # the problem.
            raise HTTPException(
                status_code=422, detail="Tell us what to call you before joining."
            )
        account = local_accounts.claim(session, body.display_name, now=now)
        issued = sessions.mint(
            session,
            character_id=account.principal_id,
            character_name=account.display_name,
            owner_hash=None,
            ttl_seconds=settings.session_ttl_seconds,
        )
        principal, principal_name = account.principal_id, account.display_name
        sessions.set_session_cookie(response, issued.token, settings)
    else:
        principal, principal_name = record.character_id, record.character_name

    level = _grant(session, team, principal, principal_name)
    session.commit()

    logger.info(
        "join",
        extra={"event": "join", "character_id": principal, "team_id": str(team.id)},
    )
    return Joined(team_id=team.id, team_name=team.name, level=_LEVEL_NAMES[level])


def _grant(session: Session, team: Team, principal: int, name: str) -> AccessLevel:
    """Write the membership, or leave the one that is already there alone.

    Three outcomes and none of them is an error. The owner gets nothing written, because
    ownership is a column the resolver short-circuits on and a grant beside it would be a
    weaker duplicate. An existing member keeps the level they have — a re-used link must not
    silently *demote* somebody an owner promoted by hand, which is what re-applying the team's
    configured level would do. Everybody else gets a new row.
    """
    if team.owner_character_id == principal:
        return AccessLevel.OWNER

    existing = session.scalar(
        select(TeamGrant).where(
            TeamGrant.team_id == team.id,
            TeamGrant.subject_kind == SubjectKind.CHARACTER,
            TeamGrant.subject_id == principal,
        )
    )
    if existing is not None:
        return AccessLevel(existing.level)

    level = AccessLevel(team.access_password_level)
    grant = TeamGrant(
        team_id=team.id,
        subject_kind=SubjectKind.CHARACTER,
        subject_id=principal,
        subject_name=name,
        level=level,
    )
    session.add(grant)
    try:
        with session.begin_nested():
            session.flush()
    except IntegrityError:
        # Two tabs, one link. The unique constraint settles it and the loser reads back the
        # winner's row rather than failing a join that plainly succeeded.
        session.rollback()
        again = session.scalar(
            select(TeamGrant).where(
                TeamGrant.team_id == team.id,
                TeamGrant.subject_kind == SubjectKind.CHARACTER,
                TeamGrant.subject_id == principal,
            )
        )
        if again is None:
            raise
        return AccessLevel(again.level)
    return level


# --- the owner's side ----------------------------------------------------------------------


@router.get("/teams/{team_id}/join", response_model=JoinSettings)
def read_join_settings(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    settings: Settings = Depends(get_settings),
) -> JoinSettings:
    """The link and whether a password is set. Owner only, and never the password itself."""
    _require_local_auth(settings)
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    return _settings_of(access.team)


def _settings_of(team: Team) -> JoinSettings:
    return JoinSettings(
        join_slug=team.join_slug,
        has_password=team.access_password_hash is not None,
        level=_LEVEL_NAMES[AccessLevel(team.access_password_level)],
    )


@router.put("/teams/{team_id}/join", response_model=JoinSettings)
def set_join_password(
    team_id: uuid.UUID,
    body: JoinPasswordSet,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    settings: Settings = Depends(get_settings),
) -> JoinSettings:
    """Set or change the password, and what it grants.

    **Changes nothing for anybody already in.** Their membership is a ``team_grant`` row, and
    this touches a column on the team — which is the property the environment-variable password
    could not have, where a rotation signed out the whole instance. Rotating here stops new
    joins; removing one person is deleting their grant, which the access list already does.
    """
    _require_local_auth(settings)
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    level = _LEVELS.get(body.level)
    if level is None:
        raise HTTPException(status_code=422, detail="Access must be viewer or editor.")
    if len(body.password) < TEAM_PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Use at least {TEAM_PASSWORD_MIN_LENGTH} characters, or a few words.",
        )
    access.team.access_password_hash = hash_password(body.password)
    access.team.access_password_level = level
    session.commit()
    logger.info(
        "join_password_set",
        extra={"event": "join_password_set", "team_id": str(team_id)},
    )
    return _settings_of(access.team)


@router.delete("/teams/{team_id}/join", response_model=JoinSettings)
def clear_join_password(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    settings: Settings = Depends(get_settings),
) -> JoinSettings:
    """Close the team. The link stops working; everybody already in stays in."""
    _require_local_auth(settings)
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    access.team.access_password_hash = None
    session.commit()
    logger.info(
        "join_password_cleared",
        extra={"event": "join_password_cleared", "team_id": str(team_id)},
    )
    return _settings_of(access.team)


@router.post("/teams/{team_id}/join/link", response_model=JoinSettings)
def reroll_join_link(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    settings: Settings = Depends(get_settings),
) -> JoinSettings:
    """A new link, and the old one stops naming anything.

    The only way to kill a link that reached the wrong chat. Changing the password does not do
    it — the link still points here, and whoever holds it only needs the new password — so the
    two controls are separate because the two leaks are.
    """
    _require_local_auth(settings)
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    access.team.join_slug = mint_join_slug(session)
    session.commit()
    logger.info(
        "join_link_rerolled",
        extra={"event": "join_link_rerolled", "team_id": str(team_id)},
    )
    return _settings_of(access.team)
