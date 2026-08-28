import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { Button, Icons, FilePanel, type FilePanelHandle } from '../components/ToolShell'
import { shortOutputPath } from '../lib/paths'
import { consumePendingFile } from '../lib/pending'
import { CsvTable } from '../components/CsvTable'
import { isDiscordWebhookUrl, useDiscordWebhookUrl } from '../lib/discord'
import { replaceProfileEmails, type ReplaceResult } from '../lib/profileEmailReplace'
import { type ProfileFormat } from '../lib/profileFilter'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
  formatCsv?: boolean
}

const FORMAT_LABELS: Record<ProfileFormat, string> = {
  refract: 'Refract JSON',
  stellar: 'Stellar JSON',
  shikari: 'Shikari CSV',
  unknown: '-'
}

/** Rewritten output box. Owns its Copy / Discord / Save controls and saved-path note. */
function OutputCard({
  result,
  formatCsv,
  onSetStatus
}: {
  result: ReplaceResult | null
  formatCsv: boolean
  onSetStatus: (msg: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  // Configured via Settings; the Discord button below only exists while the
  // stored webhook URL is valid.
  const webhookConfigured = isDiscordWebhookUrl(useDiscordWebhookUrl())
  const [discordState, setDiscordState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [discordError, setDiscordError] = useState('')

  const ok = result && !result.error ? result : null
  const text = ok?.fullOutput ?? ''
  const has = text.length > 0
  // The output never changes format, so the extension follows the source.
  const ext = ok?.format === 'shikari' ? 'csv' : 'json'

  // A changed output voids the "Saved to …" note.
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
    if (!has) return
    const path = await window.api.files.writeOutput('profile-email-replacer', text + '\n', ext)
    setSavedTo(path)
    onSetStatus(`Saved to ${shortOutputPath(path)}`)
  }

  async function sendToDiscord() {
    if (!has || discordState === 'sending') return
    setDiscordState('sending')
    try {
      // Same serialization and extension as save(), so the attachment matches
      // what "Save to Output" would have written, .json or .csv per format.
      await window.api.discord.sendContent('profile-email-replacer', text + '\n', ext)
      setDiscordState('sent')
      setTimeout(() => setDiscordState('idle'), 1500)
    } catch (e) {
      setDiscordError(String(e))
      setDiscordState('error')
      setTimeout(() => setDiscordState('idle'), 4000)
    }
  }

  return (
    <Card
      label={ok ? FORMAT_LABELS[ok.format] : 'Rewritten profiles'}
      badge={ok ? ok.outputCount.toLocaleString() : '-'}
      className="min-h-0 flex-1"
    >
      {result === null ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
          Run to swap the emails.
        </div>
      ) : result.error ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-warning">
          {result.error}
        </div>
      ) : !has ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
          No profiles were read from the file.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {result.format === 'shikari' && formatCsv ? (
            <CsvTable text={text} />
          ) : (
            <textarea
              readOnly
              value={text}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
            />
          )}
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
            {webhookConfigured && (
              <Button
                onClick={sendToDiscord}
                variant="ghost"
                disabled={discordState === 'sending'}
                title={discordState === 'error' ? discordError : undefined}
              >
                <Icons.Send />
                {discordState === 'idle'
                  ? 'Send to Discord'
                  : discordState === 'sending'
                    ? 'Sending…'
                    : discordState === 'sent'
                      ? 'Sent!'
                      : 'Failed'}
              </Button>
            )}
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

export function ProfileEmailReplacerPage({
  onBack,
  onSetStatus,
  active = true,
  formatCsv = true
}: Props) {
  const findRef = useRef<FilePanelHandle>(null)
  const replaceRef = useRef<FilePanelHandle>(null)
  const profileRef = useRef<FilePanelHandle>(null)

  const [findPath, setFindPath] = useState<string | null>(null)
  const [replacePath, setReplacePath] = useState<string | null>(null)
  const [profilePath, setProfilePath] = useState<string | null>(null)
  const [findCount, setFindCount] = useState(0)
  const [replaceCount, setReplaceCount] = useState(0)
  const [profileCount, setProfileCount] = useState(0)
  const [dropUnmatched, setDropUnmatched] = useState(false)
  const [result, setResult] = useState<ReplaceResult | null>(null)

  // Editing any input voids a stale result.
  const invalidate = useCallback(() => setResult(null), [])

  async function loadFindFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFindPath(path)
    findRef.current?.setValue(text)
    invalidate()
    onSetStatus(`Loaded ${path}`)
  }

  async function loadReplaceFromPath(path: string) {
    const text = await window.api.files.read(path)
    setReplacePath(path)
    replaceRef.current?.setValue(text)
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

  // Pick up a file dropped on the Tools landing page, treat it as the profile file.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadProfileFromPath(pending)
  }, [active])

  async function pickEmails(title: string, load: (path: string) => Promise<void>) {
    const paths = await window.api.files.open({
      title,
      filters: [
        { name: 'Text', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length > 0) await load(paths[0]!)
  }

  async function handlePickProfile() {
    const paths = await window.api.files.open({
      title: 'Select a Refract JSON, Stellar JSON, or Shikari CSV',
      filters: [
        { name: 'Profiles', extensions: ['json', 'csv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length > 0) await loadProfileFromPath(paths[0]!)
  }

  const run = useCallback(
    (drop: boolean) => {
      const find = findRef.current?.getValue() ?? ''
      const replace = replaceRef.current?.getValue() ?? ''
      const profile = profileRef.current?.getValue() ?? ''
      if (!find.trim() || !replace.trim() || !profile.trim()) return
      const r = replaceProfileEmails(find, replace, profile, { dropUnmatched: drop })
      setResult(r)
      if (r.error) onSetStatus(r.error)
      else
        onSetStatus(
          `${r.replacedCount.toLocaleString()} replaced of ${r.totalCount.toLocaleString()} profiles`
        )
    },
    [onSetStatus]
  )

  const handleRun = useCallback(() => run(dropUnmatched), [run, dropUnmatched])

  // Flipping the toggle re-runs, so the output always matches what the switch
  // says rather than going stale until the next Replace.
  function handleDropChange(next: boolean) {
    setDropUnmatched(next)
    if (result) run(next)
  }

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
    findRef.current?.setValue('')
    replaceRef.current?.setValue('')
    profileRef.current?.setValue('')
    setFindPath(null)
    setReplacePath(null)
    setProfilePath(null)
    setFindCount(0)
    setReplaceCount(0)
    setProfileCount(0)
    setResult(null)
    onSetStatus('Ready')
  }

  const hasInputs = findCount > 0 && replaceCount > 0 && profileCount > 0

  const banner =
    result && !result.error ? (
      <>
        <Stat value={FORMAT_LABELS[result.format]} label="detected" />
        <Stat
          value={result.replacedCount.toLocaleString()}
          label={`replaced of ${result.totalCount.toLocaleString()}`}
        />
        <Stat
          value={result.outputCount.toLocaleString()}
          label="profiles out"
          separator={false}
        />
      </>
    ) : result?.error ? (
      <span className="text-warning">{result.error}</span>
    ) : (
      <span>
        Paste the emails to replace, the emails to replace them with, and a Refract JSON, Stellar
        JSON, or Shikari CSV export, then Run. The two lists pair up 1:1, in order.
      </span>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Profile Email Replacer"
        onBack={onBack}
        actions={
          <>
            <Button onClick={handleClear} variant="ghost">
              <Icons.Trash />
              Clear
            </Button>
            <Button onClick={handleRun} variant="primary" disabled={!hasInputs}>
              <Icons.Play />
              Replace
            </Button>
          </>
        }
      />
      <StatusBanner>{banner}</StatusBanner>

      <div className="flex items-center gap-2 px-8 pt-4">
        <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
          <Toggle
            checked={dropUnmatched}
            onChange={handleDropChange}
            ariaLabel="Drop profiles whose email was not replaced"
          />
          Drop untouched profiles
        </label>
        <span className="text-[11.5px] text-text-muted">
          {dropUnmatched
            ? 'Output holds only the profiles that took a new email.'
            : 'Profiles the find list does not name ride along unchanged.'}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">
        <div className="flex min-h-0 flex-col gap-4">
          {/* Side by side, because the two lists pair with each other by position. */}
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
            <FilePanel
              ref={findRef}
              label="Emails to replace"
              filePath={findPath}
              placeholder={'Paste one email per line.'}
              onPick={() => pickEmails('Select the emails to replace', loadFindFromPath)}
              onDropPath={loadFindFromPath}
              onLineCountChange={setFindCount}
              className="min-h-0"
            />
            <FilePanel
              ref={replaceRef}
              label="Replace with"
              filePath={replacePath}
              placeholder={'Paste one email per line, in the same order.'}
              onPick={() => pickEmails('Select the replacement emails', loadReplaceFromPath)}
              onDropPath={loadReplaceFromPath}
              onLineCountChange={setReplaceCount}
              className="min-h-0"
            />
          </div>
          <FilePanel
            ref={profileRef}
            label="Profile file (Refract / Stellar / Shikari)"
            filePath={profilePath}
            placeholder={'Paste or load a Refract JSON, Stellar JSON, or Shikari CSV export.'}
            onPick={handlePickProfile}
            onDropPath={loadProfileFromPath}
            onLineCountChange={setProfileCount}
            className="min-h-0 flex-1"
          />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <OutputCard result={result} formatCsv={formatCsv} onSetStatus={onSetStatus} />
        </div>
      </div>
    </div>
  )
}
