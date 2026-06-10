import { useEffect, useMemo, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ToolLayout, Button, Icons } from '../components/ToolShell'
import { Card } from '../components/Card'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ImapAccountPicker } from '../components/ImapAccountPicker'
import type { UnsubEmail, UnsubRunItem, UnsubTarget, ScanRange, EmailBody } from '../lib/api'
import { groupBySender } from './EmailCleanerGroups'
import { EmailUnsubscribeGroups, groupUnsubInfo } from './EmailUnsubscribeGroups'
import { EmailPreview } from './EmailPreview'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
}

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const fieldClass =
  'h-9 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-text-primary outline-none transition focus:border-accent'

export function EmailUnsubscribePage({ onBack, active }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [rangeMode, setRangeMode] = useState<'dateRange' | 'lastDays'>('lastDays')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [lastDays, setLastDays] = useState('30')

  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [emails, setEmails] = useState<UnsubEmail[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Map<string, UnsubRunItem>>(new Map())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [unsubscribing, setUnsubscribing] = useState(false)
  const [deleteEmails, setDeleteEmails] = useState(false)
  const [status, setStatus] = useState(
    'Pick an account and a date range, then scan for mailing lists.'
  )
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<{
    email: UnsubEmail
    body: EmailBody | null
    loading: boolean
    error: string | null
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UnsubEmail | null>(null)

  // When the chosen account changes, drop stale scan results.
  useEffect(() => {
    setEmails(null)
    setSelected(new Set())
    setExpanded(new Set())
    setResults(new Map())
    setSearch('')
  }, [selectedId])

  // All scanned senders grouped, and the search-narrowed subset shown.
  const allGroups = useMemo(() => (emails ? groupBySender(emails) : []), [emails])
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allGroups
    return allGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.addr.toLowerCase().includes(q) ||
        g.emails.some((e) => e.subject.toLowerCase().includes(q))
    )
  }, [allGroups, search])

  // Visible groups that can be unsubscribed in bulk (mailto-only ones can't).
  const selectableVisible = useMemo(
    () => groups.filter((g) => groupUnsubInfo(g).method !== 'email'),
    [groups]
  )
  const emailOnlyCount = useMemo(
    () => allGroups.filter((g) => groupUnsubInfo(g).method === 'email').length,
    [allGroups]
  )

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
    setResults(new Map())
    setSearch('')
    setStatus('Scanning inbox for mailing lists…')
    try {
      const result = await window.api.unsub.scan(selectedId, range)
      setEmails(result.emails)
      const senderCount = groupBySender(result.emails).length
      if (result.cancelled) {
        setStatus(
          `Scan stopped — found ${senderCount} ${
            senderCount === 1 ? 'sender' : 'senders'
          } before stopping.`
        )
      } else {
        setStatus(
          result.emails.length === 0
            ? 'No mail with an unsubscribe option was found in that range.'
            : `Found ${senderCount} ${
                senderCount === 1 ? 'sender' : 'senders'
              } you can unsubscribe from.`
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
      await window.api.unsub.cancel()
    } catch {
      // ignore
    }
  }

  // ---------- selection ----------

  function toggleGroup(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Toggles every visible, bulk-unsubscribable group at once.
  function selectAll() {
    if (selectableVisible.length === 0) return
    setSelected((prev) => {
      const allOn = selectableVisible.every((g) => prev.has(g.key))
      const next = new Set(prev)
      for (const g of selectableVisible) {
        if (allOn) next.delete(g.key)
        else next.add(g.key)
      }
      return next
    })
  }

  // ---------- preview ----------

  async function handlePreview(email: UnsubEmail) {
    if (!selectedId) return
    setPreview({ email, body: null, loading: true, error: null })
    try {
      const body = await window.api.imap.fetchBody(selectedId, email.uid)
      setPreview((p) => (p && p.email.uid === email.uid ? { ...p, body, loading: false } : p))
    } catch (e) {
      setPreview((p) =>
        p && p.email.uid === email.uid ? { ...p, loading: false, error: String(e) } : p
      )
    }
  }

  async function handleOpenMailto(mailto: string) {
    try {
      await openUrl(mailto)
    } catch (e) {
      setStatus(`Could not open your mail app: ${String(e)}`)
    }
  }

  // Right-click → permanently delete a single email (bypasses Trash).
  async function confirmDeleteEmail() {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target || !selectedId) return
    setStatus(`Permanently deleting “${target.subject || '(no subject)'}”…`)
    try {
      await window.api.imap.delete(selectedId, [target.uid], true)
      setEmails((prev) => (prev ? prev.filter((e) => e.uid !== target.uid) : prev))
      setStatus(`Permanently deleted “${target.subject || '(no subject)'}”.`)
    } catch (e) {
      setStatus(`Could not delete email: ${String(e)}`)
    }
  }

  // ---------- unsubscribe ----------

  async function confirmUnsub() {
    setConfirmOpen(false)
    const selectedKeys = [...selected]
    const targets: UnsubTarget[] = []
    for (const key of selectedKeys) {
      const group = allGroups.find((g) => g.key === key)
      if (!group) continue
      const info = groupUnsubInfo(group)
      if (info.url && info.method === 'one-click') {
        targets.push({ key, url: info.url, method: 'post' })
      } else if (info.url && info.method === 'link') {
        targets.push({ key, url: info.url, method: 'get' })
      }
    }
    if (targets.length === 0) {
      setStatus('Nothing to unsubscribe — the selected senders have no web link.')
      return
    }
    setUnsubscribing(true)
    setStatus(`Unsubscribing from ${targets.length} ${targets.length === 1 ? 'sender' : 'senders'}…`)
    let summary: string
    try {
      const items = await window.api.unsub.run(targets)
      setResults((prev) => {
        const next = new Map(prev)
        for (const item of items) next.set(item.key, item)
        return next
      })
      const ok = items.filter((i) => i.ok).length
      const failed = items.length - ok
      summary =
        failed > 0
          ? `Unsubscribed from ${ok} of ${items.length} senders — ${failed} failed.`
          : `Unsubscribed from ${ok} ${ok === 1 ? 'sender' : 'senders'}.`
    } catch (e) {
      setUnsubscribing(false)
      setStatus(`Unsubscribe failed: ${String(e)}`)
      return
    }

    // "Delete emails" option: move the scanned mail from those senders to Trash.
    if (deleteEmails && selectedId) {
      const keySet = new Set(selectedKeys)
      const uids = allGroups
        .filter((g) => keySet.has(g.key))
        .flatMap((g) => g.emails.map((e) => e.uid))
      if (uids.length > 0) {
        setStatus(`${summary} Moving ${uids.length.toLocaleString()} emails to Trash…`)
        try {
          const result = await window.api.imap.delete(selectedId, uids, false)
          const gone = new Set(uids.filter((u) => !result.failed.includes(u)))
          setEmails((prev) => (prev ? prev.filter((e) => !gone.has(e.uid)) : prev))
          summary = `${summary} Moved ${result.deleted.toLocaleString()} emails to Trash.`
          if (result.failed.length > 0) {
            const cause = result.error ? ` — ${result.error}` : ''
            summary = `${summary} ${result.failed.length} could not be deleted${cause}.`
          }
        } catch (e) {
          summary = `${summary} Could not delete emails: ${String(e)}`
        }
      }
    }

    setSelected(new Set())
    setUnsubscribing(false)
    setStatus(summary)
  }

  // ---------- render ----------

  const canScan = !!selectedId && !running
  const selectedCount = selected.size
  const allSelected =
    selectableVisible.length > 0 && selectableVisible.every((g) => selected.has(g.key))

  return (
    <ToolLayout
      title="Email Unsubscribe"
      onBack={onBack}
      onRun={canScan ? handleScan : undefined}
      active={active}
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
          <ImapAccountPicker
            selectedId={selectedId}
            onSelectedChange={setSelectedId}
            onStatus={setStatus}
          />

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

      {/* Right column: mailing lists */}
      <Card label="Mailing lists" badge={emails ? allGroups.length.toLocaleString() : '—'}>
        {emails === null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Scan an inbox to find mailing lists you can leave.
          </div>
        ) : emails.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
            No mail with an unsubscribe option was found in that date range.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-border px-3 py-2">
              <input
                className={`${fieldClass} w-full`}
                placeholder="Search senders and subjects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={selectAll}
                className="text-[12px] text-accent hover:underline"
                disabled={selectableVisible.length === 0}
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              <span className="flex-1 text-right text-[12px] text-text-secondary">
                {selectedCount.toLocaleString()} selected
              </span>
            </div>
            {groups.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-text-muted">
                No senders or subjects match “{search}”.
              </div>
            ) : (
              <EmailUnsubscribeGroups
                groups={groups}
                selected={selected}
                expanded={expanded}
                results={results}
                onToggleGroup={toggleGroup}
                onToggleExpand={toggleExpand}
                onPreview={handlePreview}
                onOpenMailto={handleOpenMailto}
                onDeleteEmail={setDeleteTarget}
              />
            )}
            <div className="flex items-center gap-3 border-t border-border p-3">
              <label
                className="flex shrink-0 items-center gap-2 text-[12.5px] text-text-secondary"
                title="Also move the scanned emails from those senders to Trash."
              >
                <input
                  type="checkbox"
                  checked={deleteEmails}
                  onChange={(e) => setDeleteEmails(e.target.checked)}
                  className="h-4 w-4 accent-danger"
                />
                Delete emails
              </label>
              <span className="flex-1 text-right text-[11.5px] leading-snug text-text-muted">
                {emailOnlyCount > 0
                  ? `${emailOnlyCount} ${
                      emailOnlyCount === 1 ? 'sender offers' : 'senders offer'
                    } email-only unsubscribe — use “Open”.`
                  : ''}
              </span>
              <Button
                onClick={() => setConfirmOpen(true)}
                variant="primary"
                disabled={selectedCount === 0 || unsubscribing}
              >
                {unsubscribing
                  ? 'Working…'
                  : `Unsubscribe${deleteEmails ? ' & delete' : ''} · ${selectedCount.toLocaleString()} ${
                      selectedCount === 1 ? 'sender' : 'senders'
                    }`}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={`Unsubscribe from ${selectedCount} ${
          selectedCount === 1 ? 'sender' : 'senders'
        }?`}
        message={
          `This sends an unsubscribe request to each selected sender’s server. ` +
          `It cannot be undone from here — re-subscribing means signing up again.` +
          (deleteEmails
            ? ' The scanned emails from those senders will also be moved to Trash.'
            : '')
        }
        detail="One-click senders are unsubscribed instantly; link senders are visited once to confirm."
        confirmLabel={deleteEmails ? 'Unsubscribe & delete' : 'Unsubscribe'}
        danger={deleteEmails}
        onConfirm={confirmUnsub}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete email permanently?"
        message={`“${
          deleteTarget?.subject || '(no subject)'
        }” will be permanently removed from the server and cannot be recovered.`}
        detail="This empties it straight from the server, bypassing Trash."
        confirmLabel="Delete permanently"
        danger
        onConfirm={confirmDeleteEmail}
        onCancel={() => setDeleteTarget(null)}
      />

      {preview && (
        <EmailPreview
          email={preview.email}
          body={preview.body}
          loading={preview.loading}
          error={preview.error}
          onClose={() => setPreview(null)}
        />
      )}
    </ToolLayout>
  )
}
