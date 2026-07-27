// The chips band: what a comp says it is, and the controls that change it.
//
// Two namespaces side by side — archetype and tags — because §3.3 says they never cross-suggest.
// One "+ Tags" button hid that completely: you could not tell, until the tray was open, that a
// comp carries an archetype at all.
//
// Each namespace is named by its own empty placeholder rather than by a standing label, so the
// word costs nothing once there is a value to look at instead. The tags placeholder keeps a
// mark after that, because a group already full of chips does not need telling what it is.
//
// The interaction is BurnSun's fit tag bar, ported: a placeholder that becomes an input in the
// same place, matching values in a panel that floats over the tile, and a "create" line when
// what has been typed is new. Nothing opens below the tile and there is no Done button — the
// band is the editor. That is also why this replaced TagEditor rather than moving it: a tray
// with its own dismissal was the thing being removed, not the thing being restyled.
//
// Pure: handed the current values and the team's two vocabularies, and it calls back. It
// fetches nothing and normalizes nothing — the server decides how a value is spelled.

import { useEffect, useRef, useState } from 'react'

import { chipVars, suggest, tidy } from './tag-model'
import type { Suggestions, TagVocabulary } from './tag-model'

/** Which of the two placeholders is currently a field. At most one, ever. */
type Slot = 'archetype' | 'tags'

interface Props {
  readonly archetype: string | null
  readonly tags: readonly string[]
  /** Every value already in use on the team, which is what §3.3 means by a suggestion. */
  readonly vocabulary: TagVocabulary
  /**
   * Called with the whole of what the comp should say, because the write is wholesale.
   *
   * Absent for a viewer, and that absence is what makes the band read-only — there is no
   * separate `editable` flag to get out of step with it.
   */
  readonly onSave?: (next: { archetype: string | null; tags: string[] }) => void
  /**
   * The comp these controls belong to, for their accessible names. A board of twenty
   * otherwise offers twenty buttons called "Add tag", which is one button nobody can address.
   */
  readonly compName: string
}

export default function TagBar({ archetype, tags, vocabulary, onSave, compName }: Props) {
  const [open, setOpen] = useState<Slot | null>(null)
  const [query, setQuery] = useState('')

  const editable = onSave !== undefined
  const says = archetype !== null || tags.length > 0

  // A viewer on a comp that says nothing gets the band as a reserved spacer, exactly as before:
  // the height was held open through Phases E–G so that a comp acquiring an archetype is a
  // change of content rather than a relayout, and two labels with nothing after them would be
  // chrome shown to somebody who cannot act on it.
  if (!editable && !says) {
    return (
      <div className="chipsrow chipsrow-reserved" data-testid="comp-chips" aria-hidden="true" />
    )
  }

  function show(slot: Slot) {
    setQuery('')
    setOpen(slot)
  }

  function close() {
    setQuery('')
    setOpen(null)
  }

  function setArchetype(next: string | null) {
    close()
    onSave?.({ archetype: next, tags: [...tags] })
  }

  function addTag(value: string) {
    close()
    onSave?.({ archetype, tags: [...tags, value] })
  }

  function removeTag(value: string) {
    onSave?.({ archetype, tags: tags.filter((tag) => tag !== value) })
  }

  return (
    <div className="chips chipsrow tagbar" data-testid="comp-chips">
      {/* No standing labels. The placeholder says the namespace itself, so the word is only on
          screen while it is the only thing there is to say — once a value is applied, the chip
          takes the space the label was using. That is the whole reason a 320px row can carry
          two namespaces at all. */}
      <div className="tagbar-group">
        {archetype && (
          <Chip
            value={archetype}
            archetypeChip
            testId="comp-archetype-chip"
            removeLabel={`Clear archetype ${archetype}`}
            onRemove={editable ? () => setArchetype(null) : undefined}
          />
        )}
        {/* Only when unset: there is one archetype, so a "+" beside an applied one would be a
            second control for a value that can only be replaced. Clearing it brings this back. */}
        {editable && !archetype && (
          <Picker
            open={open === 'archetype'}
            query={query}
            onQuery={setQuery}
            onOpen={() => show('archetype')}
            onClose={close}
            onCommit={setArchetype}
            found={suggest(query, vocabulary.archetypes, [])}
            // The word, always: an archetype placeholder only ever shows when none is set, so
            // there is never a chip beside it to say what the namespace is.
            addWord="Archetype"
            addLabel={`Add archetype to ${compName}`}
            fieldLabel="Archetype"
            addTestId="comp-archetype-add"
            inputTestId="comp-archetype-input"
            optionsTestId="comp-archetype-options"
            optionsLabel="Matching archetypes"
            // "Set", not "Add": there is only ever one.
            verb="Set archetype to"
            createVerb="Create archetype"
          />
        )}
      </div>

      <div className="tagbar-group">
        {tags.map((tag) => (
          <Chip
            key={tag}
            value={tag}
            testId="comp-tag-chip"
            removeLabel={`Remove tag ${tag}`}
            onRemove={editable ? () => removeTag(tag) : undefined}
          />
        ))}
        {editable && (
          <Picker
            open={open === 'tags'}
            query={query}
            onQuery={setQuery}
            onOpen={() => show('tags')}
            onClose={close}
            onCommit={addTag}
            found={suggest(query, vocabulary.tags, tags)}
            // The word only while it is the only thing in the group. Once a chip is there the
            // namespace is self-evident, and repeating "Tags" beside "Shield" would cost the
            // room the next tag needs — so it falls back to the mark.
            addWord={tags.length === 0 ? 'Tags' : null}
            addLabel={`Add tags to ${compName}`}
            fieldLabel="Tags"
            addTestId="comp-tags-add"
            inputTestId="comp-tags-input"
            optionsTestId="comp-tags-options"
            optionsLabel="Matching tags"
            verb="Add tag"
            createVerb="Create tag"
          />
        )}
      </div>
    </div>
  )
}

/**
 * One applied value, with the control that takes it off.
 *
 * The test id sits on the label rather than on the chip, deliberately: every caller reads it as
 * "the element whose text is the value", and hanging it on the chip would fold the remove
 * button's "×" into that text. The chip is what carries the colour; the label is what says the
 * word.
 *
 * The remove control's name says the value **and** what removing it does — a button called
 * "Shield" beside a chip reading "Shield" is two things answering to one name.
 */
function Chip({
  value,
  archetypeChip,
  testId,
  removeLabel,
  onRemove,
}: {
  readonly value: string
  readonly archetypeChip?: boolean
  readonly testId: string
  readonly removeLabel: string
  readonly onRemove?: () => void
}) {
  return (
    <span
      // Both kinds say which they are, rather than one being "the chip that is not the other":
      // the two are styled apart, and a rule keyed on the absence of a class would also catch
      // every chip drawn outside this band.
      className={`chip ${archetypeChip ? 'arch' : 'tag'}`}
      // The pill, as against the value inside it. A distinct kind gets a distinct id (§6.8),
      // and this is the one a driver needs: the remove control is collapsed to nothing until
      // the pill is hovered, so the pill is the only thing there is to hover.
      data-testid="comp-chip"
      style={chipVars(value)}
    >
      {/* Only the archetype draws a dot, and it is now the whole of what tells the two kinds
          apart: both borders are solid, because dashed is the band's word for "nothing here
          yet" and spending it on a tag dressed a value as a placeholder. The dot is on the
          archetype rather than the tags because it is the heavier mark and the archetype is the
          more important thing — one per comp, against any number of tags. */}
      {archetypeChip && <span className="cdot" />}
      <span className="chip-label" data-testid={testId}>
        {value}
      </span>
      {onRemove && (
        <button
          className="chip-x"
          data-testid="comp-tag-remove"
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  )
}

/**
 * Lucide's `tag`, inlined the way this app's other marks are.
 *
 * No icon package, and not for want of one: every glyph in here — the thread, the fork, the
 * share — is a Lucide path written out by hand at 24×24 with a 2px stroke, which is what keeps
 * a UI dependency out of a build whose only runtime dependency is React.
 */
function TagGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  )
}

/**
 * A placeholder that becomes a field: BurnSun's `.fit-tag-editor-slot`.
 *
 * The placeholder and the input occupy the same slot, so the field arrives where the control
 * was rather than somewhere else on the tile. Focus is watched on the slot rather than on the
 * input because the menu is part of the control: React's onFocus/onBlur are focusin/focusout,
 * so they carry the move from the field to an option — a move *within* this, which must not
 * read as leaving it. Same shape as ShipSearch, for the same reasons.
 *
 * The placeholder stays mounted while the field is open, hidden but still taking its space.
 * That is what stops the slot collapsing to nothing under the floating field and shunting the
 * other placeholder sideways — and a control that moves between mousedown and mouseup never
 * receives the click at all.
 */
function Picker({
  open,
  query,
  onQuery,
  onOpen,
  onClose,
  onCommit,
  found,
  addWord,
  addLabel,
  fieldLabel,
  addTestId,
  inputTestId,
  optionsTestId,
  optionsLabel,
  verb,
  createVerb,
}: {
  readonly open: boolean
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly onOpen: () => void
  readonly onClose: () => void
  readonly onCommit: (value: string) => void
  readonly found: Suggestions
  /** The namespace, spelled out — or null to fall back to the tag mark. */
  readonly addWord: string | null
  readonly addLabel: string
  readonly fieldLabel: string
  readonly addTestId: string
  readonly inputTestId: string
  readonly optionsTestId: string
  readonly optionsLabel: string
  readonly verb: string
  readonly createVerb: string
}) {
  const field = useRef<HTMLInputElement>(null)

  // Focused deliberately rather than with the `autoFocus` attribute: the field only exists
  // because somebody just asked for it, so the cursor belongs in it — but saying it here makes
  // that a decision about this control rather than a blanket attribute.
  useEffect(() => {
    if (!open) return
    field.current?.focus()
  }, [open])

  const showing = found.options.length > 0 || found.create !== null

  return (
    <div
      className={`tagbar-slot${open ? ' tagbar-slot-open' : ''}`}
      // Kept out of a copied picture, both of them. What a comp *says* it is belongs in the
      // image; the two invitations to say something do not, and a band that is nothing but
      // placeholders collapses out of the picture entirely rather than leaving a gap.
      data-capture-exclude="true"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        onClose()
      }}
    >
      <button
        className={`tagbar-add${addWord === null ? ' tagbar-add-mark' : ''}`}
        data-testid={addTestId}
        type="button"
        // The visible word is inside the accessible name rather than beside it, so a person
        // driving this by voice can say what they can see (WCAG 2.5.3). "Add tags to Alpha"
        // rather than "Add tag to Alpha" for exactly that reason.
        aria-label={addLabel}
        // Hidden but still holding its width while the field is over it, so it must not also
        // be a tab stop.
        tabIndex={open ? -1 : undefined}
        onClick={onOpen}
      >
        {addWord ?? <TagGlyph />}
      </button>

      {/* Floated over the placeholder rather than replacing it in the flow — see the note on
          this component. */}
      {open && (
        <div className="tagbar-editor">
          <input
            className="tagbar-input"
            data-testid={inputTestId}
            ref={field}
            type="text"
            value={query}
            // Named for the namespace rather than "Search": two boxes called the same thing would
            // be two controls nothing could tell apart.
            aria-label={fieldLabel}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Clears first and closes second, as ShipSearch does: emptying a field somebody has
                // typed into is the smaller of the two things Escape could mean.
                if (query !== '') onQuery('')
                else onClose()
                return
              }
              if (event.key !== 'Enter') return
              event.preventDefault()
              const typed = tidy(query)
              if (typed) onCommit(typed)
            }}
          />

          {showing && (
            <ul className="tagbar-menu" data-testid={optionsTestId} aria-label={optionsLabel}>
              {found.options.map((option) => (
                <li key={option}>
                  <button
                    className="tagbar-option"
                    type="button"
                    // Named for the act, not just the value: the bare value collides with the
                    // chip's own remove control and with the same value offered in the other box.
                    aria-label={`${verb} ${option}`}
                    // Keeps the cursor in the field, which is what makes picking survive the
                    // dismiss-on-blur above in every browser rather than only the ones that focus a
                    // button on mousedown. The click still fires.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onCommit(option)}
                  >
                    <span className="cdot" style={chipVars(option)} />
                    {option}
                  </button>
                </li>
              ))}
              {found.create !== null && (
                <li>
                  <button
                    className="tagbar-option tagbar-create"
                    data-testid="comp-tag-create"
                    type="button"
                    aria-label={`${createVerb} ${found.create}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onCommit(found.create as string)}
                  >
                    {createVerb} “{found.create}”
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
