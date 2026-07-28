# Local accounts, and the passwords that belong to teams

> The **design record** for the sign-in mode a deployment with no EVE application uses. It is
> kept because the arguments in it are the ones a later reader will want — why principal ids are
> negative, why the modes are exclusive, why a team's password is hashed and the environment's
> is not, and what a claimed name deliberately does not prove.
>
> The operator-facing version is the README's
> [Local accounts](../README.md#local-accounts). This is the why.
>
> Read with: `comptool/auth/local.py`, `comptool/join.py`, `comptool/local_accounts.py`,
> `comptool/auth/crypto.py`, `comptool/settings.py` and `comptool/models.py`.

## What problem it solves

Registering an EVE application is the real barrier to self-hosting: a developer-portal account,
a byte-exact callback URL, a token secret, and a deployment that crash-loops if any of the three
is blank. A group who already talk to each other every day would rather hand out a password.

An earlier draft of this feature put **one password in an environment variable** and made it the
instance's front door. That was wrong in a way worth recording, because the mistake is an easy
one to make again: it put the credential in the hands of whoever holds deploy access rather than
whoever runs a team, it could not be changed without a redeploy, and rotating it to remove one
person signed out everybody. A credential a captain cannot change is a credential in the wrong
place.

So the credential moved to the team. What is left in the environment is one narrower thing —
who may create a team at all — and it is not a sign-in credential.

## Three secrets, three jobs

| Secret | Where it lives | What it decides | Who holds it |
|---|---|---|---|
| Creation key | `COMPTOOL_TEAM_CREATION_KEY` (env) | Who may create a team | The operator |
| A team's join password | `team.access_password_hash` | Who may join *that* team, and at what level | The team's owner |
| — | — | Who you are | **Nobody.** A claimed name, unproven |

**The team's password is hashed and the environment's is not**, and `auth/crypto.py` keeps both
in one file so the contrast is visible. An environment variable is already readable by anything
that can read the process, so hashing it would be theatre. A password sitting in a row is the
opposite: a leaked backup would otherwise hand over every team's password at once. The same
module also holds Fernet encryption for the SSO refresh token, and the difference between those
two is exactly the difference between a secret that must be *read back* and one that must only
be *compared*.

## The negative band

A local principal's id is **negative**, handed out by a Postgres sequence counting down from
`-1`. EVE's id space is entirely positive and every identity column was already a signed
`BigInteger`, so `auth_session.character_id`, `team.owner_character_id`, `team_grant.subject_id`,
`comp.created_by_character_id`, `comp_comment.author_character_id` and
`workspace_layout.character_id` all hold one **with no migration**.

The sign is also the only discriminator anything needs:

- `esi.py:_read` already refuses a non-positive id, so a local principal can never arrive from
  ESI and be mistaken for a character.
- `web/src/lib/icons.ts:buildCcpPortraitUrl` already returns null for one, and the account menu
  already falls back to initials — so avatars needed no frontend work at all.
- A stray positive in a local database, or negative in an SSO one, is unmistakably wrong.

`character_id` is deliberately **not** renamed to `principal_id`. That is a hundred edits across
two wire contracts for no behavioural change; the term is widened in the docstrings that define
it instead.

## Why the modes cannot both be on

`settings._check_local_auth_configuration` refuses to boot with `COMPTOOL_ESI_ENABLED` and
`COMPTOOL_LOCAL_AUTH_ENABLED` both set. One principal kind per database is what keeps every
authorization invariant true without a discriminator threaded through five tables.

That refusal has a **second half that is easy to miss**, and `join.py:_require_local_auth` is it.
Every team carries a `join_slug` in both modes, because the column is NOT NULL. Without a mode
check the join routes would therefore answer on an EVE-SSO deployment — and a join by somebody
with no session would call `local_accounts.claim` and mint a *negative* principal into a database
whose every other identity is a positive EVE character. That is precisely the mixing the boot
refusal exists to prevent, arriving through a side door. `test_join.py` pins it.

## Joining, and why it is two things

A join is a **link plus a password**, not one or the other, and they fail independently:

- Changing the password stops new joins. The link still points at the team.
- Re-rolling the link kills a link that reached the wrong chat. The password is unchanged.

This is what makes it different from a share link, where holding the slug *is* the
authorization. The slug here is still unguessable, but not because the security depends on it —
a guessable one would turn the column into a directory of which teams exist, which `access.py`
refuses to disclose everywhere else.

**A join writes an ordinary `TeamGrant`.** That is the whole reason the feature is small:
`permissions.resolve_level`, `access.authorize` and the access list already know what to do with
one, and none of them can tell a member who typed a password from a member an owner added by
name. It is also what makes the roster *durable* — rotating a password evicts nobody, which is
the property the environment-variable version could not have.

Add-by-name is refused outright in this mode. There is no register of people to look a name up
in: under EVE SSO a name is something the game vouches for and can be resolved before its owner
has ever opened the tool, while here a name exists only once somebody has claimed it. The join
link reaches them without the captain typing anything.

## What a claimed name does not prove

**Signing in asks for a name and nothing else.** Anybody who can reach the site can claim any
name, including one somebody already holds, and inherit every team that principal belongs to.
There is no password, no code and no check.

This was a bounded hole under the earlier instance-password draft — the population who could do
it was the population holding the password. With sign-in open it is bounded only by an attacker
having to *know* a name to type. Two consequences follow, and both are load-bearing:

- **No anonymous route may disclose a member's name.** None does: `share.SharedCompDetail`
  carries a comp name, ruleset keys and hulls, and no person at all, and `join.JoinTarget`
  carries a team name and a boolean. Any new one is a security change, not a feature.
- **Claims are rate limited** (`auth/local.py`), so names cannot be harvested at speed. Note
  that this is a *rate* limit, not a failure throttle — nothing at that door can fail. The
  failure throttle is in `join.py`, in the database, because guesses at a password have to
  survive a restart and be shared between workers.

The trade was put to the owner explicitly, alongside the alternative, and taken. If it is ever
judged too sharp, the smallest fix is one nullable `password_hash` column on `local_account` and
one field on two screens — `hash_password` already exists and would serve. Nothing forecloses it.

## Deferred

- **A per-person password**, as above. The upgrade path, not a gap nobody noticed.
- **Per-team creation limits.** The creation key is all-or-nothing: anybody holding it can make
  any number of teams. Fine for a group; not for a public instance.
- **Seeing who joined when.** A grant records a level and a creation time, not which link or
  password admitted somebody. Nobody has needed it yet.
