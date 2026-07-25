"""Minting the human-readable name a shared comp is read by.

The grammar is ``{adjective}-{adjective}-{noun}-{noun}`` — two distinct adjectives and two
distinct nouns, drawn with :mod:`secrets` — giving something like
``brave-amber-tempest-harbour``. Words only, no random suffix: §7 asks for BurnSun's
human-readable petname slug and that is what this is.

**The size of the space, stated plainly, because it is the whole security argument.**
256 x 255 x 256 x 255 = 4,262,461,440, a little over 2^32. That is a *name*, not a key. With
ten thousand live links out, a blind guesser making a thousand requests a second expects a hit
in around seven minutes. So the slug alone is not what keeps a shared comp private:

* the read route is **rate limited**, which is what turns seven minutes into years;
* the read route answers ``X-Robots-Tag: noindex``, so a shared link is never crawled;
* and a share is **revocable**, so a leaked link can be withdrawn.

If that trade is ever judged wrong, the fix is one line here — append a
:func:`secrets.token_urlsafe` suffix — and it needs **no migration and no data change**,
because resolution is equality on a stored string and nothing re-derives a slug from the
lexicon. That reversibility is deliberate, and it is why the lexicon lives in its own module.
"""

from __future__ import annotations

import secrets

from .share_lexicon import ADJECTIVES, NOUNS

#: What the wire and the column allow. The longest slug this grammar can emit is 10+1+10+1+
#: 10+1+10 = 43 characters, so ``String(64)`` has room for a suffix if one is ever added.
MAX_SLUG_LENGTH = 64


def generate() -> str:
    """A fresh slug. Never checked for uniqueness here — the unique index is the arbiter.

    The two adjectives are drawn distinctly, and so are the two nouns: ``brave-brave-…`` reads
    like a bug rather than a name, and the pair a repeat would cost is worth more than the
    fraction of a bit it saves.
    """
    first, second = _two_of(ADJECTIVES)
    third, fourth = _two_of(NOUNS)
    return f"{first}-{second}-{third}-{fourth}"


def _two_of(words: tuple[str, ...]) -> tuple[str, str]:
    first = secrets.choice(words)
    second = secrets.choice(words)
    while second == first:
        second = secrets.choice(words)
    return first, second
