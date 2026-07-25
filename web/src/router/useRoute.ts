// The React binding for `route.ts`, and the only place the History API is touched.
//
// `useSyncExternalStore` rather than a `useState` plus a listener: it is what React 19
// offers for exactly this — an external source of truth that changes outside React — and it
// gets the concurrent-rendering tearing right without any care from us.

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'

import { hrefFor, parseRoute } from './route'
import type { Route } from './route'

// pushState does not fire popstate, so navigations we cause need their own signal. A custom
// event rather than a synthesised PopStateEvent, so ours stays distinguishable from the
// browser's own back and forward.
const NAVIGATED = 'comptool:navigated'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATED, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATED, onChange)
  }
}

// A string, deliberately. Returning `parseRoute(...)` here would hand React a fresh object
// on every call, which it compares by identity — the render loop would never settle.
function currentHref(): string {
  return window.location.pathname + window.location.search
}

function serverHref(): string {
  return '/'
}

/** The route the browser is currently showing. */
export function useRoute(): Route {
  const href = useSyncExternalStore(subscribe, currentHref, serverHref)
  return useMemo(() => parseRoute(href), [href])
}

function go(href: string, replace: boolean): void {
  if (replace) window.history.replaceState(null, '', href)
  else window.history.pushState(null, '', href)
  window.dispatchEvent(new Event(NAVIGATED))
}

/** Go somewhere. `replace` for a redirect that should not become a Back destination. */
export function navigate(route: Route, options?: { readonly replace?: boolean }): void {
  go(hrefFor(route), options?.replace === true)
}

/**
 * Props for a real link.
 *
 * The `href` is what makes middle-click, ctrl-click and "copy link address" work, and the
 * handler stands aside for every one of them. A hand-rolled router that swallows modified
 * clicks is the classic way to break opening things in a new tab.
 *
 * Keyed on the href rather than on the route, because a route is a literal built during
 * render and would be a new object every time.
 */
export function useLinkProps(route: Route): {
  href: string
  onClick: (event: MouseEvent) => void
} {
  const href = hrefFor(route)
  const onClick = useCallback(
    (event: MouseEvent) => {
      if (event.defaultPrevented) return
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      go(href, false)
    },
    [href],
  )
  return { href, onClick }
}
