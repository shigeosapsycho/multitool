import { useEffect, useState } from 'react'
import { Button } from './ToolShell'
import { Select } from './Select'
import { ConfirmDialog } from './ConfirmDialog'
import type { ImapAccount } from '../lib/api'
import { providerFor } from '../lib/imapProviders'

type FormState = {
  mode: 'closed' | 'add' | 'edit'
  id: string | null
  label: string
  host: string
  port: string
  username: string
  password: string
}

const CLOSED_FORM: FormState = {
  mode: 'closed',
  id: null,
  label: '',
  host: '',
  port: '993',
  username: '',
  password: ''
}

const fieldClass =
  'h-9 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-text-primary outline-none transition focus:border-accent'

type Props = {
  /** The id of the currently chosen account, owned by the host page. */
  selectedId: string | null
  /** Called when the selection changes (dropdown, save, or remove). */
  onSelectedChange: (id: string | null) => void
  /** Optional: surface account-management status messages to the host page. */
  onStatus?: (msg: string) => void
}

/**
 * Saved-IMAP-account picker: a dropdown of stored accounts plus an inline
 * add/edit form with connection testing. Shared by the Email Cleaner and Email
 * Unsubscribe modules so the two stay in lockstep. The host page owns only the
 * selected account id; this component owns the account list and form state.
 */
export function ImapAccountPicker({ selectedId, onSelectedChange, onStatus }: Props) {
  const [accounts, setAccounts] = useState<ImapAccount[]>([])
  const [form, setForm] = useState<FormState>(CLOSED_FORM)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  // Load saved accounts once on mount; default the selection to the first one.
  useEffect(() => {
    window.api.imap
      .listAccounts()
      .then((list) => {
        setAccounts(list)
        if (selectedId == null) onSelectedChange(list[0]?.id ?? null)
      })
      .catch((e) => onStatus?.(`Could not load accounts: ${String(e)}`))
    // Mount-only: re-running on prop changes would fight the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openAdd() {
    setTestStatus(null)
    setForm({ ...CLOSED_FORM, mode: 'add' })
  }

  function openEdit() {
    const acc = accounts.find((a) => a.id === selectedId)
    if (!acc) return
    setTestStatus(null)
    setForm({
      mode: 'edit',
      id: acc.id,
      label: acc.label,
      host: acc.host,
      port: String(acc.port),
      username: acc.username,
      // The stored password never leaves the credential store; leaving this
      // blank keeps it as-is on save.
      password: ''
    })
  }

  function closeForm() {
    setForm(CLOSED_FORM)
    setTestStatus(null)
  }

  function formAccountInput() {
    return {
      id: form.id ?? undefined,
      label: form.label.trim() || form.username.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 993,
      username: form.username.trim(),
      password: form.password
    }
  }

  // When editing, an empty password means "keep the stored one" — but the
  // backend refuses that when the host or username changed (the stored
  // credential would be sent to a different server), so require a password
  // again in that case. A port-only change keeps the stored password.
  const editingAccount =
    form.mode === 'edit' ? (accounts.find((a) => a.id === form.id) ?? null) : null
  const canKeepStoredPassword =
    editingAccount != null &&
    form.host.trim() === editingAccount.host &&
    form.username.trim() === editingAccount.username

  const formValid =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    (form.password.length > 0 || canKeepStoredPassword) &&
    Number(form.port) > 0

  async function saveAccount() {
    if (!formValid) return
    try {
      const saved = await window.api.imap.saveAccount(formAccountInput())
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      onSelectedChange(saved.id)
      closeForm()
      onStatus?.(`Account "${saved.label}" saved.`)
    } catch (e) {
      setTestStatus(`Save failed: ${String(e)}`)
    }
  }

  async function testAccount() {
    if (!formValid) return
    setTesting(true)
    setTestStatus('Saving and testing connection…')
    try {
      // Save first so imap_test can read the credentials by id.
      const saved = await window.api.imap.saveAccount(formAccountInput())
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      onSelectedChange(saved.id)
      setForm((f) => ({ ...f, mode: 'edit', id: saved.id }))
      await window.api.imap.test(saved.id)
      setTestStatus('Connection works — account saved.')
    } catch (e) {
      setTestStatus(`Connection failed: ${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  async function removeAccount() {
    if (!selectedId) return
    setConfirmRemoveOpen(false)
    try {
      await window.api.imap.deleteAccount(selectedId)
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      onSelectedChange(list[0]?.id ?? null)
      onStatus?.('Account removed.')
    } catch (e) {
      onStatus?.(`Could not remove account: ${String(e)}`)
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.label }))

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        Account
      </span>
      {form.mode === 'closed' ? (
        <>
          {accounts.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select
                value={selectedId ?? ''}
                options={accountOptions}
                onChange={onSelectedChange}
                ariaLabel="IMAP account"
              />
              <Button onClick={openEdit} variant="ghost" disabled={!selectedId}>
                Edit
              </Button>
              <Button
                onClick={() => setConfirmRemoveOpen(true)}
                variant="ghost"
                disabled={!selectedId}
              >
                Remove
              </Button>
            </div>
          ) : (
            <span className="text-[12.5px] text-text-muted">
              No accounts yet. Add one to begin.
            </span>
          )}
          <Button onClick={openAdd} variant="secondary">
            Add account
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
          <input
            className={fieldClass}
            placeholder="Label (e.g. Work)"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <input
            className={fieldClass}
            placeholder="Email address"
            value={form.username}
            onChange={(e) => {
              const email = e.target.value
              const provider = providerFor(email)
              setForm((f) => ({
                ...f,
                username: email,
                ...(provider ? { host: provider.host, port: String(provider.port) } : {})
              }))
            }}
            spellCheck={false}
          />
          <input
            className={fieldClass}
            placeholder="IMAP host (e.g. imap.gmail.com)"
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            spellCheck={false}
          />
          <input
            className={fieldClass}
            placeholder="Port"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
            inputMode="numeric"
          />
          <input
            className={fieldClass}
            type="text"
            placeholder={
              form.mode === 'edit' ? 'leave blank to keep current password' : 'Password'
            }
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            spellCheck={false}
            autoComplete="off"
          />
          {testStatus && (
            <p className="text-[12px] leading-snug text-text-secondary">{testStatus}</p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={testAccount} variant="secondary" disabled={!formValid || testing}>
              {testing ? 'Testing…' : 'Test'}
            </Button>
            <Button onClick={saveAccount} variant="primary" disabled={!formValid}>
              Save
            </Button>
            <Button onClick={closeForm} variant="ghost">
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmRemoveOpen}
        title="Remove account?"
        message={
          <>
            Are you sure you want to delete{' '}
            <strong className="font-semibold text-text-primary">
              {selectedAccount?.username ?? selectedAccount?.label ?? 'this account'}
            </strong>
            ?
          </>
        }
        confirmLabel="Yes"
        cancelLabel="No"
        danger
        onConfirm={removeAccount}
        onCancel={() => setConfirmRemoveOpen(false)}
      />
    </div>
  )
}
