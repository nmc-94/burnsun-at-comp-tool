// Saying what a comp is: one archetype, any number of tags.
//
// Two boxes, not one, and that is the design rather than a layout accident. §3.3 says the
// Archetype and Tags namespaces never cross-suggest, and two inputs with two option lists make
// that visible in the markup — there is no filter to get wrong and no way for an archetype to
// appear where a tag belongs.
//
// The interaction is BurnSun's select-existing-or-create-new: type, matching values appear, and
// if what you typed is new a "create" option shows up. It reuses ShipSearch's shape — a plain
// input with a label and a list of buttons — rather than a hand-rolled combobox, because that
// is what already works here for a keyboard, a screen reader and a driver alike.
//
// Pure: it is handed the current values and the team's two vocabularies and calls back. It
// fetches nothing and normalizes nothing — the server decides how a value is spelled.

import { useEffect, useRef, useState } from 'react'

import { hueFor, suggest, tidy } from './tag-model'
import type { TagVocabulary } from './tag-model'

interface Props {
  readonly archetype: string | null
  readonly tags: readonly string[]
  /** Every value already in use on the team, which is what §3.3 means by a suggestion. */
  readonly vocabulary: TagVocabulary
  /** Called with the whole of what the comp should say, because the write is wholesale. */
  readonly onSave: (next: { archetype: string | null; tags: string[] }) => void
  readonly onClose: () => void
}

export default function TagEditor({ archetype, tags, vocabulary, onSave, onClose }: Props) {
  const [archetypeQuery, setArchetypeQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const first = useRef<HTMLInputElement>(null)

  // Focused here rather than with the autoFocus attribute, the way ShipSearch does it: this
  // panel only exists because somebody just asked for it, so the cursor belongs in it.
  useEffect(() => {
    first.current?.focus()
  }, [])

  // The archetype box suggests against every archetype except the one already applied, so
  // picking the value that is already set is never offered as a no-op.
  const archetypes = suggest(archetypeQuery, vocabulary.archetypes, archetype ? [archetype] : [])
  const tagOptions = suggest(tagQuery, vocabulary.tags, tags)

  function setArchetype(next: string | null) {
    setArchetypeQuery('')
    onSave({ archetype: next, tags: [...tags] })
  }

  function addTag(value: string) {
    setTagQuery('')
    onSave({ archetype, tags: [...tags, value] })
  }

  function removeTag(value: string) {
    onSave({ archetype, tags: tags.filter((tag) => tag !== value) })
  }

  /**
   * Enter takes what is typed; Escape shuts the panel.
   *
   * On the inputs rather than on a wrapper around them. A keydown handler on the panel div
   * would catch the same keys, but only because they happened to bubble from a control — and a
   * div with a key handler is not itself reachable, which is exactly what jsx-a11y objects to.
   * These are the two real controls in here, so this is where the keys belong.
   */
  function keys(query: string, commit: (value: string) => void) {
    return (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Enter') return
      event.preventDefault()
      const typed = tidy(query)
      if (typed) commit(typed)
    }
  }

  return (
    <div className="tageditor" data-testid="comp-tags-editor">
      <div className="tageditor-field">
        <span className="section-label">Archetype</span>
        {archetype && <Chip value={archetype} archetypeChip onRemove={() => setArchetype(null)} />}
        <input
          className="tageditor-input"
          data-testid="comp-archetype-input"
          ref={first}
          type="text"
          value={archetypeQuery}
          placeholder="Kite, Brawl…"
          // Named for the namespace rather than "Search": two boxes called the same thing
          // would be two controls nothing could tell apart.
          aria-label="Archetype"
          onChange={(event) => setArchetypeQuery(event.target.value)}
          onKeyDown={keys(archetypeQuery, setArchetype)}
        />
        <Options
          testId="comp-archetype-options"
          label="Matching archetypes"
          options={archetypes.options}
          create={archetypes.create}
          // "Set", not "Add": there is only ever one, so picking a second replaces the first.
          verb="Set archetype to"
          createVerb="Create archetype"
          onPick={setArchetype}
        />
      </div>

      <div className="tageditor-field">
        <span className="section-label">Tags</span>
        <div className="chips">
          {tags.map((tag) => (
            <Chip key={tag} value={tag} onRemove={() => removeTag(tag)} />
          ))}
        </div>
        <input
          className="tageditor-input"
          data-testid="comp-tags-input"
          type="text"
          value={tagQuery}
          placeholder="Shield, Angel…"
          aria-label="Tags"
          onChange={(event) => setTagQuery(event.target.value)}
          onKeyDown={keys(tagQuery, addTag)}
        />
        <Options
          testId="comp-tags-options"
          label="Matching tags"
          options={tagOptions.options}
          create={tagOptions.create}
          verb="Add tag"
          createVerb="Create tag"
          onPick={addTag}
        />
      </div>

      <button className="tageditor-done" data-testid="comp-tags-done" type="button" onClick={onClose}>
        Done
      </button>
    </div>
  )
}

/**
 * One applied value, with the control that takes it off.
 *
 * No `data-testid` on the chip itself, and that is deliberate: the tile's band above already
 * carries `comp-archetype-chip` and `comp-tag-chip` for the applied set, and a second element
 * answering to those ids would make both unusable — §6.8's rule that a distinct kind gets a
 * distinct id, read the other way round. What is *new* here is the remove control, and it is
 * reachable by its own name.
 *
 * That name says the value **and** what removing it does. A button called "Shield" beside a chip
 * reading "Shield" is two things answering to one name.
 */
function Chip({
  value,
  archetypeChip,
  onRemove,
}: {
  readonly value: string
  readonly archetypeChip?: boolean
  readonly onRemove: () => void
}) {
  return (
    <span
      className={`chip${archetypeChip ? ' arch' : ''}`}
      style={{ '--h': hueFor(value) } as React.CSSProperties}
    >
      {/* The archetype chip has no dot in the locked design — its dashed border is what
          distinguishes it — so only tags draw one. */}
      {!archetypeChip && <span className="cdot" />}
      {value}
      <button
        className="chip-x"
        data-testid="comp-tag-remove"
        type="button"
        aria-label={archetypeChip ? `Clear archetype ${value}` : `Remove tag ${value}`}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}

function Options({
  testId,
  label,
  options,
  create,
  verb,
  createVerb,
  onPick,
}: {
  readonly testId: string
  readonly label: string
  readonly options: readonly string[]
  readonly create: string | null
  readonly verb: string
  readonly createVerb: string
  readonly onPick: (value: string) => void
}) {
  if (options.length === 0 && create === null) return null

  return (
    <ul className="tageditor-options" data-testid={testId} aria-label={label}>
      {options.map((option) => (
        <li key={option}>
          <button
            className="tageditor-option"
            type="button"
            // Named for the act, not just the value: the bare value collides with the chip's
            // own remove control and with the same value offered in the other box.
            aria-label={`${verb} ${option}`}
            onClick={() => onPick(option)}
          >
            <span className="cdot" style={{ '--h': hueFor(option) } as React.CSSProperties} />
            {option}
          </button>
        </li>
      ))}
      {create !== null && (
        <li>
          <button
            className="tageditor-option tageditor-create"
            data-testid="comp-tag-create"
            type="button"
            aria-label={`${createVerb} ${create}`}
            onClick={() => onPick(create)}
          >
            {createVerb} “{create}”
          </button>
        </li>
      )}
    </ul>
  )
}
