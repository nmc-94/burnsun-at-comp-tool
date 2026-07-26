/**
 * An elapsed time as a phrase: "2 hours ago", "yesterday", "just now".
 *
 * `CommentThread` deliberately does the opposite — it formats an absolute date and says why:
 * a relative time rendered once and never re-rendered goes quietly wrong the longer a board
 * stays open, and that panel holds no timer. That reasoning scopes to *long-lived* surfaces.
 * The teams screen is on for the few seconds it takes to pick a board, so a phrase there
 * cannot drift far enough to mislead, and it reads at a glance where a timestamp has to be
 * decoded. Absolute stays the default anywhere a screen outlives its own strings.
 */

// Largest first, so the first unit the elapsed time clears is the coarsest one that fits.
const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_557_600_000],
  ['month', 2_629_800_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

// "1 minute ago" for anything more recent is a distinction without a difference, and it is
// the range a clock skewed the wrong way lands in.
const JUST_NOW = 45_000

/**
 * Null when the timestamp cannot be read, so a caller can drop the line rather than print it.
 *
 * `now` and `locales` are parameters rather than reads of the ambient clock and locale so
 * this is testable at all: the phrase for a given elapsed time is the whole behaviour, and
 * neither a moving clock nor the machine's language can be asserted against.
 */
export function ago(
  iso: string,
  now: Date = new Date(),
  locales?: string | string[],
): string | null {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const elapsed = now.getTime() - then
  if (elapsed < JUST_NOW) return 'just now'

  const relative = new Intl.RelativeTimeFormat(locales, { numeric: 'auto' })
  for (const [unit, span] of UNITS) {
    if (elapsed >= span) return relative.format(-Math.round(elapsed / span), unit)
  }
  return 'just now'
}
