import { useEffect, useMemo, useState } from 'react'
import { ToolLayout, Button, Icons } from '../components/ToolShell'
import { Card } from '../components/Card'
import { Select } from '../components/Select'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { ImapAccount, EmailHeader, ScanRange, ScanResult } from '../lib/api'
import { EmailCleanerGroups, groupBySender } from './EmailCleanerGroups'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
}

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

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const fieldClass =
  'h-9 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-text-primary outline-none transition focus:border-accent'

export function EmailCleanerPage({ onBack }: Props) {
  const [accounts, setAccounts] = useState<ImapAccount[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(CLOSED_FORM)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const [rangeMode, setRangeMode] = useState<'dateRange' | 'lastDays'>('lastDays')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [lastDays, setLastDays] = useState('30')

  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [emails, setEmails] = useState<EmailHeader[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [permanent, setPermanent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('Pick an account and a date range, then scan the inbox.')

  // Load saved accounts on first mount.
  useEffect(() => {
    window.api.imap
      .listAccounts()
      .then((list) => {
        setAccounts(list)
        setSelectedId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch((e) => setStatus(`Could not load accounts: ${String(e)}`))
  }, [])

  const groups = useMemo(() => (emails ? groupBySender(emails) : []), [emails])

  // ---------- account form ----------

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

  const formValid =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    form.password.length > 0 &&
    Number(form.port) > 0

  async function saveAccount() {
    if (!formValid) return
    try {
      const saved = await window.api.imap.saveAccount(formAccountInput())
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      setSelectedId(saved.id)
      closeForm()
      setStatus(`Account "${saved.label}" saved.`)
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
      setSelectedId(saved.id)
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
    try {
      await window.api.imap.deleteAccount(selectedId)
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      setSelectedId(list[0]?.id ?? null)
      setEmails(null)
      setSelected(new Set())
      setExpanded(new Set())
      setStatus('Account removed.')
    } catch (e) {
      setStatus(`Could not remove account: ${String(e)}`)
    }
  }

  // ---------- scan ----------

  function buildRange(): ScanRange | string {
    if (rangeMode === 'dateRange') {
      if (!dateFrom || !dateTo) return 'Pick both a start and an end date.'
      return { mode: 'dateRange', from: dateFrom, to: dateTo }
    }
    const days = Number(lastDays)
    if (!Number.isInteger(days) || days < 1) return 'Enter a whole number of days (1 or more).'
    return { mode: 'lastDays', days }
  }

  async function handleScan() {
    if (!selectedId || running) return
    const range = buildRange()
    if (typeof range === 'string') {
      setStatus(range)
      return
    }
    setRunning(true)
    setStopping(false)
    setEmails(null)
    setSelected(new Set())
    setExpanded(new Set())
    setStatus('Scanning inbox…')
    try {
      const result = await window.api.imap.scan(selectedId, range)
      setEmails(result.emails)
      if (result.cancelled) {
        setStatus(
          `Scan stopped — showing ${result.emails.length.toLocaleString()} ${
            result.emails.length === 1 ? 'email' : 'emails'
          } found before stopping.`
        )
      } else {
        setStatus(
          result.emails.length === 0
            ? 'No emails found in that range.'
            : `Found ${result.emails.length.toLocaleString()} emails from ${groupBySender(
                result.emails
              ).length} senders.`
        )
      }
    } catch (e) {
      setStatus(`Scan failed: ${String(e)}`)
    } finally {
      setRunning(false)
      setStopping(false)
    }
  }

  async function handleStop() {
    if (!running || stopping) return
    setStopping(true)
    setStatus('Stopping scan…')
    try {
      await window.api.imap.cancel()
    } catch {
      // ignore
    }
  }

  // ---------- selection ----------

  function toggleGroup(group: { emails: EmailHeader[] }) {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = group.emails.every((e) => next.has(e.uid))
      for (const e of group.emails) {
        if (allSelected) next.delete(e.uid)
        else next.add(e.uid)
      }
      return next
    })
  }

  function toggleEmail(uid: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function toggleExpand(addr: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(addr)) next.delete(addr)
      else next.add(addr)
      return next
    })
  }

  function selectAll() {
    if (!emails) return
    setSelected((prev) =>
      prev.size === emails.length ? new Set() : new Set(emails.map((e) => e.uid))
    )
  }

  // ---------- delete ----------

  async function confirmDelete() {
    if (!selectedId || selected.size === 0) return
    setConfirmOpen(false)
    setDeleting(true)
    const uids = [...selected]
    setStatus(permanent ? 'Permanently deleting emails…' : 'Moving emails to Trash…')
    try {
      const result = await window.api.imap.delete(selectedId, uids, permanent)
      const deletedSet = new Set(uids.filter((u) => !result.failed.includes(u)))
      setEmails((prev) => (prev ? prev.filter((e) => !deletedSet.has(e.uid)) : prev))
      setSelected(new Set())
      const base = `Deleted ${result.deleted.toLocaleString()} emails.`
      setStatus(
        result.failed.length > 0
          ? `${base} ${result.failed.length} could not be deleted.`
          : base
      )
    } catch (e) {
      setStatus(`Delete failed: ${String(e)}`)
    } finally {
      setDeleting(false)
    }
  }

  // ---------- render ----------

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.label }))
  const canScan = !!selectedId && !running
  const selectedCount = selected.size
  const allSelected = !!emails && emails.length > 0 && selectedCount === emails.length

  return (
    <ToolLayout
      title="Email Cleaner"
      onBack={onBack}
      onRun={canScan ? handleScan : undefined}
      running={running}
      banner={<span>{status}</span>}
      actions={
        running ? (
          <Button onClick={handleStop} variant="secondary" disabled={stopping}>
            <StopIcon />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button onClick={handleScan} variant="primary" disabled={!canScan}>
            <Icons.Play />
            Scan Inbox
          </Button>
        )
      }
    >
      {/* Left column: account + range setup */}
      <Card label="Setup">
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
          {/* Account section */}
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
                      onChange={setSelectedId}
                      ariaLabel="IMAP account"
                    />
                    <Button onClick={openEdit} variant="ghost" disabled={!selectedId}>
                      Edit
                    </Button>
                    <Button onClick={removeAccount} variant="ghost" disabled={!selectedId}>
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
                  placeholder="Username (full email address)"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  spellCheck={false}
                />
                <input
                  className={fieldClass}
                  type="password"
                  placeholder={form.mode === 'edit' ? 'Password (re-enter to change)' : 'Password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <p className="text-[11px] leading-snug text-text-muted">
                  Gmail and Outlook accounts with 2-step verification need an
                  app password, not your normal password. The password is stored
                  in the Windows Credential Manager.
                </p>
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
          </div>

          {/* Range section */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Scan range
            </span>
            <div className="flex gap-1 rounded-lg border border-border bg-surface-2/40 p-1">
              <button
                onClick={() => setRangeMode('lastDays')}
                className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${
                  rangeMode === 'lastDays'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Last N days
              </button>
              <button
                onClick={() => setRangeMode('dateRange')}
                className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${
                  rangeMode === 'dateRange'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Date range
              </button>
            </div>
            {rangeMode === 'lastDays' ? (
              <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <span>Scan the last</span>
                <input
                  className={`${fieldClass} w-20`}
                  value={lastDays}
                  onChange={(e) => setLastDays(e.target.value)}
                  inputMode="numeric"
                />
                <span>days</span>
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
                  <span>From</span>
                  <input
                    type="date"
                    className={`${fieldClass} flex-1`}
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
                  <span>To</span>
                  <input
                    type="date"
                    className={`${fieldClass} flex-1`}
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Right column: results */}
      <Card
        label="Inbox"
        badge={emails ? emails.length.toLocaleString() : '—'}
      >
        {emails === null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Scan an inbox to see emails grouped by sender.
          </div>
        ) : emails.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
            No emails found in that date range.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={selectAll}
                className="text-[12px] text-accent hover:underline"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              <span className="flex-1 text-right text-[12px] text-text-secondary">
                {selectedCount.toLocaleString()} selected
              </span>
            </div>
            <EmailCleanerGroups
              groups={groups}
              selected={selected}
              expanded={expanded}
              onToggleGroup={toggleGroup}
              onToggleEmail={toggleEmail}
              onToggleExpand={toggleExpand}
            />
            <div className="flex items-center gap-3 border-t border-border p-3">
              <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={permanent}
                  onChange={(e) => setPermanent(e.target.checked)}
                  className="h-4 w-4 accent-danger"
                />
                Delete Permanently
              </label>
              <span className="flex-1" />
              <Button
                onClick={() => setConfirmOpen(true)}
                variant="primary"
                disabled={selectedCount === 0 || deleting}
              >
                <Icons.Trash />
                {deleting
                  ? 'Deleting…'
                  : `Delete ${selectedCount.toLocaleString()} ${
                      selectedCount === 1 ? 'email' : 'emails'
                    }`}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={permanent ? 'Delete permanently?' : 'Move to Trash?'}
        message={
          permanent
            ? `${selectedCount} ${
                selectedCount === 1 ? 'email' : 'emails'
              } will be permanently removed and cannot be recovered.`
            : `${selectedCount} ${
                selectedCount === 1 ? 'email' : 'emails'
              } will be moved to the Trash folder.`
        }
        detail={
          permanent
            ? 'This empties them straight from the server, bypassing Trash.'
            : 'You can still recover them from Trash in your mail client.'
        }
        confirmLabel={permanent ? 'Delete permanently' : 'Move to Trash'}
        danger={permanent}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </ToolLayout>
  )
}
