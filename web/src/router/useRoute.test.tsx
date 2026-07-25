// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceRoute } from './route'
import { navigate, useLinkProps, useRoute } from './useRoute'

function Probe() {
  const route = useRoute()
  return <span data-testid="probe">{JSON.stringify(route)}</span>
}

function probeText() {
  return screen.getByTestId('probe').textContent ?? ''
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(cleanup)

describe('useRoute', () => {
  it('reads the route the browser is showing', () => {
    window.history.replaceState(null, '', '/teams/t1/boards/b2')

    render(<Probe />)

    expect(probeText()).toContain('"boardId":"b2"')
  })

  it('re-renders when the browser goes back', () => {
    render(<Probe />)

    window.history.pushState(null, '', '/teams/t9')
    fireEvent.popState(window)

    expect(probeText()).toContain('"teamId":"t9"')
  })

  it('re-renders when we navigate, which fires no popstate of its own', () => {
    render(<Probe />)

    act(() => navigate(workspaceRoute('t4', 'b5')))

    expect(probeText()).toContain('"boardId":"b5"')
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<Probe />)
    unmount()

    // The assertion is that this does not throw on a torn-down component.
    expect(() => navigate(workspaceRoute('t1'))).not.toThrow()
  })
})

describe('navigate', () => {
  it('pushes by default and replaces on request', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')

    navigate(workspaceRoute('t1', 'b1'))
    navigate(workspaceRoute('t2'), { replace: true })

    expect(push).toHaveBeenCalledWith(null, '', '/teams/t1/boards/b1')
    expect(replace).toHaveBeenCalledWith(null, '', '/teams/t2')
    push.mockRestore()
    replace.mockRestore()
  })
})

describe('useLinkProps', () => {
  let handler: ((event: MouseEvent) => void) | null = null

  function Link() {
    const props = useLinkProps(workspaceRoute('t7', 'b8'))
    handler = props.onClick
    return (
      <a data-testid="link" {...props}>
        Board
      </a>
    )
  }

  // The modified-click cases call the handler directly rather than dispatching at the
  // anchor: letting a real click through would have jsdom attempt a document navigation,
  // and what is being asserted is the handler's decision, not jsdom's response to it.
  function click(overrides: Partial<MouseEvent> = {}) {
    const preventDefault = vi.fn()
    const event = { defaultPrevented: false, button: 0, preventDefault, ...overrides }
    handler?.(event as unknown as MouseEvent)
    return preventDefault
  }

  it('carries a real href, so copy-link and middle-click work', () => {
    render(<Link />)

    expect(screen.getByTestId('link').getAttribute('href')).toBe('/teams/t7/boards/b8')
  })

  it('navigates on a plain left click', () => {
    render(<Link />)

    fireEvent.click(screen.getByTestId('link'), { button: 0 })

    expect(window.location.pathname).toBe('/teams/t7/boards/b8')
  })

  it.each([
    ['ctrl-click', { ctrlKey: true }],
    ['meta-click', { metaKey: true }],
    ['shift-click', { shiftKey: true }],
    ['middle-click', { button: 1 }],
  ])('stands aside for a %s, so the browser keeps its own behaviour', (_name, overrides) => {
    render(<Link />)

    const preventDefault = click(overrides as Partial<MouseEvent>)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })
})
