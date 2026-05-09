import { useCallback, useEffect, useState } from 'react'
import type { LogEntry, Route } from './types'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ToolsPage } from './pages/Tools'
import { Placeholder } from './pages/Placeholder'
import { FindDuplicatesPage } from './pages/FindDuplicates'
import { FindDuplicates2Page } from './pages/FindDuplicates2'
import { FindNonDuplicatesPage } from './pages/FindNonDuplicates'
import { FindNonDuplicates2Page } from './pages/FindNonDuplicates2'
import { RemovePasswordsPage } from './pages/RemovePasswords'
import { SplitEvenlyPage } from './pages/SplitEvenly'
import { SplitByNumberPage } from './pages/SplitByNumber'
import { RandomizePage } from './pages/Randomize'
import { SearchMasterPage } from './pages/SearchMaster'
import { ResultsPage } from './pages/Results'
import { SettingsPage } from './pages/Settings'
import { LogsPage } from './pages/Logs'

type NavState = { history: Route[]; index: number }

const TOOL_ROUTES: Exclude<Route, 'tools' | 'results' | 'settings' | 'logs'>[] = [
  'find-duplicates',
  'find-duplicates-2',
  'find-non-duplicates',
  'find-non-duplicates-2',
  'remove-passwords',
  'split-evenly',
  'split-by-n',
  'randomize',
  'search-master'
]

function isToolRoute(r: Route): boolean {
  return (TOOL_ROUTES as Route[]).includes(r)
}

export default function App() {
  const [nav, setNav] = useState<NavState>({ history: ['tools'], index: 0 })
  const [version, setVersion] = useState('2.0.0')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [updateReady, setUpdateReady] = useState(false)
  const [filePreview, setFilePreview] = useState(false)
  const [deleteToTrash, setDeleteToTrash] = useState(true)
  const [visitedTools, setVisitedTools] = useState<Set<Route>>(new Set())
  const noopStatus = () => {}

  const route = nav.history[nav.index] ?? 'tools'

  useEffect(() => {
    window.api.app.getVersion().then(setVersion).catch(() => {})
    window.api.config
      .get()
      .then((cfg) => {
        setFilePreview(cfg.filePreview)
        setDeleteToTrash(cfg.deleteToTrash)
      })
      .catch(() => {})
  }, [])

  // Subscribe to auto-updater status messages and accumulate them as logs.
  // App is always mounted, so we never miss events even if Logs page isn't open.
  useEffect(() => {
    return window.api.updater.onStatus((status) => {
      let message = ''
      let kind: LogEntry['kind'] = 'info'
      switch (status.type) {
        case 'checking':
          message = `Fetching updates (${status.currentVersion})...`
          break
        case 'no-update':
          message = 'No updates found.'
          kind = 'success'
          break
        case 'available':
          message = `Updating to new version (v${status.version})...`
          break
        case 'downloaded':
          message = 'Update files finished installing! Restart the app to apply the update.'
          kind = 'success'
          setUpdateReady(true)
          break
        case 'error':
          message = `Update error: ${status.message}`
          kind = 'error'
          break
      }
      setLogs((prev) => [...prev, { time: Date.now(), message, kind }])
    })
  }, [])

  const navigate = useCallback((next: Route) => {
    if (isToolRoute(next)) {
      setVisitedTools((prev) => {
        if (prev.has(next)) return prev
        const out = new Set(prev)
        out.add(next)
        return out
      })
    }
    setNav((prev) => {
      const truncated = prev.history.slice(0, prev.index + 1)
      if (truncated[truncated.length - 1] === next) return prev
      const history = [...truncated, next]
      return { history, index: history.length - 1 }
    })
  }, [])

  const goBack = useCallback(() => {
    setNav((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev))
  }, [])

  const goForward = useCallback(() => {
    setNav((prev) =>
      prev.index < prev.history.length - 1 ? { ...prev, index: prev.index + 1 } : prev
    )
  }, [])

  // Mouse4 / Mouse5 ("Back" / "Forward" thumb buttons). Listen via three paths
  // and debounce per-direction so a single click that fires multiple events
  // (mousedown + mouseup + auxclick + APPCOMMAND IPC) only triggers one nav.
  //   1. DOM mousedown/mouseup (e.button === 3 for back, === 4 for forward).
  //   2. DOM auxclick — fallback when Chromium swallows mousedown for X-buttons.
  //   3. Windows APPCOMMAND messages forwarded from the main process via IPC.
  // The debounce window must cover the worst-case spread between these events,
  // which can be 100ms+ between DOM and IPC. 250ms still feels snappy for
  // intentional consecutive clicks.
  useEffect(() => {
    let lastBack = 0
    let lastForward = 0
    const DEBOUNCE_MS = 250
    const navBack = () => {
      const now = Date.now()
      if (now - lastBack < DEBOUNCE_MS) return
      lastBack = now
      goBack()
    }
    const navForward = () => {
      const now = Date.now()
      if (now - lastForward < DEBOUNCE_MS) return
      lastForward = now
      goForward()
    }

    const mouseHandler = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        navBack()
      } else if (e.button === 4) {
        e.preventDefault()
        navForward()
      }
    }
    window.addEventListener('mousedown', mouseHandler)
    window.addEventListener('mouseup', mouseHandler)
    window.addEventListener('auxclick', mouseHandler)

    const offBack = window.api.nav.onBack(navBack)
    const offForward = window.api.nav.onForward(navForward)

    return () => {
      window.removeEventListener('mousedown', mouseHandler)
      window.removeEventListener('mouseup', mouseHandler)
      window.removeEventListener('auxclick', mouseHandler)
      offBack()
      offForward()
    }
  }, [goBack, goForward])

  // Esc goes back, mirroring mouse4. Skip when an input/textarea is focused
  // so users editing content can press Esc to deselect natively.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      goBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goBack])

  function renderTool(r: Route, active: boolean): JSX.Element | null {
    const props = { onBack: goBack, onSetStatus: noopStatus, active }
    switch (r) {
      case 'find-duplicates':
        return <FindDuplicatesPage {...props} />
      case 'find-duplicates-2':
        return <FindDuplicates2Page {...props} />
      case 'find-non-duplicates':
        return <FindNonDuplicatesPage {...props} />
      case 'find-non-duplicates-2':
        return <FindNonDuplicates2Page {...props} />
      case 'remove-passwords':
        return <RemovePasswordsPage {...props} />
      case 'split-evenly':
        return <SplitEvenlyPage {...props} />
      case 'split-by-n':
        return <SplitByNumberPage {...props} />
      case 'randomize':
        return <RandomizePage {...props} />
      case 'search-master':
        return <SearchMasterPage {...props} />
      default:
        return null
    }
  }

  // Non-tool page rendering (re-mounts on every visit; cheap since they hold no transient state).
  let nonToolContent: JSX.Element | null = null
  if (route === 'tools') nonToolContent = <ToolsPage onNavigate={navigate} />
  else if (route === 'results')
    nonToolContent = <ResultsPage filePreview={filePreview} deleteToTrash={deleteToTrash} />
  else if (route === 'settings')
    nonToolContent = (
      <SettingsPage
        filePreview={filePreview}
        onFilePreviewChange={setFilePreview}
        deleteToTrash={deleteToTrash}
        onDeleteToTrashChange={setDeleteToTrash}
      />
    )
  else if (route === 'logs') nonToolContent = <LogsPage logs={logs} />

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TitleBar title="Beu MultiTool" version={version} />
      <div className="flex min-h-0 flex-1">
        <Sidebar current={route} onNavigate={navigate} />
        <main className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
          {/* Non-tool pages: animated, re-mount on each visit. */}
          {nonToolContent && (
            <div key={route} className="page-enter h-full">
              {nonToolContent}
            </div>
          )}

          {/* Tool pages: keep mounted once visited so state survives navigation.
              Only the active one is shown; the rest are hidden via display:none. */}
          {(TOOL_ROUTES as Route[]).map((r) => {
            if (!visitedTools.has(r)) return null
            const isActive = route === r
            return (
              <div
                key={r}
                style={{ display: isActive ? 'block' : 'none' }}
                className="h-full"
              >
                {renderTool(r, isActive)}
              </div>
            )
          })}
        </main>
      </div>
      {updateReady && <StatusBar message="Update available restart to apply changes" />}
    </div>
  )
}
