import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Button, Icons, FilePanel, type FilePanelHandle } from '../components/ToolShell'
import { shortOutputPath } from '../lib/paths'
import { consumePendingFile } from '../lib/pending'
import {
  filterProfiles,
  serializeRefract,
  serializeShikari,
  type FilterResult,
  type ProfileFormat
} from '../lib/profileFilter'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

type OutputFormat = 'refract' | 'shikari' | 'emails'

const FORMAT_LABELS: Record<ProfileFormat, string> = {
  refract: 'Refract JSON',
  shikari: 'Shikari CSV',
  unknown: '—'
}

const OUTPUT_LABELS: Record<OutputFormat, string> = {
  refract: 'Refract JSON',
  shikari: 'Shikari CSV',
  emails: 'Matched emails'
}

const OUTPUTS: { id: OutputFormat; label: string }[] = [
  { id: 'refract', label: 'Refract JSON' },
  { id: 'shikari', label: 'Shikari CSV' },
  { id: 'emails', label: 'Emails only' }
]

// Text + count + save extension for the chosen output format. The output format
// is independent of the input: same-format reuses the lossless native output;
// cross-format converts through the canonical profile mapping.
function outputFor(result: FilterResult, fmt: OutputFormat): { text: string; count: number; ext: string } {
  if (fmt === 'emails') {
    return { text: result.matchedEmails.join('\n'), count: result.matchedEmails.length, ext: 'txt' }
  }
  const text =
    fmt === result.format
      ? result.fullOutput
      : fmt === 'refract'
        ? serializeRefract(result.matched)
        : serializeShikari(result.matched)
  return { text, count: result.matchedCount, ext: fmt === 'shikari' ? 'csv' : 'json' }
}

/** Filtered output box. Owns its Copy / Save controls and saved-path note. */
function OutputCard({
  result,
  format,
  onSetStatus
}: {
  result: FilterResult | null
  format: OutputFormat
  onSetStatus: (msg: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  const out = result && !result.error ? outputFor(result, format) : null
  const text = out?.text ?? ''
  const has = text.length > 0

  // A changed output (new run or mode switch) voids the "Saved to …" note.
  useEffect(() => {
    setSavedTo(null)
  }, [text])

  async function copy() {
    if (!has) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  async function save() {
    if (!has || !out) return
    const path = await window.api.files.writeOutput('profile-filter', text + '\n', out.ext)
    setSavedTo(path)
    onSetStatus(`Saved to ${shortOutputPath(path)}`)
  }

  const label = OUTPUT_LABELS[format]

  return (
    <Card label={label} badge={out ? out.count.toLocaleString() : '—'} className="min-h-0 flex-1">
      {result === null ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
          Run to filter the profiles.
        </div>
      ) : result.error ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-warning">
          {result.error}
        </div>
      ) : !has ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
          No profiles matched your email list.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <textarea
            readOnly
            value={text}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
          />
          <div className="flex items-center gap-2 border-t border-border p-3">
            {savedTo ? (
              <span className="flex-1 truncate text-[12px] text-text-secondary">
                Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <Button onClick={copy} variant="ghost">
              <Icons.Copy />
              {copied ? 'Copied!' : 'Copy all'}
            </Button>
            {savedTo ? (
              <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                <Icons.Reveal />
                Reveal
              </Button>
            ) : (
              <Button onClick={save} variant="secondary">
                <Icons.Save />
                Save to Output
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

/** Emails from the list that matched no profile. Hidden when there are none. */
function MissesCard({ misses }: { misses: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = misses.join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  return (
    <Card label="Unmatched emails" badge={misses.length.toLocaleString()} className="max-h-[34%] shrink-0">
      <div className="flex h-full min-h-0 flex-col">
        <textarea
          readOnly
          value={text}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-secondary outline-none"
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            In your list but not in the file.
          </span>
          <Button onClick={copy} variant="ghost">
            <Icons.Copy />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function ProfileFilterPage({ onBack, onSetStatus, active = true }: Props) {
  const emailsRef = useRef<FilePanelHandle>(null)
  const profileRef = useRef<FilePanelHandle>(null)

  const [emailsPath, setEmailsPath] = useState<string | null>(null)
  const [profilePath, setProfilePath] = useState<string | null>(null)
  const [emailsCount, setEmailsCount] = useState(0)
  const [profileCount, setProfileCount] = useState(0)
  const [result, setResult] = useState<FilterResult | null>(null)
  const [outFmt, setOutFmt] = useState<OutputFormat>('refract')
  // Once the user clicks an output format, stop auto-following the detected source.
  const userPickedFmt = useRef(false)

  // Editing either input voids a stale result.
  const invalidate = useCallback(() => setResult(null), [])

  async function loadEmailsFromPath(path: string) {
    const text = await window.api.files.read(path)
    setEmailsPath(path)
    emailsRef.current?.setValue(text)
    invalidate()
    onSetStatus(`Loaded ${path}`)
  }

  async function loadProfileFromPath(path: string) {
    const text = await window.api.files.read(path)
    setProfilePath(path)
    profileRef.current?.setValue(text)
    invalidate()
    onSetStatus(`Loaded ${path}`)
  }

  // Pick up a file dropped on the Tools landing page — treat it as the profile file.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadProfileFromPath(pending)
  }, [active])

  async function handlePickEmails() {
    const paths = await window.api.files.open({
      title: 'Select an emails file',
      filters: [
        { name: 'Text', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length > 0) await loadEmailsFromPath(paths[0]!)
  }

  async function handlePickProfile() {
    const paths = await window.api.files.open({
      title: 'Select a Refract JSON or Shikari CSV',
      filters: [
        { name: 'Profiles', extensions: ['json', 'csv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length > 0) await loadProfileFromPath(paths[0]!)
  }

  const handleRun = useCallback(() => {
    const emails = emailsRef.current?.getValue() ?? ''
    const profile = profileRef.current?.getValue() ?? ''
    if (!emails.trim() || !profile.trim()) return
    const r = filterProfiles(emails, profile)
    setResult(r)
    if (!userPickedFmt.current && (r.format === 'refract' || r.format === 'shikari')) {
      setOutFmt(r.format)
    }
    if (r.error) onSetStatus(r.error)
    else
      onSetStatus(
        `${r.matchedCount.toLocaleString()} matched · ${r.misses.length.toLocaleString()} unmatched`
      )
  }, [onSetStatus])

  // Ctrl/Cmd+Enter runs, but only on the visible tool (others stay mounted hidden).
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleRun()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, handleRun])

  function handleClear() {
    emailsRef.current?.setValue('')
    profileRef.current?.setValue('')
    setEmailsPath(null)
    setProfilePath(null)
    setEmailsCount(0)
    setProfileCount(0)
    setResult(null)
    setOutFmt('refract')
    userPickedFmt.current = false
    onSetStatus('Ready')
  }

  const hasInputs = emailsCount > 0 && profileCount > 0

  const banner =
    result && !result.error ? (
      <>
        <Stat value={FORMAT_LABELS[result.format]} label="detected" />
        <Stat
          value={result.matchedCount.toLocaleString()}
          label={`matched of ${result.totalCount.toLocaleString()}`}
        />
        <Stat value={result.misses.length.toLocaleString()} label="unmatched" separator={false} />
      </>
    ) : result?.error ? (
      <span className="text-warning">{result.error}</span>
    ) : (
      <span>Paste an email list and a Refract JSON or Shikari CSV export, then Run.</span>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Profile Filter"
        onBack={onBack}
        actions={
          <>
            <Button onClick={handleClear} variant="ghost">
              <Icons.Trash />
              Clear
            </Button>
            <Button onClick={handleRun} variant="primary" disabled={!hasInputs}>
              <Icons.Play />
              Filter
            </Button>
          </>
        }
      />
      <StatusBanner>{banner}</StatusBanner>

      <div className="flex items-center gap-2 px-8 pt-4">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {OUTPUTS.map((m) => {
            const isActive = outFmt === m.id
            return (
              <button
                key={m.id}
                onClick={() => {
                  userPickedFmt.current = true
                  setOutFmt(m.id)
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        {result && !result.error && (
          <span className="rounded-md bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-secondary">
            {FORMAT_LABELS[result.format]}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">
        <div className="flex min-h-0 flex-col gap-4">
          <FilePanel
            ref={emailsRef}
            label="Emails"
            filePath={emailsPath}
            placeholder={'Paste one email per line.\n\nDrop a file, click "Choose", or paste here.'}
            onPick={handlePickEmails}
            onDropPath={loadEmailsFromPath}
            onLineCountChange={setEmailsCount}
            onUserEdit={invalidate}
            className="min-h-0 flex-1"
          />
          <FilePanel
            ref={profileRef}
            label="Profile file (Refract JSON / Shikari CSV)"
            filePath={profilePath}
            placeholder={'Paste or load a Refract JSON export or a Shikari CSV export.'}
            onPick={handlePickProfile}
            onDropPath={loadProfileFromPath}
            onLineCountChange={setProfileCount}
            onUserEdit={invalidate}
            className="min-h-0 flex-1"
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <OutputCard result={result} format={outFmt} onSetStatus={onSetStatus} />
          {result && !result.error && result.misses.length > 0 && (
            <MissesCard misses={result.misses} />
          )}
        </div>
      </div>
    </div>
  )
}
