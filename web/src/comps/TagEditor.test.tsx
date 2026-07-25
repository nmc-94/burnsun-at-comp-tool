// @vitest-environment jsdom

// The tag editor, rendered.
//
// `tag-model.test.ts` already proves which values get suggested, so nothing here re-checks a
// filter. What these cover is the part the model cannot: that the two namespaces are two
// controls, that picking one writes the *whole* shape the route takes, and that everything is
// reachable by role and name — which is the same contract a browser driver works through.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TagEditor from './TagEditor'

afterEach(cleanup)

const VOCABULARY = {
  archetypes: ['Brawl', 'Kite'],
  tags: ['Angel', 'Armor', 'Shield'],
}

function editor(
  archetype: string | null = null,
  tags: string[] = [],
  vocabulary = VOCABULARY,
) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <TagEditor
      archetype={archetype}
      tags={tags}
      vocabulary={vocabulary}
      onSave={onSave}
      onClose={onClose}
    />,
  )
  return { onSave, onClose }
}

const options = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))

describe('the two namespaces', () => {
  it('are two boxes with two option lists, so neither can offer the other’s values', () => {
    // §3.3's "never cross-suggest", made structural rather than enforced by a filter.
    editor()

    expect(options('comp-archetype-options')).toEqual([
      'Set archetype to Brawl',
      'Set archetype to Kite',
    ])
    expect(options('comp-tags-options')).toEqual(['Add tag Angel', 'Add tag Armor', 'Add tag Shield'])
  })

  it('never shows a tag among the archetypes, even when typed at it', () => {
    editor()

    fireEvent.change(screen.getByLabelText('Archetype'), { target: { value: 'Shield' } })

    // No existing archetype matches, so the only thing on offer is to create one.
    expect(options('comp-archetype-options')).toEqual(['Create archetype Shield'])
  })

  it('names each input for its namespace rather than both for searching', () => {
    editor()

    expect(screen.getByLabelText('Archetype')).toBeTruthy()
    expect(screen.getByLabelText('Tags')).toBeTruthy()
  })
})

describe('choosing an existing value', () => {
  it('sets the archetype, sending the whole shape the route takes', () => {
    const { onSave } = editor(null, ['Shield'])

    fireEvent.click(screen.getByRole('button', { name: 'Set archetype to Kite' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Shield'] })
  })

  it('adds a tag alongside the ones already applied', () => {
    const { onSave } = editor('Kite', ['Shield'])

    fireEvent.click(screen.getByRole('button', { name: 'Add tag Armor' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Shield', 'Armor'] })
  })

  it('does not offer a tag the comp already carries', () => {
    editor(null, ['Shield'])

    expect(options('comp-tags-options')).toEqual(['Add tag Angel', 'Add tag Armor'])
  })
})

describe('creating a new value', () => {
  it('offers to create what was typed once no existing value spells it', () => {
    const { onSave } = editor()

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Cheap' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))

    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Cheap'] })
  })

  it('takes what was typed on Enter, which is the whole gesture for a new value', () => {
    const { onSave } = editor()

    const field = screen.getByLabelText('Tags')
    fireEvent.change(field, { target: { value: '  Cheap  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    // Tidied on the way through, so a stray space is not part of the name.
    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Cheap'] })
  })

  it('does nothing on Enter in an empty box', () => {
    const { onSave } = editor()

    fireEvent.keyDown(screen.getByLabelText('Tags'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not offer to create a value that already exists in another case', () => {
    editor()

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'shield' } })

    // Only the existing one, spelled the team's way. The server would have normalized it to
    // exactly this, so offering "create shield" beside it would be a control that lies.
    expect(options('comp-tags-options')).toEqual(['Add tag Shield'])
  })
})

describe('taking a value off', () => {
  it('removes one tag and leaves the others', () => {
    const { onSave } = editor('Kite', ['Shield', 'Angel'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Shield' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Angel'] })
  })

  it('clears the archetype without touching the tags', () => {
    const { onSave } = editor('Kite', ['Shield'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear archetype Kite' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Shield'] })
  })

  it('offers one remove control per applied value, each named for its own namespace', () => {
    // The chips themselves carry no test id: the tile's band above already owns
    // `comp-archetype-chip` and `comp-tag-chip`, and a second element answering to those would
    // make both ambiguous. What is new here is the control, and it has a name.
    editor('Kite', ['Shield', 'Angel'])

    expect(screen.getByRole('button', { name: 'Clear archetype Kite' })).toBeTruthy()
    expect(screen.getAllByTestId('comp-tag-remove').length).toBe(3)
    expect(screen.getByRole('button', { name: 'Remove tag Angel' })).toBeTruthy()
  })
})

describe('closing', () => {
  it('closes on Escape from either box', () => {
    const { onClose } = editor()

    fireEvent.keyDown(screen.getByLabelText('Archetype'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes from the Done control', () => {
    const { onClose } = editor()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalled()
  })
})

describe('a team with no vocabulary yet', () => {
  it('offers no lists, only the ability to create', () => {
    editor(null, [], { archetypes: [], tags: [] })

    expect(screen.queryByTestId('comp-archetype-options')).toBeNull()
    expect(screen.queryByTestId('comp-tags-options')).toBeNull()

    fireEvent.change(screen.getByLabelText('Archetype'), { target: { value: 'Kite' } })
    expect(screen.getByTestId('comp-tag-create')).toBeTruthy()
  })
})
