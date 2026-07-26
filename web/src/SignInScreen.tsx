import { brand } from './brand/brandConfig'
import SunMark from './brand/SunMark'
import type { Session } from './session'
import { signIn } from './session'

interface Props {
  session: Session | null
}

/**
 * The whole page when there is no character behind the request.
 *
 * Rendered *instead of* the app shell rather than inside it, which is why there is no header
 * and no bar of any kind here. That costs the theme toggle — a returning visitor keeps their
 * choice out of local storage, and a first-time one gets the system's — and it buys back the
 * duplicate control this screen used to have, where the card explained the sign-in and the
 * header held the only button that did it.
 *
 * `signIn()` reads the current path back as its `next`, so arriving here on a deep link and
 * signing in returns to the link rather than to the root.
 */
export default function SignInScreen({ session }: Props) {
  return (
    <section
      className="signin-screen"
      data-testid="sign-in-screen"
      aria-labelledby="sign-in-title"
    >
      <div className="signin-wash" />
      <div className="signin-mid">
        <SunMark size={46} className="signin-mark" />
        <h1 className="signin-word" id="sign-in-title">
          {brand.wordmark.primary}
          <span className="wordmark-suffix">{brand.wordmark.suffix}</span>
        </h1>
        <span className="tag">{brand.productLabel}</span>
        <Action session={session} />
      </div>
    </section>
  )
}

/** One slot, three answers, so the screen does not move when the session probe lands. */
function Action({ session }: Props) {
  if (session === null) {
    return (
      <p className="signin-note" data-testid="session-loading" role="status">
        Checking your session…
      </p>
    )
  }
  if (!session.ssoEnabled) {
    // A button that could only ever 503 is worse than no button. Published ruleset data and
    // share links still work, and neither of them needs anything from this screen.
    return (
      <p className="signin-note" data-testid="sign-in-unavailable">
        This deployment has no EVE application configured, so signing in is unavailable.
      </p>
    )
  }
  return (
    <button className="signin-go" data-testid="sign-in-button" type="button" onClick={() => signIn()}>
      <SunMark size={16} />
      Sign in with EVE
    </button>
  )
}
