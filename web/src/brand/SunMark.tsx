// The brand mark, beside the strings for the same reason they are here: a self-hoster
// replaces one directory rather than hunting through components.
//
// The geometry is `public/favicon.svg`, redrawn in `currentColor` — the favicon has to carry
// a literal hex because nothing inherits into a browser tab, but on the page the mark takes
// the colour of whatever it sits in, which is how it reads amber in the header and inherits
// the button's own foreground inside the sign-in control.

interface Props {
  size?: number
  className?: string
}

export default function SunMark({ size = 16, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="7" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="16" y1="26" x2="16" y2="30" />
        <line x1="2" y1="16" x2="6" y2="16" />
        <line x1="26" y1="16" x2="30" y2="16" />
        <line x1="6.2" y1="6.2" x2="9" y2="9" />
        <line x1="23" y1="23" x2="25.8" y2="25.8" />
        <line x1="6.2" y1="25.8" x2="9" y2="23" />
        <line x1="23" y1="9" x2="25.8" y2="6.2" />
      </g>
    </svg>
  )
}
