/** localStorage key for the user's favorited tool ids. */
const KEY = 'tools:favorites'

/**
 * Parse a stored favorites value into ids. `null` means nothing usable was
 * stored — missing, corrupt JSON, or the wrong shape — and callers treat it
 * as "no favorites" rather than erroring.
 */
export function parseFavorites(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    if (!parsed.every((id): id is string => typeof id === 'string')) return null
    return parsed
  } catch {
    return null
  }
}

/** Toggle `id` in the set. Returns a new set; the input is not mutated. */
export function toggleFavorite(favorites: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(favorites)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Favorited items first, then the rest, each group keeping the input's
 * relative order. Ids in `favorites` with no matching item are ignored.
 */
export function sortFavoritesFirst<T extends { id: string }>(
  items: readonly T[],
  favorites: ReadonlySet<string>
): T[] {
  const starred: T[] = []
  const rest: T[] = []
  for (const item of items) (favorites.has(item.id) ? starred : rest).push(item)
  return [...starred, ...rest]
}

/** Read the persisted favorites. Best-effort: unusable storage means none. */
export function loadFavorites(): Set<string> {
  try {
    return new Set(parseFavorites(localStorage.getItem(KEY)) ?? [])
  } catch {
    return new Set()
  }
}

/** Persist the favorites. Swallows quota / unavailable-storage errors. */
export function saveFavorites(favorites: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...favorites]))
  } catch {
    // Best-effort: unusable localStorage just means favorites reset next launch.
  }
}
