// @vitest-environment jsdom

// The chips band, rendered.
//
// `tag-model.test.ts` already proves which values get suggested, so nothing here re-checks a
// filter. What these cover is the part the model cannot: that the two namespaces are two
// separate placeholders, that only one of them is ever a field, that picking one writes the
// *whole* shape the route takes, and that everything is reachable by role and name — which is
// the same contract a browser driver works through.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TagBar from './TagBar'

afterEach(cleanup)

const VOCABULARY = {
  archetypes: ['Brawl', 'Kite'],
  tags: ['Angel', 'Armor', 'Shield'],
}

function bar(
  archetype: string | null = null,
  tags: string[] = [],
  vocabulary = VOCABULARY,
  editable = true,
) {
  const onSave = vi.fn()
  render(
    <TagBar
      archetype={archetype}
      tags={tags}
      vocabulary={vocabulary}
      onSave={editable ? onSave : undefined}
      compName="Alpha"
    />,
  )
  return { onSave }
}

/** Click a placeholder open and hand back the field it became. */
function openArchetype() {
  fireEvent.click(screen.getByRole('button', { name: 'Add archetype to Alpha' }))
  return screen.getByLabelText('Archetype')
}

function openTags() {
  fireEvent.click(screen.getByRole('button', { name: 'Add tags to Alpha' }))
  return screen.getByLabelText('Tags')
}

const options = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))

describe('the two placeholders', () => {
  it('are both offered before anything has been typed', () => {
    // The whole point of the change: a comp says two different things, and you can see that
    // without opening anything.
    bar()

    expect(screen.getByRole('button', { name: 'Add archetype to Alpha' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add tags to Alpha' })).toBeTruthy()
  })

  it('name themselves for the comp, because a board draws twenty of them', () => {
    bar()

    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull()
  })

  it('say which namespace they are, rather than leaning on a standing label', () => {
    // There are no labels any more: an empty placeholder is the only thing naming its group, so
    // it has to carry the word itself.
    bar()

    expect(screen.getByTestId('comp-archetype-add').textContent).toBe('Archetype')
    expect(screen.getByTestId('comp-tags-add').textContent).toBe('Tags')
  })

  it('drops the word once the group has a chip to speak for it', () => {
    // "Tags" beside "Shield" is a label for something already labelled, and it costs the room
    // the next tag needs. The mark stands in.
    bar(null, ['Shield'])

    expect(screen.getByTestId('comp-tags-add').textContent).toBe('')
    expect(screen.getByTestId('comp-tags-add').querySelector('svg')).toBeTruthy()
  })

  it('keeps the visible word inside the accessible name, for anyone driving it by voice', () => {
    // WCAG 2.5.3: someone saying "add tags" should reach the control that reads "Tags".
    bar()

    const tags = screen.getByTestId('comp-tags-add')
    expect(tags.getAttribute('aria-label')?.toLowerCase()).toContain(
      String(tags.textContent).toLowerCase(),
    )
    const archetype = screen.getByTestId('comp-archetype-add')
    expect(archetype.getAttribute('aria-label')?.toLowerCase()).toContain(
      String(archetype.textContent).toLowerCase(),
    )
  })

  it('keeps the placeholder in place while its field is over it', () => {
    // It is holding the slot's width. If it unmounted, the slot would collapse and the other
    // placeholder would jump sideways — under whatever cursor was on its way to click it.
    bar()
    openTags()

    const placeholder = screen.getByTestId('comp-tags-add')
    expect(placeholder).toBeTruthy()
    // Held for its width only: not a tab stop while it cannot be seen or clicked.
    expect(placeholder.getAttribute('tabindex')).toBe('-1')
  })

  it('are two lists, so neither can offer the other’s values', () => {
    // §3.3's "never cross-suggest", made structural rather than enforced by a filter.
    bar()
    openArchetype()

    expect(options('comp-archetype-options')).toEqual([
      'Set archetype to Brawl',
      'Set archetype to Kite',
    ])

    openTags()
    expect(options('comp-tags-options')).toEqual(['Add tag Angel', 'Add tag Armor', 'Add tag Shield'])
  })

  it('never shows a tag among the archetypes, even when typed at it', () => {
    bar()

    fireEvent.change(openArchetype(), { target: { value: 'Shield' } })

    // No existing archetype matches, so the only thing on offer is to create one.
    expect(options('comp-archetype-options')).toEqual(['Create archetype Shield'])
  })

  it('names each field for its namespace rather than both for searching', () => {
    bar()

    expect(openArchetype()).toBeTruthy()
    expect(openTags()).toBeTruthy()
  })

  it('opens one at a time, so there is never a stray field to wonder about', () => {
    bar()
    openArchetype()

    openTags()

    expect(screen.queryByLabelText('Archetype')).toBeNull()
    expect(screen.getByLabelText('Tags')).toBeTruthy()
  })

  it('starts each one empty rather than carrying the last query across', () => {
    bar()
    fireEvent.change(openArchetype(), { target: { value: 'Kit' } })

    expect(openTags()).toHaveProperty('value', '')
  })
})

describe('choosing an existing value', () => {
  it('sets the archetype, sending the whole shape the route takes', () => {
    const { onSave } = bar(null, ['Shield'])
    openArchetype()

    fireEvent.click(screen.getByRole('button', { name: 'Set archetype to Kite' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Shield'] })
  })

  it('adds a tag alongside the ones already applied', () => {
    const { onSave } = bar('Kite', ['Shield'])
    openTags()

    fireEvent.click(screen.getByRole('button', { name: 'Add tag Armor' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Shield', 'Armor'] })
  })

  it('does not offer a tag the comp already carries', () => {
    bar(null, ['Shield'])
    openTags()

    expect(options('comp-tags-options')).toEqual(['Add tag Angel', 'Add tag Armor'])
  })

  it('closes the placeholder once something has been picked', () => {
    bar()
    openTags()

    fireEvent.click(screen.getByRole('button', { name: 'Add tag Angel' }))

    expect(screen.queryByLabelText('Tags')).toBeNull()
  })
})

describe('creating a new value', () => {
  it('offers to create what was typed once no existing value spells it', () => {
    const { onSave } = bar()

    fireEvent.change(openTags(), { target: { value: 'Cheap' } })
    fireEvent.click(screen.getByTestId('comp-tag-create'))

    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Cheap'] })
  })

  it('takes what was typed on Enter, which is the whole gesture for a new value', () => {
    const { onSave } = bar()

    const field = openTags()
    fireEvent.change(field, { target: { value: '  Cheap  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    // Tidied on the way through, so a stray space is not part of the name.
    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Cheap'] })
  })

  it('does nothing on Enter in an empty box', () => {
    const { onSave } = bar()

    fireEvent.keyDown(openTags(), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not offer to create a value that already exists in another case', () => {
    bar()

    fireEvent.change(openTags(), { target: { value: 'shield' } })

    // Only the existing one, spelled the team's way. The server would have normalized it to
    // exactly this, so offering "create shield" beside it would be a control that lies.
    expect(options('comp-tags-options')).toEqual(['Add tag Shield'])
  })
})

describe('taking a value off', () => {
  it('removes one tag and leaves the others', () => {
    const { onSave } = bar('Kite', ['Shield', 'Angel'])

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Shield' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: 'Kite', tags: ['Angel'] })
  })

  it('clears the archetype without touching the tags', () => {
    const { onSave } = bar('Kite', ['Shield'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear archetype Kite' }))

    expect(onSave).toHaveBeenCalledWith({ archetype: null, tags: ['Shield'] })
  })

  it('offers one remove control per applied value, each named for its own namespace', () => {
    bar('Kite', ['Shield', 'Angel'])

    expect(screen.getByRole('button', { name: 'Clear archetype Kite' })).toBeTruthy()
    expect(screen.getAllByTestId('comp-tag-remove').length).toBe(3)
    expect(screen.getByRole('button', { name: 'Remove tag Angel' })).toBeTruthy()
  })

  it('keeps the chip’s test id on the value alone, not on the value plus its ×', () => {
    // Every caller reads these as "the element whose text is the value". Hanging the id on the
    // chip would fold the remove control's glyph into that text.
    bar('Kite', ['Shield'])

    expect(screen.getByTestId('comp-archetype-chip').textContent).toBe('Kite')
    expect(screen.getByTestId('comp-tag-chip').textContent).toBe('Shield')
  })
})

describe('the archetype placeholder', () => {
  it('offers nothing to add while one is set, because there is only ever one', () => {
    // Picking a second would replace the first, so a "+" beside an applied archetype would be a
    // control whose name lies about what it does. Clearing brings it back.
    bar('Kite')

    expect(screen.queryByRole('button', { name: 'Add archetype to Alpha' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add tags to Alpha' })).toBeTruthy()
  })
})

describe('dismissing a placeholder', () => {
  it('empties the field on Escape before it closes anything', () => {
    bar()
    const field = openTags()
    fireEvent.change(field, { target: { value: 'Chea' } })

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(screen.getByLabelText('Tags')).toHaveProperty('value', '')
  })

  it('closes on Escape from an empty field', () => {
    bar()
    const field = openTags()

    fireEvent.keyDown(field, { key: 'Escape' })

    expect(screen.queryByLabelText('Tags')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add tags to Alpha' })).toBeTruthy()
  })

  it('closes when focus leaves it, so an abandoned field does not sit open', () => {
    bar()
    const field = openTags()

    fireEvent.focusOut(field, { relatedTarget: document.body })

    expect(screen.queryByLabelText('Tags')).toBeNull()
  })

  it('stays open while focus moves into its own menu', () => {
    // The menu is part of the control. Treating that move as leaving would close the panel
    // between mousedown and click and eat every pick made with a mouse.
    bar()
    const field = openTags()

    fireEvent.focusOut(field, {
      relatedTarget: screen.getByRole('button', { name: 'Add tag Angel' }),
    })

    expect(screen.getByLabelText('Tags')).toBeTruthy()
  })
})

describe('a viewer', () => {
  it('sees what the comp says and no way to change it', () => {
    bar('Kite', ['Shield'], VOCABULARY, false)

    expect(screen.getByTestId('comp-archetype-chip').textContent).toBe('Kite')
    expect(screen.getByTestId('comp-tag-chip').textContent).toBe('Shield')
    expect(screen.queryByTestId('comp-tag-remove')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add tags to Alpha' })).toBeNull()
  })

  it('gets a reserved spacer, not two empty labels, on a comp that says nothing', () => {
    // The band's height was held open so a comp acquiring an archetype is a change of content
    // rather than a relayout — and labels above nothing are chrome for somebody who cannot act.
    bar(null, [], VOCABULARY, false)

    const band = screen.getByTestId('comp-chips')
    expect(band.className).toContain('chipsrow-reserved')
    expect(band.textContent).toBe('')
  })
})

describe('a team with no vocabulary yet', () => {
  it('offers no list, only the ability to create', () => {
    bar(null, [], { archetypes: [], tags: [] })
    openArchetype()

    expect(screen.queryByTestId('comp-archetype-options')).toBeNull()

    fireEvent.change(screen.getByLabelText('Archetype'), { target: { value: 'Kite' } })
    expect(screen.getByTestId('comp-tag-create')).toBeTruthy()
  })
})
