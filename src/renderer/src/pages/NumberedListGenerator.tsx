import { useState } from 'react'
import { ToolLayout, ResultPanel, Button, Icons, Stat } from '../components/ToolShell'
import { Card } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { shortOutputPath } from '../lib/paths'
import { generateNumberedList } from '../lib/generateNumberedList'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary'
const INPUT =
  'h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent'

// Cap to keep an absurd range (e.g. 1..50,000,000) from freezing the UI.
const MAX_COUNT = 1_000_000

function toInt(v: string): number {
  const n = Math.trunc(Number(v))
  return Number.isNaN(n) ? 0 : n
}

export function NumberedListGeneratorPage({ onBack, onSetStatus, active }: Props) {
  const [prefix, setPrefix] = useState('')
  const [start, setStart] = useState(1)
  const [end, setEnd] = useState(100)
  const [duplicate, setDuplicate] = useState(false)
  const [result, setResult] = useState<string[]>([])
  const [ran, setRan] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  function handleGenerate() {
    setSavedTo(null)
    setRan(true)
    const span = end - start + 1
    if (span <= 0) {
      setResult([])
      return
    }
    const count = duplicate ? span * 2 : span
    if (count > MAX_COUNT) {
      setResult([])
      return
    }
    setResult(generateNumberedList(prefix, start, end, duplicate))
  }

  function handleClear() {
    setResult([])
    setRan(false)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  return (
    <ToolLayout
      title="Numbered List Generator"
      onBack={onBack}
      onRun={handleGenerate}
      active={active}
      banner={
        ran && result.length > 0 ? (
          <Stat value={result.length.toLocaleString()} label="lines" />
        ) : (
          <span>Generate a sequential numbered list with a custom prefix.</span>
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
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-2">
            <span className={LABEL}>Prefix</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="BrandonVCC"
              className={INPUT}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2">
              <span className={LABEL}>Start #</span>
              <input
                type="number"
                value={start}
                onChange={(e) => setStart(toInt(e.target.value))}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={LABEL}>End #</span>
              <input
                type="number"
                value={end}
                onChange={(e) => setEnd(toInt(e.target.value))}
                className={INPUT}
              />
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <span className="text-[13px] text-text-primary">Repeat each number twice</span>
            <Toggle
              checked={duplicate}
              onChange={setDuplicate}
              ariaLabel="Repeat each number twice"
            />
          </label>
        </div>
      </Card>

      <ResultPanel
        label="Result"
        results={ran ? result : null}
        emptyMessage="Nothing to generate — check that Start ≤ End and the range is under 1,000,000."
        initialMessage={'Set a prefix and range, then "Generate".'}
        taskName="numbered-list"
        savedTo={savedTo}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${shortOutputPath(path)}`)
        }}
      />
    </ToolLayout>
  )
}
