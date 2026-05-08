import { useEffect, useState } from 'react'
import type { Route } from './types'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
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

export default function App() {
  const [route, setRoute] = useState<Route>('tools')
  const [version, setVersion] = useState('2.0.0')
  const noopStatus = () => {}

  useEffect(() => {
    window.api.app.getVersion().then(setVersion).catch(() => {})
  }, [])

  function navigate(next: Route) {
    setRoute(next)
  }

  function back() {
    navigate('tools')
  }

  let content: JSX.Element
  switch (route) {
    case 'tools':
      content = <ToolsPage onNavigate={navigate} />
      break
    case 'find-duplicates':
      content = <FindDuplicatesPage onBack={back} onSetStatus={noopStatus} />
      break
    case 'find-duplicates-2':
      content = <FindDuplicates2Page onBack={back} onSetStatus={noopStatus} />
      break
    case 'find-non-duplicates':
      content = <FindNonDuplicatesPage onBack={back} onSetStatus={noopStatus} />
      break
    case 'find-non-duplicates-2':
      content = <FindNonDuplicates2Page onBack={back} onSetStatus={noopStatus} />
      break
    case 'remove-passwords':
      content = <RemovePasswordsPage onBack={back} onSetStatus={noopStatus} />
      break
    case 'split-evenly':
      content = <SplitEvenlyPage onBack={back} onSetStatus={noopStatus} />
      break
    case 'split-by-n':
      content = <SplitByNumberPage onBack={back} onSetStatus={noopStatus} />
      break
    case 'randomize':
      content = <RandomizePage onBack={back} onSetStatus={noopStatus} />
      break
    case 'results':
      content = <ResultsPage />
      break
    case 'settings':
      content = <SettingsPage />
      break
    default:
      content = <Placeholder title="Tool" onBack={back} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TitleBar title="Beu MultiTool" version={version} />
      <div className="flex min-h-0 flex-1">
        <Sidebar current={route} onNavigate={navigate} />
        <main className="min-w-0 flex-1 overflow-auto">{content}</main>
      </div>
    </div>
  )
}
