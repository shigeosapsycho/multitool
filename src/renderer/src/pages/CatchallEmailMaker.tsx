import { useState } from 'react'
import { ToolLayout, ResultPanel, Button, Icons, Stat } from '../components/ToolShell'
import { Card } from '../components/Card'
import { shortOutputPath } from '../lib/paths'
import { MAX_CATCHALL_COUNT, generateCatchallEmails } from '../lib/catchallEmails'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary'
const INPUT =
  'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent'

function toInt(v: string): number {
  const n = Math.trunc(Number(v))
  return Number.isNaN(n) ? 0 : n
}

export function CatchallEmailMakerPage({ onBack, onSetStatus, active }: Props) {
  const [domain, setDomain] = useState('')
  const [count, setCount] = useState(100)
  const [result, setResult] = useState<string[]>([])
  const [ran, setRan] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  function handleGenerate() {
    setSavedTo(null)
    setRan(true)
    setResult(generateCatchallEmails(domain, count))
  }

  function handleClear() {
    setResult([])
    setRan(false)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  return (
    <ToolLayout
      title="Catchall Email Maker"
      onBack={onBack}
      onRun={handleGenerate}
      active={active}
      banner={
        ran && result.length > 0 ? (
          <Stat value={result.length.toLocaleString()} label="emails" />
        ) : (
          <span>Generate random name-style emails on your catchall domain.</span>
        )
      }
      actions={
        <>
          <Button onClick={handleClear} variant="ghost">
            <Icons.Trash />
            Clear
          </Button>
          <Button onClick={handleGenerate} variant="primary">
            <Icons.Play />
            Generate
          </Button>
        </>
      }
    >
      <Card label="Settings">
        <div className="grid grid-cols-[2fr_1fr] gap-3 p-4">
          <label className="flex flex-col gap-2">
            <span className={LABEL}>Domain</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="claude.ai"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className={LABEL}>Amount</span>
            <input
              type="number"
              min={1}
              max={MAX_CATCHALL_COUNT}
              value={count}
              onChange={(e) => setCount(toInt(e.target.value))}
              className={INPUT}
            />
          </label>
        </div>
      </Card>

      <ResultPanel
        label="Result"
        results={ran ? result : null}
        emptyMessage={`Nothing to generate, check the domain (like claude.ai) and that the amount is between 1 and ${MAX_CATCHALL_COUNT.toLocaleString()}.`}
        initialMessage={'Enter your catchall domain and an amount, then "Generate".'}
        taskName="catchall-emails"
        savedTo={savedTo}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${shortOutputPath(path)}`)
        }}
      />
    </ToolLayout>
  )
}
