/** localStorage key for the tool ids this user has already been shown. */
const KEY = 'tools:seen'

/**
 * Tool ids present in `currentIds` that the user has never been shown.
 *
 * `seen === null` means no usable seen-list was stored — a first run, a corrupt
 * value, or no storage at all. All three mark nothing new, so the worst case is
 * a missing badge rather than every tool badged at once.
 */
export function computeNewToolIds(currentIds: string[], seen: string[] | null): string[] {
  if (seen === null) return []
  const known = new Set(seen)
  return currentIds.filter((id) => !known.has(id))
}

/** Read the seen list; null when missing or unreadable. Best-effort. */
function loadSeenToolIds(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    if (!parsed.every((id): id is string => typeof id === 'string')) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist the seen list. Swallows quota / unavailable-storage errors. */
function saveSeenToolIds(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Best-effort: unusable localStorage just means the badge shows again next launch.
  }
}

/** Ids still badged this session. Null until the first `getNewToolIds` call. */
let sessionNew: Set<string> | null = null

/**
 * The tools to badge as new, computed once per app launch.
 *
 * The seen list is rewritten immediately, so the badge lasts exactly one session
 * however the app exits — clean quit, crash, or kill. `Tools.tsx` calls this at
 * module scope; later calls reuse the same set, which `dismissNewTool` mutates.
 */
export function getNewToolIds(currentIds: string[]): Set<string> {
  if (!sessionNew) {
    sessionNew = new Set(computeNewToolIds(currentIds, loadSeenToolIds()))
    saveSeenToolIds(currentIds)
  }
  return sessionNew
}

/** Drop a tool's badge for the rest of the session, across page remounts. */
export function dismissNewTool(id: string): void {
  sessionNew?.delete(id)
}
