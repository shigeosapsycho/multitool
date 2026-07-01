import { useEffect, useRef, useState } from 'react'
import { ToolLayout, FilePanel, Button, Icons, Stat, type FilePanelHandle } from '../components/ToolShell'
import { Card } from '../components/Card'
import { consumePendingFile, consumePendingProxies } from '../lib/pending'
import type { ProxyTestEntry } from '../lib/api'
import { shortOutputPath } from '../lib/paths'
import { normalizeTargetUrl } from '../lib/url'
import { speedCategory, PROXY_SPEED_DEFAULTS, type ProxySpeedCategory } from '../lib/proxySpeed'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
  proxyGoodMs?: number
  proxyOkMs?: number
}

// Latency-cell color per speed bucket.
const MS_COLOR: Record<ProxySpeedCategory | 'failed', string> = {
  good: 'text-green-400',
  ok: 'text-amber-400',
  slow: 'text-orange-400',
  failed: 'text-text-muted'
}

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const URL_STORAGE_KEY = 'proxyTester.targetUrl'
const DEFAULT_TARGET_URL = 'https://btcollectibles.com'

export function ProxyTesterPage({
  onBack,
  onSetStatus,
  active = true,
  proxyGoodMs = PROXY_SPEED_DEFAULTS.goodMs,
  proxyOkMs = PROXY_SPEED_DEFAULTS.okMs
}: Props) {
  const [url, setUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(URL_STORAGE_KEY) ?? DEFAULT_TARGET_URL
    } catch {
      return DEFAULT_TARGET_URL
    }
  })

  // Persist the Target URL across launches. Stored in webview localStorage,
  // which Tauri keeps per identifier under %APPDATA%\com.beu.multitool.
  useEffect(() => {
    try {
      localStorage.setItem(URL_STORAGE_KEY, url)
    } catch {
      // ignore (private mode / quota — non-fatal)
    }
  }, [url])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [results, setResults] = useState<ProxyTestEntry[] | null>(null)
  const [speedFilter, setSpeedFilter] = useState<'all' | ProxySpeedCategory | 'failed'>('all')
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const panelRef = useRef<FilePanelHandle>(null)
  const unsubProgressRef = useRef<(() => void) | null>(null)

  // Drop any live progress subscription if the page unmounts mid-run.
  useEffect(() => () => unsubProgressRef.current?.(), [])

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
    setSpeedFilter('all')
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    const targetUrl = normalizeTargetUrl(trimmedUrl)
    const content = panelRef.current?.getValue() ?? ''
    const proxies = content.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith('#'))
    if (proxies.length === 0) return

    setRunning(true)
    setStopping(false)
    setResults(null)
    setSpeedFilter('all')
    setSavedTo(null)
    onSetStatus(`Testing ${proxies.length.toLocaleString()} proxies against ${targetUrl}...`)
    unsubProgressRef.current = window.api.net.onProxyProgress(({ done, total, ok }) => {
      onSetStatus(`Testing… ${done.toLocaleString()}/${total.toLocaleString()} — ${ok.toLocaleString()} working`)
    })
    const start = Date.now()
    try {
      const res = await window.api.net.testProxies({ url: targetUrl, proxies, concurrency: 10 })
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
      // Unsubscribe before yielding so a trailing progress event can't
      // overwrite the final status message.
      unsubProgressRef.current?.()
      unsubProgressRef.current = null
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
    // Unsubscribe immediately so progress events emitted while in-flight
    // workers drain can't overwrite the Stopping status. handleRun's finally
    // null-checks before unsubscribing, so this is safe to run first.
    unsubProgressRef.current?.()
    unsubProgressRef.current = null
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
      .filter((r) => {
        if (r.error != null || !r.normalized) return false
        if (speedFilter === 'all') return true
        if (speedFilter === 'failed') return false
        return (
          r.latencyMs != null &&
          speedCategory(r.latencyMs, { goodMs: proxyGoodMs, okMs: proxyOkMs }) === speedFilter
        )
      })
      .map((r) => {
        // Strip scheme, then emit host:port:user:pass (creds last, colon-separated)
        const stripped = r.normalized!.replace(/^[a-z0-9]+:\/\//i, '')
        const at = stripped.indexOf('@')
        if (at === -1) return stripped // host:port (no creds)
        const creds = stripped.slice(0, at) // user:pass
        const hostPort = stripped.slice(at + 1) // host:port
        return `${hostPort}:${creds}` // host:port:user:pass
      })
    if (working.length === 0) return
    const name =
      speedFilter === 'all' || speedFilter === 'failed' ? 'working-proxies' : `proxies-${speedFilter}`
    const path = await window.api.files.writeOutput(name, working.join('\n') + '\n')
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

  // Speed bucketing (Good/Ok/Slow) for the "Filter proxies by speed" chips.
  const categoryOf = (r: ProxyTestEntry): ProxySpeedCategory | 'failed' =>
    r.error != null || r.latencyMs == null
      ? 'failed'
      : speedCategory(r.latencyMs, { goodMs: proxyGoodMs, okMs: proxyOkMs })
  const speedCounts: Record<'all' | ProxySpeedCategory | 'failed', number> = {
    all: results?.length ?? 0,
    good: 0,
    ok: 0,
    slow: 0,
    failed: 0
  }
  if (results) for (const r of results) speedCounts[categoryOf(r)]++
  const visibleResults =
    results && speedFilter !== 'all' ? results.filter((r) => categoryOf(r) === speedFilter) : results
  const saveCount = results
    ? results.filter(
        (r) =>
          r.error == null &&
          r.normalized != null &&
          (speedFilter === 'all' ||
            (r.latencyMs != null &&
              speedCategory(r.latencyMs, { goodMs: proxyGoodMs, okMs: proxyOkMs }) === speedFilter))
      ).length
    : 0
  const saveLabel =
    speedFilter === 'all' || speedFilter === 'failed'
      ? 'Working'
      : speedFilter.charAt(0).toUpperCase() + speedFilter.slice(1)

  return (
    <ToolLayout
      title="Proxy Tester"
      onBack={onBack}
      onRun={canRun ? handleRun : undefined}
      active={active}
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
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="btcollectibles.com"
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
            setSpeedFilter('all')
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
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                Filter by speed
              </span>
              {(
                [
                  ['all', 'All', speedCounts.all],
                  ['good', 'Good', speedCounts.good],
                  ['ok', 'Ok', speedCounts.ok],
                  ['slow', 'Slow', speedCounts.slow],
                  ['failed', 'Failed', speedCounts.failed]
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  onClick={() => setSpeedFilter(id)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
                    speedFilter === id
                      ? 'bg-accent-soft text-accent'
                      : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                  }`}
                >
                  {label} <span className="text-text-muted">{n}</span>
                </button>
              ))}
            </div>
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
                  {(visibleResults ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-surface-2">
                      <td className="px-3 py-1.5 text-text-primary break-all">{r.raw || '—'}</td>
                      <td className={`px-3 py-1.5 text-right ${MS_COLOR[categoryOf(r)]}`}>
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
                <Button onClick={handleSaveWorking} variant="secondary" disabled={saveCount === 0}>
                  <Icons.Save />
                  Save {saveLabel}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </ToolLayout>
  )
}
