// The chrome's icons, in one place beside the components that draw them.
//
// Mostly the top bar, and `TeamsIcon` also marks a shared board's tab in the strip below it —
// the same glyph for the same idea, which is the reason they live together rather than beside
// whichever component happened to want one first.
//
// A 16 box and `currentColor` throughout, so one rule sizes them (`svg { width: 13px }` on
// the pill, 11px inside the theme toggle) and each takes the colour of whatever it sits in.
// The gear, sun and moon are BurnSun's own paths, so the same control reads identically in
// both apps.

interface Props {
  readonly className?: string
}

function frame(children: React.ReactNode, className?: string) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

export function GearIcon({ className }: Props) {
  return frame(
    <>
      <path
        d="M6.72 1.93a1.2 1.2 0 0 1 2.56 0l.16.9c.31.11.61.24.9.41l.79-.47a1.2 1.2 0 0 1 1.77 1.77l-.47.79c.17.29.3.59.41.9l.9.16a1.2 1.2 0 0 1 0 2.56l-.9.16c-.11.31-.24.61-.41.9l.47.79a1.2 1.2 0 0 1-1.77 1.77l-.79-.47c-.29.17-.59.3-.9.41l-.16.9a1.2 1.2 0 0 1-2.56 0l-.16-.9a5.07 5.07 0 0 1-.9-.41l-.79.47a1.2 1.2 0 0 1-1.77-1.77l.47-.79a5.07 5.07 0 0 1-.41-.9l-.9-.16a1.2 1.2 0 0 1 0-2.56l.9-.16c.11-.31.24-.61.41-.9l-.47-.79a1.2 1.2 0 0 1 1.77-1.77l.79.47c.29-.17.59-.3.9-.41l.16-.9Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    </>,
    className,
  )
}

export function TeamsIcon({ className }: Props) {
  return frame(
    <>
      <circle cx="6" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M1.6 13.4a4.6 4.6 0 0 1 8.8 0M10.8 4a2.6 2.6 0 0 1 0 5M12 13.4a4.4 4.4 0 0 0-1.2-3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </>,
    className,
  )
}

/** Crossed blades — a rehearsal, not a board. */
export function PickBanIcon({ className }: Props) {
  return frame(
    <path
      d="M2.5 2.5h2.2l7 7-2.2 2.2-7-7V2.5ZM13.5 2.5h-2.2l-2.6 2.6 2.2 2.2 2.6-2.6V2.5ZM3 13l3-3M13 13l-3-3"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
    className,
  )
}

export function SignOutIcon({ className }: Props) {
  return frame(
    <path
      d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
    className,
  )
}

export function SunIcon({ className }: Props) {
  return frame(
    <>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 2v1.5M8 12.5V14M14 8h-1.5M3.5 8H2M12.2 3.8l-1.06 1.06M4.84 11.16l-1.06 1.06M12.2 12.2l-1.06-1.06M4.84 4.84 3.78 3.78"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>,
    className,
  )
}

export function MoonIcon({ className }: Props) {
  return frame(
    <path
      d="M13.5 9.5A6 6 0 0 1 6.5 2.5a5.5 5.5 0 1 0 0 11 6 6 0 0 0 7-4Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />,
    className,
  )
}
