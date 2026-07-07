import type { ImapAccount, ImapAccountInput } from './api'

/**
 * Shared in-memory cache of the saved IMAP accounts. The backend list is
 * fetched once per app run; every later read is served from memory, and
 * account mutations refresh the cache and notify all subscribers — so the
 * Email Cleaner and Email Unsubscribe pickers stay in lockstep without each
 * refetching on mount.
 */

let cache: ImapAccount[] | null = null
let inflight: Promise<ImapAccount[]> | null = null
const listeners = new Set<(accounts: ImapAccount[]) => void>()

function publish(list: ImapAccount[]): ImapAccount[] {
  cache = list
  for (const cb of listeners) cb(list)
  return list
}

export function getAccounts(): Promise<ImapAccount[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = window.api.imap
      .listAccounts()
      .then(publish)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export async function saveAccount(input: ImapAccountInput): Promise<ImapAccount> {
  const saved = await window.api.imap.saveAccount(input)
  publish(await window.api.imap.listAccounts())
  return saved
}

export async function deleteAccount(id: string): Promise<void> {
  await window.api.imap.deleteAccount(id)
  publish(await window.api.imap.listAccounts())
}

/** Notifies on every cache update; returns the unsubscribe function. */
export function subscribe(cb: (accounts: ImapAccount[]) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Test-only: clear module state between vitest cases. */
export function _resetForTests(): void {
  cache = null
  inflight = null
  listeners.clear()
}
