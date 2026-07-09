import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetForTests,
  deleteAccount,
  getAccounts,
  saveAccount,
  subscribe
} from './imapAccountsCache'
import type { ImapAccount } from './api'

const acct = (id: string): ImapAccount => ({
  id,
  label: `Account ${id}`,
  host: 'imap.example.com',
  port: 993,
  username: `${id}@example.com`
})

let listAccountsApi: ReturnType<typeof vi.fn>
let saveAccountApi: ReturnType<typeof vi.fn>
let deleteAccountApi: ReturnType<typeof vi.fn>

beforeEach(() => {
  _resetForTests()
  listAccountsApi = vi.fn()
  saveAccountApi = vi.fn()
  deleteAccountApi = vi.fn()
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      imap: {
        listAccounts: listAccountsApi,
        saveAccount: saveAccountApi,
        deleteAccount: deleteAccountApi
      }
    }
  }
})

describe('getAccounts', () => {
  it('fetches once and serves the second call from the cache', async () => {
    listAccountsApi.mockResolvedValue([acct('a')])
    expect(await getAccounts()).toEqual([acct('a')])
    expect(await getAccounts()).toEqual([acct('a')])
    expect(listAccountsApi).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent callers into one backend call', async () => {
    listAccountsApi.mockResolvedValue([acct('a')])
    const [first, second] = await Promise.all([getAccounts(), getAccounts()])
    expect(first).toEqual([acct('a')])
    expect(second).toEqual([acct('a')])
    expect(listAccountsApi).toHaveBeenCalledTimes(1)
  })

  it('leaves the cache retryable after a failed fetch', async () => {
    listAccountsApi.mockRejectedValueOnce(new Error('imap down'))
    await expect(getAccounts()).rejects.toThrow('imap down')
    listAccountsApi.mockResolvedValue([acct('a')])
    expect(await getAccounts()).toEqual([acct('a')])
    expect(listAccountsApi).toHaveBeenCalledTimes(2)
  })
})

describe('mutations', () => {
  it('saveAccount saves, refreshes the cache once, notifies, and returns the saved account', async () => {
    saveAccountApi.mockResolvedValue(acct('new'))
    listAccountsApi.mockResolvedValue([acct('a'), acct('new')])
    const seen: ImapAccount[][] = []
    subscribe((list) => seen.push(list))

    const saved = await saveAccount({
      label: 'Account new',
      host: 'imap.example.com',
      port: 993,
      username: 'new@example.com',
      password: 'pw'
    })

    expect(saved).toEqual(acct('new'))
    expect(listAccountsApi).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([[acct('a'), acct('new')]])
    // The refreshed list is now the cache, no further backend call.
    expect(await getAccounts()).toEqual([acct('a'), acct('new')])
    expect(listAccountsApi).toHaveBeenCalledTimes(1)
  })

  it('deleteAccount deletes, refreshes, and notifies', async () => {
    deleteAccountApi.mockResolvedValue(undefined)
    listAccountsApi.mockResolvedValue([acct('b')])
    const seen: ImapAccount[][] = []
    subscribe((list) => seen.push(list))

    await deleteAccount('a')

    expect(deleteAccountApi).toHaveBeenCalledWith('a')
    expect(seen).toEqual([[acct('b')]])
    expect(await getAccounts()).toEqual([acct('b')])
    expect(listAccountsApi).toHaveBeenCalledTimes(1)
  })
})

describe('subscribe', () => {
  it('stops notifying after unsubscribe', async () => {
    deleteAccountApi.mockResolvedValue(undefined)
    listAccountsApi.mockResolvedValue([])
    const seen: ImapAccount[][] = []
    const unsubscribe = subscribe((list) => seen.push(list))
    unsubscribe()

    await deleteAccount('a')

    expect(seen).toEqual([])
  })
})
