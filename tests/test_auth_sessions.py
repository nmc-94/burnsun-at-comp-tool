"""The session store.

Three properties carry the weight here: the table holds hashes rather than usable
credentials, an expiry really does slide, and ending a session takes the stored refresh
token with it — that last one enforced by the database, not by remembering to write a
second delete.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from comptool.auth import sessions
from comptool.auth.sso import PkceChallenge
from comptool.models import AuthEsiToken, AuthLoginAttempt, AuthSession

TTL = 2_592_000
NOW = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)


def challenge(state: str) -> PkceChallenge:
    return PkceChallenge(state=state, code_verifier="a-verifier")


def sign_in(session, character_id: int = 90_000_001, now: datetime = NOW):
    issued = sessions.mint(
        session,
        character_id=character_id,
        character_name="Kadir",
        owner_hash="an-owner-hash",
        ttl_seconds=TTL,
        now=now,
    )
    session.commit()
    return issued


def test_a_minted_session_is_found_by_its_cookie_token(session):
    issued = sign_in(session)

    found = sessions.load(session, issued.token, now=NOW)

    assert found is not None
    assert found.character_id == 90_000_001
    assert found.character_name == "Kadir"


def test_the_table_stores_a_hash_not_the_cookie_value(session):
    # A leaked backup should not be a set of working logins.
    issued = sign_in(session)

    stored = session.scalars(select(AuthSession)).one()

    assert stored.token_hash != issued.token
    assert stored.token_hash == sessions.hash_token(issued.token)
    assert len(stored.token_hash) == 64


def test_two_sign_ins_never_share_a_token(session):
    assert sign_in(session).token != sign_in(session).token


def test_an_unknown_token_finds_nothing(session):
    sign_in(session)

    assert sessions.load(session, "not-a-real-token", now=NOW) is None


def test_an_expired_session_finds_nothing(session):
    issued = sign_in(session)

    assert sessions.load(session, issued.token, now=NOW + timedelta(seconds=TTL + 1)) is None


def test_an_expired_session_is_not_deleted_by_being_read(session):
    # Reading runs on every request; a read that writes would be an UPDATE per page load.
    issued = sign_in(session)

    sessions.load(session, issued.token, now=NOW + timedelta(seconds=TTL + 1))

    assert session.scalars(select(AuthSession)).one().id == issued.record.id


def test_using_a_session_pushes_its_expiry_out(session):
    issued = sign_in(session)
    later = NOW + timedelta(days=10)

    changed = sessions.renew(session, issued.record, ttl_seconds=TTL, now=later)
    session.commit()

    assert changed is True
    assert issued.record.expires_at == later + timedelta(seconds=TTL)
    assert issued.record.last_seen_at == later


def test_a_session_used_twice_in_a_minute_is_only_written_once(session):
    # The observable behaviour against a 30-day window is identical, at a fraction of the
    # writes on the one table every request touches.
    issued = sign_in(session)
    original = issued.record.expires_at

    again = sessions.renew(
        session,
        issued.record,
        ttl_seconds=TTL,
        renew_after_seconds=3600,
        now=NOW + timedelta(seconds=30),
    )

    assert again is False
    assert issued.record.expires_at == original


def test_a_session_used_after_the_throttle_window_is_renewed(session):
    issued = sign_in(session)
    later = NOW + timedelta(hours=2)

    changed = sessions.renew(
        session, issued.record, ttl_seconds=TTL, renew_after_seconds=3600, now=later
    )

    assert changed is True
    assert issued.record.expires_at == later + timedelta(seconds=TTL)


def test_signing_out_leaves_the_other_devices_alone(session):
    phone = sign_in(session)
    desktop = sign_in(session)

    sessions.revoke(session, phone.record)
    session.commit()

    assert sessions.load(session, phone.token, now=NOW) is None
    assert sessions.load(session, desktop.token, now=NOW) is not None


def test_signing_out_everywhere_ends_every_session_for_the_character(session):
    phone = sign_in(session)
    desktop = sign_in(session)
    somebody_else = sign_in(session, character_id=90_000_002)

    ended = sessions.revoke_all_for_character(session, 90_000_001)
    session.commit()

    assert ended == 2
    assert sessions.load(session, phone.token, now=NOW) is None
    assert sessions.load(session, desktop.token, now=NOW) is None
    assert sessions.load(session, somebody_else.token, now=NOW) is not None


def test_ending_a_session_takes_its_stored_refresh_token_with_it(session):
    issued = sign_in(session)
    session.add(
        AuthEsiToken(session_id=issued.record.id, refresh_token_encrypted="ciphertext")
    )
    session.commit()

    sessions.revoke(session, issued.record)
    session.commit()

    assert session.scalars(select(AuthEsiToken)).all() == []


def test_signing_out_everywhere_takes_the_refresh_tokens_too(session):
    # A bulk delete skips the ORM cascade, so this only holds because the foreign key
    # cascades in the database.
    for _ in range(2):
        issued = sign_in(session)
        session.add(
            AuthEsiToken(session_id=issued.record.id, refresh_token_encrypted="ciphertext")
        )
    session.commit()

    sessions.revoke_all_for_character(session, 90_000_001)
    session.commit()

    assert session.scalars(select(AuthEsiToken)).all() == []


def test_a_transferred_character_loses_the_previous_owners_sessions(session):
    stale = sign_in(session)

    ended = sessions.revoke_sessions_of_a_previous_owner(session, 90_000_001, "a-new-owner-hash")
    session.commit()

    assert ended == 1
    assert sessions.load(session, stale.token, now=NOW) is None


def test_the_same_owner_signing_in_again_keeps_their_other_devices(session):
    phone = sign_in(session)

    ended = sessions.revoke_sessions_of_a_previous_owner(session, 90_000_001, "an-owner-hash")
    session.commit()

    assert ended == 0
    assert sessions.load(session, phone.token, now=NOW) is not None


def test_expired_sessions_and_abandoned_logins_are_purged(session):
    live = sign_in(session)
    dead = sign_in(session, character_id=90_000_002, now=NOW - timedelta(seconds=TTL + 60))
    sessions.start_attempt(
        session, challenge("abandoned"), next_path="/", now=NOW - timedelta(hours=1)
    )
    sessions.start_attempt(session, challenge("in-flight"), next_path="/", now=NOW)
    session.commit()

    removed = sessions.purge_expired(session, now=NOW)
    session.commit()

    assert removed == 2
    assert sessions.load(session, live.token, now=NOW) is not None
    assert sessions.load(session, dead.token, now=NOW) is None
    assert session.scalars(select(AuthLoginAttempt.state)).all() == ["in-flight"]


def test_claiming_a_login_consumes_it(session):
    sessions.start_attempt(session, challenge("a-state"), next_path="/teams", now=NOW)
    session.commit()

    claimed = sessions.claim_attempt(session, "a-state", now=NOW)
    session.commit()

    assert claimed is not None
    assert claimed.next_path == "/teams"
    assert sessions.claim_attempt(session, "a-state", now=NOW) is None


def test_a_stale_login_cannot_be_claimed_but_is_still_cleared(session):
    sessions.start_attempt(session, challenge("a-state"), next_path="/", now=NOW)
    session.commit()
    too_late = NOW + timedelta(seconds=sessions.LOGIN_ATTEMPT_LIFETIME_SECONDS + 1)

    assert sessions.claim_attempt(session, "a-state", now=too_late) is None
    session.commit()

    assert session.scalars(select(AuthLoginAttempt)).all() == []


def test_an_unknown_state_claims_nothing(session):
    assert sessions.claim_attempt(session, "never-issued", now=NOW) is None
