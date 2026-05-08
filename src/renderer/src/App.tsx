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
import { ResultsPage } from './pages/Results'
import { SettingsPage } from './pages/Settings'
import { LogsPage } from './pages/Logs'

type NavState = { history: Route[]; index: number }

export default function App() {
  const [nav, setNav] = useState<NavState>({ history: ['tools'], index: 0 })
  const [version, setVersion] = useState('2.0.0')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [updateReady, setUpdateReady] = useState(false)
  const [filePreview, setFilePreview] = useState(false)
  const noopStatus = () => {}

  const route = nav.history[nav.index] ?? 'tools'

  useEffect(() => {
    window.api.app.getVersion().then(setVersion).catch(() => {})
    window.api.config
      .get()
      .then((cfg) => setFilePreview(cfg.filePreview))
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

  // Mouse4 (DOM button === 3, XButton1) = back; Mouse5 (DOM button === 4, XButton2) = forward.
  // Standard Windows mapping.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        goBack()
      } else if (e.button === 4) {
        e.preventDefault()
        goForward()
      }
    }
    // Listen on both mousedown and mouseup — Chromium fires browser-back on
    // mousedown by default, so blocking there prevents any unwanted default.
    window.addEventListener('mousedown', handler)
    window.addEventListener('mouseup', handler)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('mouseup', handler)
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

  let content: JSX.Element
  switch (route) {
    case 'tools':
      content = <ToolsPage onNavigate={navigate} />
      break
    case 'find-duplicates':
      content = <FindDuplicatesPage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'find-duplicates-2':
      content = <FindDuplicates2Page onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'find-non-duplicates':
      content = <FindNonDuplicatesPage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'find-non-duplicates-2':
      content = <FindNonDuplicates2Page onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'remove-passwords':
      content = <RemovePasswordsPage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'split-evenly':
      content = <SplitEvenlyPage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'split-by-n':
      content = <SplitByNumberPage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'randomize':
      content = <RandomizePage onBack={goBack} onSetStatus={noopStatus} />
      break
    case 'results':
      content = <ResultsPage filePreview={filePreview} />
      break
    case 'settings':
      content = <SettingsPage filePreview={filePreview} onFilePreviewChange={setFilePreview} />
      break
    case 'logs':
      content = <LogsPage logs={logs} />
      break
    default:
      content = <Placeholder title="Tool" onBack={goBack} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TitleBar title="Beu MultiTool" version={version} />
      <div className="flex min-h-0 flex-1">
        <Sidebar current={route} onNavigate={navigate} />
        <main key={route} className="page-enter min-w-0 flex-1 overflow-auto">
          {content}
        </main>
      </div>
      {updateReady && <StatusBar message="Update available restart to apply changes" />}
    </div>
  )
}
