"""Signing in with an EVE character, and the sessions that keep people signed in.

Four concerns, deliberately kept apart so each is testable on its own:

- ``crypto`` encrypts the SSO refresh token at rest and knows nothing else.
- ``sso`` speaks OAuth2 + PKCE to login.eveonline.com and verifies the identity token.
  No database, no FastAPI — a keypair and a fake transport are enough to test it.
- ``sessions`` owns the session table and the cookie that names a row in it. No network.
- ``dependencies`` and ``routes`` join the two to a request.

Written fresh rather than ported: the identity this proves is the whole authorization
model, so the HTTP, JWT and refresh layers are ours to reason about.
"""

from __future__ import annotations
