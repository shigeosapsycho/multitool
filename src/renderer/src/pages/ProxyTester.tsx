import { useEffect, useRef, useState } from 'react'
import { ToolLayout, FilePanel, Button, Icons, Stat, type FilePanelHandle } from '../components/ToolShell'
import { Card } from '../components/Card'
import { consumePendingFile, consumePendingProxies } from '../lib/pending'
import type { ProxyTestEntry } from '../lib/api'
import { shortOutputPath } from '../lib/paths'

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

export function ProxyTesterPage({ onBack, onSetStatus, active = true }: Props) {
  const [url, setUrl] = useState('https://btcollectibles.com')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [results, setResults] = useState<ProxyTestEntry[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const panelRef = useRef<FilePanelHandle>(null)

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    setResults(null)
    setSavedTo(null)
    onSetStatus(`Loaded ${path}`)
  }

  useEffect(() => {
    if (!active) return
    // A list handed over from Proxy Cleaner's "Send to Proxy Tester" button.
    const proxies = consumePendingProxies()
    if (proxies != null) {
      setFilePath(null)
      panelRef.current?.setValue(proxies)
      setResults(null)
      setSavedTo(null)
      onSetStatus('Loaded filtered proxies from Proxy Cleaner')
      return
    }
    const pending = consumePendingFile()
    if (pending) void loadFromPath(pending)
  }, [active])

  async function handlePick() {
    const paths = await window.api.files.open({ title: 'Select a proxy list' })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    setResults(null)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    const content = panelRef.current?.getValue() ?? ''
    const proxies = content.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith('#'))
    if (proxies.length === 0) return

    setRunning(true)
    setStopping(false)
    setResults(null)
    setSavedTo(null)
    onSetStatus(`Testing ${proxies.length.toLocaleString()} proxies against ${trimmedUrl}...`)
    const start = Date.now()
    try {
      const res = await window.api.net.testProxies({ url: trimmedUrl, proxies, concurrency: 10 })
      setResults(res)
      const ok = res.filter((r) => r.error == null).length
      const canceled = res.filter((r) => r.error === 'Canceled').length
      onSetStatus(
        canceled > 0
          ? `Stopped: ${ok.toLocaleString()} working, ${canceled.toLocaleString()} canceled`
          : `${ok.toLocaleString()} / ${res.length.toLocaleString()} working`
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      onSetStatus(`Failed: ${message}`)
    } finally {
      const elapsed = Date.now() - start
      const min = 300
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
      setStopping(false)
    }
  }

  async function handleStop() {
    if (!running || stopping) return
    setStopping(true)
    onSetStatus('Stopping... (in-flight requests will finish)')
    try {
      await window.api.net.cancelProxies()
    } catch {
      // ignore
    }
  }

  async function handleSaveWorking() {
    if (!results) return
    const working = results
      .filter((r) => r.error == null && r.normalized)
      .map((r) => r.normalized!)
    if (working.length === 0) return
    const path = await window.api.files.writeOutput('working-proxies', working.join('\n') + '\n')
    setSavedTo(path)
    onSetStatus(`Saved ${working.length.toLocaleString()} to ${shortOutputPath(path)}`)
  }

  const canRun = url.trim().length > 0 && lineCount > 0 && !running

  const okCount = results?.filter((r) => r.error == null).length ?? 0
  const failCount = results?.filter((r) => r.error != null).length ?? 0
  const avgLatency = results && okCount > 0
    ? Math.round(
        results.filter((r) => r.error == null && r.latencyMs != null).reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / okCount
      )
    : null

  return (
    <ToolLayout
      title="Proxy Tester"
      onBack={onBack}
      onRun={canRun ? handleRun : undefined}
      running={running}
      banner={
        results ? (
          <>
            <Stat value={okCount.toLocaleString()} label="working" />
            <Stat value={failCount.toLocaleString()} label="failed" />
            <Stat value={avgLatency != null ? `${avgLatency}` : '—'} label="avg ms" separator={false} />
          </>
        ) : lineCount > 0 ? (
          <>
            <Stat value={lineCount.toLocaleString()} label="proxies loaded" separator={false} />
          </>
        ) : (
          <span>Load a proxy list (one per line) and enter a target URL.</span>
        )
      }
      actions={
        <>
          <Button onClick={handleClear} variant="ghost" disabled={running}>
            <Icons.Trash />
            Clear
          </Button>
          {running ? (
            <Button onClick={handleStop} variant="secondary" disabled={stopping}>
              <StopIcon />
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          ) : (
            <Button onClick={handleRun} variant="primary" disabled={!canRun}>
              <Icons.Play />
              Test All
            </Button>
          )}
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
          <span className="font-semibold uppercase tracking-[0.06em]">Target URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://btcollectibles.com"
            spellCheck={false}
            className="h-10 rounded-lg border border-border bg-surface px-3 font-mono text-[12.5px] text-text-primary outline-none transition focus:border-accent"
          />
        </label>
        <FilePanel
          ref={panelRef}
          label="Proxy List"
          filePath={filePath}
          onPick={handlePick}
          onDropPath={loadFromPath}
          onLineCountChange={setLineCount}
          onUserEdit={() => {
            setResults(null)
            setSavedTo(null)
          }}
          placeholder={'One proxy per line. Accepts:\n\n  host:port\n  host:port:user:pass\n  user:pass@host:port\n  user:pass:host:port\n\nOptional scheme prefix: http://, https://, socks5://'}
          className="min-h-0 flex-1"
        />

      </div>

      <Card label="Results" badge={results ? `${okCount}/${results.length}` : '—'}>
        {results === null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Load a list and click "Test All".
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
            No proxies tested.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[12px] font-mono">
                <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-[0.06em] text-text-secondary">
                  <tr>
                    <th className="border-b border-border px-3 py-2 text-left">Proxy</th>
                    <th className="border-b border-border px-3 py-2 text-right">ms</th>
                    <th className="border-b border-border px-3 py-2 text-right">Status</th>
                    <th className="border-b border-border px-3 py-2 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-surface-2">
                      <td className="px-3 py-1.5 text-text-primary break-all">{r.raw || '—'}</td>
                      <td className="px-3 py-1.5 text-right text-text-secondary">
                        {r.latencyMs != null ? r.latencyMs.toLocaleString() : '—'}
                      </td>
                      <td className={`px-3 py-1.5 text-right ${r.error == null ? 'text-green-400' : 'text-text-muted'}`}>
                        {r.status != null ? r.status : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-red-400 break-all">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 border-t border-border p-3">
              {savedTo ? (
                <span className="flex-1 truncate text-[12px] text-text-secondary">
                  Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
                </span>
              ) : (
                <span className="flex-1 text-[12px] text-text-muted">
                  {okCount.toLocaleString()} working · {failCount.toLocaleString()} failed
                  {avgLatency != null && ` · avg ${avgLatency} ms`}
                </span>
              )}
              {savedTo ? (
                <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                  <Icons.Reveal />
                  Reveal
                </Button>
              ) : (
                <Button onClick={handleSaveWorking} variant="secondary" disabled={okCount === 0}>
                  <Icons.Save />
                  Save Working
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </ToolLayout>
  )
}
