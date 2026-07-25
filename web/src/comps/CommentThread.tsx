// One comp's conversation.
//
// Mounted only while it is open, which is what keeps a board of twenty tiles from making twenty
// thread requests: the cell renders this when someone asks for it and unmounts it when they are
// done, so the fetch happens on the gesture rather than on the board's first paint.
//
// It owns the whole thread's state, including its own loading and error reporting, for the
// reason every tile owns its comp: a board-level store of everyone's comments would put a
// keystroke in one thread's compose box on the common ancestor of all twenty.
//
// What may be edited or deleted is the *server's* answer — `yours` on each comment, plus the
// comp's `yourLevel` for moderation — not a comparison worked out here. A UI that decided for
// itself would be a second authorization rule to keep in step with the real one.

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageFor } from '../api'
import type { AccessLevel } from '../teams/types'
import { deleteComment, editComment, listComments, postComment } from './api'
import type { CommentDetail } from './types'

interface Props {
  readonly compId: string
  /** What the reader holds on the owning team. Only an owner moderates somebody else's note. */
  readonly yourLevel: AccessLevel
  /** Told when the thread grows or shrinks, so the tile's count keeps up with the panel. */
  readonly onCountChange?: (count: number) => void
}

export default function CommentThread({ compId, yourLevel, onCountChange }: Props) {
  const [comments, setComments] = useState<readonly CommentDetail[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // Held in a ref so the effects below do not have to list a caller's inline arrow as a
  // dependency and re-run every render because of it.
  const announce = useRef(onCountChange)
  announce.current = onCountChange

  const record = useCallback((next: readonly CommentDetail[]) => {
    setComments(next)
    announce.current?.(next.length)
  }, [])

  useEffect(() => {
    let cancelled = false
    setComments(null)
    setError(null)
    listComments(compId)
      .then((found) => {
        if (!cancelled) record(found)
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(messageFor(problem))
      })
    return () => {
      cancelled = true
    }
  }, [compId, record])

  async function run(action: () => Promise<readonly CommentDetail[]>) {
    setBusy(true)
    try {
      record(await action())
      setError(null)
    } catch (problem: unknown) {
      setError(messageFor(problem))
    } finally {
      setBusy(false)
    }
  }

  function post() {
    const body = draft.trim()
    if (!body || busy) return
    void run(async () => {
      const made = await postComment(compId, body)
      setDraft('')
      return [...(comments ?? []), made]
    })
  }

  function save(commentId: string, body: string) {
    const next = body.trim()
    if (!next || busy) return
    void run(async () => {
      const updated = await editComment(compId, commentId, next)
      setEditing(null)
      return (comments ?? []).map((comment) =>
        comment.id === commentId ? updated : comment,
      )
    })
  }

  function remove(commentId: string) {
    if (busy) return
    void run(async () => {
      await deleteComment(compId, commentId)
      return (comments ?? []).filter((comment) => comment.id !== commentId)
    })
  }

  return (
    <div className="thread" data-testid="comment-thread">
      {/* One live region for the panel. It says what state the thread is in rather than
          leaving a driver — or anyone not looking at it — to sleep and hope. */}
      <p
        className="thread-status"
        data-testid="comment-status"
        data-thread-state={threadState(comments, busy)}
        role="status"
      >
        {statusLabel(comments, busy)}
      </p>

      {comments !== null && comments.length > 0 && (
        <ul className="thread-list" aria-label="Comments">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              canModerate={yourLevel === 'owner'}
              editing={editing === comment.id}
              busy={busy}
              onEdit={() => setEditing(comment.id)}
              onCancelEdit={() => setEditing(null)}
              onSave={(body) => save(comment.id, body)}
              onDelete={() => remove(comment.id)}
            />
          ))}
        </ul>
      )}

      <div className="thread-new" data-testid="comment-new">
        <textarea
          className="thread-input"
          data-testid="comment-input"
          value={draft}
          rows={2}
          maxLength={4000}
          placeholder="Add a comment…"
          aria-label="New comment"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="thread-post"
          data-testid="comment-post"
          type="button"
          disabled={busy || draft.trim() === ''}
          onClick={post}
        >
          Comment
        </button>
      </div>

      {error && (
        <p className="err" data-testid="comment-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function Comment({
  comment,
  canModerate,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  readonly comment: CommentDetail
  readonly canModerate: boolean
  readonly editing: boolean
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onCancelEdit: () => void
  readonly onSave: (body: string) => void
  readonly onDelete: () => void
}) {
  const [body, setBody] = useState(comment.body)
  const author = comment.authorName ?? 'unknown'

  return (
    <li className="thread-item" data-testid="comment-item" data-comment-id={comment.id}>
      <div className="thread-meta">
        <span className="thread-author" data-testid="comment-author">
          {author}
        </span>
        {/* A machine-readable timestamp beside the readable one, so a driver asserts on the
            instant rather than on however this locale happens to spell it. */}
        <time className="thread-time" data-testid="comment-time" dateTime={comment.createdAt}>
          {when(comment.createdAt)}
        </time>
        {comment.updatedAt && (
          <span
            className="thread-edited faint"
            data-testid="comment-edited"
            // The edit's own instant, not the original's — the point of saying "edited" is
            // that the timestamp beside it is no longer the whole story.
            title={`Edited ${when(comment.updatedAt)}`}
          >
            edited
          </span>
        )}
      </div>

      {editing ? (
        <div className="thread-edit">
          <textarea
            className="thread-input"
            data-testid="comment-edit-input"
            value={body}
            rows={2}
            maxLength={4000}
            aria-label={`Edit comment by ${author}`}
            onChange={(event) => setBody(event.target.value)}
          />
          <button
            className="thread-act"
            data-testid="comment-save"
            type="button"
            disabled={busy || body.trim() === ''}
            onClick={() => onSave(body)}
          >
            Save
          </button>
          <button
            className="thread-act"
            data-testid="comment-cancel"
            type="button"
            onClick={() => {
              setBody(comment.body)
              onCancelEdit()
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="thread-body" data-testid="comment-body">
            {comment.body}
          </p>
          <div className="thread-acts">
            {/* Only the author edits, owner or not: moderating is removing something, never
                putting different words in somebody's mouth. */}
            {comment.yours && (
              <button
                className="thread-act"
                data-testid="comment-edit"
                type="button"
                // Named for whose comment it is, because a thread of ten otherwise offers ten
                // controls called "Edit".
                aria-label={`Edit comment by ${author}`}
                onClick={onEdit}
              >
                Edit
              </button>
            )}
            {(comment.yours || canModerate) && (
              <button
                className="thread-act"
                data-testid="comment-delete"
                type="button"
                disabled={busy}
                aria-label={`Delete comment by ${author}`}
                onClick={onDelete}
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </li>
  )
}

function threadState(comments: readonly CommentDetail[] | null, busy: boolean): string {
  if (comments === null) return 'loading'
  if (busy) return 'saving'
  return 'idle'
}

function statusLabel(comments: readonly CommentDetail[] | null, busy: boolean): string {
  if (comments === null) return 'Loading comments…'
  if (busy) return 'Saving…'
  if (comments.length === 0) return 'No comments yet'
  return comments.length === 1 ? '1 comment' : `${comments.length} comments`
}

/**
 * The timestamp as a date and a time, in whatever the browser is set to.
 *
 * Not "3 hours ago": a relative time that is rendered once and never re-rendered goes quietly
 * wrong the longer a board stays open, and this panel has no reason to hold a timer.
 */
function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
