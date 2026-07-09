import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ToolLayout, Button, Icons } from '../components/ToolShell'
import { Card } from '../components/Card'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ImapAccountPicker } from '../components/ImapAccountPicker'
import type { EmailHeader, ScanRange, ScanResult, EmailBody } from '../lib/api'
import { rangeBetween } from '../lib/rangeSelect'
import { deleteProgressBanner, deleteProgressButton } from '../lib/deleteProgress'
import { EmailCleanerGroups, groupBySender } from './EmailCleanerGroups'
import { EmailPreview } from './EmailPreview'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
  confirmPermanentDelete: boolean
  onConfirmPermanentDeleteChange: (next: boolean) => void
}

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const ClearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const fieldClass =
  'h-9 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-text-primary outline-none transition focus:border-accent'

export function EmailCleanerPage({
  onBack,
  active,
  confirmPermanentDelete,
  onConfirmPermanentDeleteChange
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [rangeMode, setRangeMode] = useState<'dateRange' | 'lastDays'>('lastDays')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [lastDays, setLastDays] = useState('30')

  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [emails, setEmails] = useState<EmailHeader[] | null>(null)
  const [scanSeq, setScanSeq] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Anchor for Shift+click range selection: the last email row the user
  // clicked. Cleared whenever the visible list changes shape (new scan,
  // account switch, search edit) or the anchor email is deleted.
  const [anchorUid, setAnchorUid] = useState<number | null>(null)
  const [permanent, setPermanent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // "Don't ask me again" checkbox inside the Delete Permanently dialog.
  // Reset every time the dialog opens; persisted only on confirm.
  const [suppressChecked, setSuppressChecked] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [status, setStatus] = useState('Pick an account and a date range, then scan the inbox.')
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<{
    email: EmailHeader
    body: EmailBody | null
    loading: boolean
    error: string | null
  } | null>(null)

  // When the chosen account changes, drop stale scan results so the inbox
  // panel never shows mail from a different (or removed) account.
  useEffect(() => {
    setEmails(null)
    setSelected(new Set())
    setAnchorUid(null)
    setExpanded(new Set())
    setSearch('')
  }, [selectedId])

  // Scanned emails grouped by sender, narrowed by the inbox search box.
  // A search term matches against the sender name, sender address, or subject.
  // The filter reads a deferred copy of the search text so typing never blocks
  // on re-filtering a six-figure inbox.
  const deferredSearch = useDeferredValue(search)
  const groups = useMemo(() => {
    if (!emails) return []
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return groupBySender(emails)
    const filtered = emails.filter(
      (e) =>
        e.fromName.toLowerCase().includes(q) ||
        e.fromAddr.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q)
    )
    return groupBySender(filtered)
  }, [emails, deferredSearch])

  // Selection math, one pass per change instead of per group per render.
  const selectedCountByGroup = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of groups) {
      let n = 0
      for (const e of g.emails) if (selected.has(e.uid)) n++
      if (n > 0) counts.set(g.key, n)
    }
    return counts
  }, [groups, selected])

  const visibleUids = useMemo(() => {
    const uids: number[] = []
    for (const g of groups) for (const e of g.emails) uids.push(e.uid)
    return uids
  }, [groups])

  const allSelected = useMemo(
    () => visibleUids.length > 0 && visibleUids.every((u) => selected.has(u)),
    [visibleUids, selected]
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
    setAnchorUid(null)
    setExpanded(new Set())
    setSearch('')
    setStatus('Scanning inbox…')
    try {
      const result = await window.api.imap.scan(selectedId, range)
      setEmails(result.emails)
      setScanSeq((s) => s + 1)
      if (result.cancelled) {
        setStatus(
          `Scan stopped, showing ${result.emails.length.toLocaleString()} ${
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
    setAnchorUid(uid)
  }

  // Shift+click: add the whole visible span between the anchor and the
  // clicked email. Without a usable anchor it degrades to a single toggle.
  function rangeSelect(uid: number) {
    const range = rangeBetween(visibleUids, anchorUid, uid)
    if (range.length === 0) {
      toggleEmail(uid)
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      for (const u of range) next.add(u)
      return next
    })
    setAnchorUid(uid)
  }

  function toggleExpand(addr: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(addr)) next.delete(addr)
      else next.add(addr)
      return next
    })
  }

  // Operates on the currently visible (search-filtered) emails: if every
  // visible email is already selected, clear them; otherwise add them all.
  function selectAll() {
    if (visibleUids.length === 0) return
    setSelected((prev) => {
      const next = new Set(prev)
      for (const u of visibleUids) {
        if (allSelected) next.delete(u)
        else next.add(u)
      }
      return next
    })
  }

  // Page-scoped shortcuts: Ctrl+A select-all-visible, Delete opens the
  // delete flow, Esc clears the selection (and only then falls through to
  // App's Esc-returns-to-Tools). Registered without a dependency array so
  // the handler always closes over the latest state; gated to the active
  // route, and inert while typing or while a dialog/dropdown is open -
  // the same guards App.tsx uses. Capture phase so a selection-clearing
  // Esc wins over App's bubble-phase back-navigation.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector('[role="listbox"]') ||
        document.querySelector('[role="menu"]')
      )
        return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (visibleUids.length === 0) return
        e.preventDefault()
        setSelected((prev) => {
          const next = new Set(prev)
          for (const u of visibleUids) next.add(u)
          return next
        })
      } else if (e.key === 'Delete') {
        if (selected.size === 0 || deleting) return
        e.preventDefault()
        requestDelete()
      } else if (e.key === 'Escape') {
        if (selected.size === 0) return
        e.preventDefault()
        e.stopPropagation()
        setSelected(new Set())
        setAnchorUid(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  function changeSearch(next: string) {
    setSearch(next)
    setAnchorUid(null)
  }

  // ---------- preview ----------

  async function handlePreview(email: EmailHeader) {
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

  // ---------- delete ----------

  // Delete button / Delete key entry point: permanent deletes skip the
  // dialog when the user opted out; everything else confirms first.
  function requestDelete() {
    if (selected.size === 0 || deleting) return
    if (permanent && !confirmPermanentDelete) {
      void confirmDelete()
      return
    }
    setSuppressChecked(false)
    setConfirmOpen(true)
  }

  async function confirmDelete() {
    if (!selectedId || selected.size === 0) return
    setConfirmOpen(false)
    setDeleting(true)
    if (permanent && suppressChecked && confirmPermanentDelete) {
      try {
        await window.api.config.setConfirmPermanentDelete(false)
        onConfirmPermanentDeleteChange(false)
      } catch (e) {
        setStatus(`Could not save setting: ${String(e)}, deleting anyway.`)
      }
    }
    const uids = [...selected]
    setDeleteProgress({ done: 0, total: uids.length })
    setStatus(deleteProgressBanner(permanent, 0, uids.length))
    // Live per-batch progress for the banner and the Delete button. The
    // subscription only spans this call; unlistening in `finally` drops any
    // stragglers after the invoke resolves.
    const unlisten = window.api.imap.onDeleteProgress((p) => {
      setDeleteProgress(p)
      setStatus(deleteProgressBanner(permanent, p.done, p.total))
    })
    try {
      const result = await window.api.imap.delete(selectedId, uids, permanent)
      const failedSet = new Set(result.failed)
      const deletedSet = new Set(uids.filter((u) => !failedSet.has(u)))
      setEmails((prev) => (prev ? prev.filter((e) => !deletedSet.has(e.uid)) : prev))
      setSelected(new Set())
      setAnchorUid((a) => (a !== null && deletedSet.has(a) ? null : a))
      const base = `Deleted ${result.deleted.toLocaleString()} emails.`
      const cause = result.error ? `, ${result.error}` : ''
      setStatus(
        result.failed.length > 0
          ? `${base} ${result.failed.length} could not be deleted${cause}.`
          : base
      )
    } catch (e) {
      setStatus(`Delete failed: ${String(e)}`)
    } finally {
      unlisten()
      setDeleteProgress(null)
      setDeleting(false)
    }
  }

  // ---------- render ----------

  const canScan = !!selectedId && !running
  const selectedCount = selected.size

  return (
    <ToolLayout
      title="Email Cleaner"
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

      {/* Right column: results */}
      <Card label="Inbox" badge={emails ? emails.length.toLocaleString() : '-'}>
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
            <div className="border-b border-border px-3 py-2">
              <div className="relative">
                <input
                  className={`${fieldClass} w-full ${search ? 'pr-9' : ''}`}
                  placeholder="Search senders and subjects…"
                  value={search}
                  onChange={(e) => changeSearch(e.target.value)}
                  spellCheck={false}
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => changeSearch('')}
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
                  >
                    <ClearIcon />
                  </button>
                )}
              </div>
            </div>
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
            {groups.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-text-muted">
                No senders or subjects match “{search}”.
              </div>
            ) : (
              <EmailCleanerGroups
                groups={groups}
                selected={selected}
                selectedCountByGroup={selectedCountByGroup}
                expanded={expanded}
                resetKey={scanSeq}
                onToggleGroup={toggleGroup}
                onToggleEmail={toggleEmail}
                onRangeSelect={rangeSelect}
                onToggleExpand={toggleExpand}
                onPreview={handlePreview}
              />
            )}
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
                onClick={requestDelete}
                variant="primary"
                disabled={selectedCount === 0 || deleting}
              >
                <Icons.Trash />
                {deleting
                  ? deleteProgress
                    ? deleteProgressButton(deleteProgress.done, deleteProgress.total)
                    : 'Deleting…'
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
        suppress={
          permanent
            ? {
                label: 'Don’t ask me again',
                checked: suppressChecked,
                onChange: setSuppressChecked
              }
            : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
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
