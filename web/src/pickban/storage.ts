// A rehearsal, kept across a reload.
//
// `sessionStorage`, not `localStorage`, and the difference is the whole design: a rehearsal
// should survive an accidental refresh in the same sitting, and should not still be sitting
// there three weeks later, half finished, for somebody who has forgotten what they were
// working out. That lifetime is exactly what a session store means.
//
// Nothing here reaches the server, deliberately. §4.6 scopes solo mode as one person driving
// both sides to rehearse the phase, and nothing in that needs persistence — a lost rehearsal
// costs a re-run. The shared mode that *does* need a server-authoritative turn order arrives
// with its own design pass, and the table belongs there.

import { brand } from '../brand/brandConfig'
import type { BanProgress } from '../engine'

/** Per team, because the ruleset a rehearsal runs against is the team's. */
function keyFor(teamId: string): string {
  return `${brand.storageKeyPrefix}.pick-ban.${teamId}`
}

/**
 * The saved rehearsal, or null.
 *
 * Validated rather than trusted, and dropped whole when it fails. A stored blob is something
 * somebody wrote down earlier — the same instinct `workspace_layout` applies to saved comp
 * ids — and repairing half of one would restore a rehearsal to a state nobody was ever in.
 */
export function readProgress(teamId: string): BanProgress | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(keyFor(teamId))
  } catch {
    // sessionStorage unavailable; a rehearsal simply does not survive a reload.
    return null
  }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { bans, format } = parsed as { bans?: unknown; format?: unknown }
    if (format !== 'main' && format !== 'prelims') return null
    if (!Array.isArray(bans)) return null
    if (!bans.every((typeId) => typeof typeId === 'number' && Number.isFinite(typeId))) return null
    return { bans: bans as number[], format }
  } catch {
    return null
  }
}

export function writeProgress(teamId: string, progress: BanProgress): void {
  try {
    sessionStorage.setItem(keyFor(teamId), JSON.stringify(progress))
  } catch {
    // Ignore persistence failures: the rehearsal on screen is the real one.
  }
}

export function clearProgress(teamId: string): void {
  try {
    sessionStorage.removeItem(keyFor(teamId))
  } catch {
    // Ignore.
  }
}
