"""The share slug, and the lexicon it is drawn from.

Pure — no database and no client — like ``test_permissions.py``. Two things are worth pinning
here. The **shape**, because a slug ends up in a URL, a column and somebody's voice over comms.
And the **size of the lexicon**, because the entropy argument in ``share_slug``'s docstring is
arithmetic over exactly these two numbers: shrink a list and the argument silently stops
holding, with nothing else to notice.
"""

from __future__ import annotations

import re

from comptool import share_slug
from comptool.share_lexicon import ADJECTIVES, NOUNS

SLUG = re.compile(r"[a-z]+-[a-z]+-[a-z]+-[a-z]+")


def test_reads_as_four_words():
    slug = share_slug.generate()

    assert SLUG.fullmatch(slug), slug
    assert len(slug) <= share_slug.MAX_SLUG_LENGTH


def test_draws_the_words_from_the_lexicon():
    first, second, third, fourth = share_slug.generate().split("-")

    assert first in ADJECTIVES
    assert second in ADJECTIVES
    assert third in NOUNS
    assert fourth in NOUNS


def test_never_repeats_a_word_within_a_pair():
    # "brave-brave-…" reads like a bug rather than a name.
    for _ in range(500):
        adjective_one, adjective_two, noun_one, noun_two = share_slug.generate().split("-")
        assert adjective_one != adjective_two
        assert noun_one != noun_two


def test_does_not_repeat_itself_in_any_practical_run():
    # Not a uniqueness guarantee — the unique index is that — but a generator with a stuck
    # seed or a constant would show up here rather than in production.
    minted = {share_slug.generate() for _ in range(2000)}

    assert len(minted) > 1990


def test_the_lexicon_is_the_size_the_entropy_argument_assumes():
    # share_slug's docstring computes 256 * 255 * 256 * 255 and reasons about the rate limit
    # from that number. Changing a list without changing the argument is the failure this
    # catches.
    assert len(ADJECTIVES) == 256
    assert len(NOUNS) == 256
    assert len(set(ADJECTIVES)) == 256
    assert len(set(NOUNS)) == 256


def test_every_word_is_safe_in_a_url_and_readable_aloud():
    word = re.compile(r"[a-z]{3,10}")
    for words in (ADJECTIVES, NOUNS):
        offenders = [entry for entry in words if not word.fullmatch(entry)]
        assert offenders == []
