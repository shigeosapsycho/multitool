import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { multiplyLines } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function MultiplyLinesPage({ onBack, onSetStatus, active }: Props) {
  const [countInput, setCountInput] = useState<string>('2')
  // Clamp to a sane positive integer; empty/invalid input falls back to 1.
  const count = Math.max(1, Math.floor(Number(countInput)) || 1)

  return (
    <SingleFileTool
      title="Multiply Lines"
      hint="Pick a text file to repeat each non-empty line a set number of times."
      taskName="multiplied"
      resultLabel="Multiplied"
      resultUnit="lines"
      emptyResultMessage="File has no content to multiply."
      runLabel="Multiply"
      transform={(text) => multiplyLines(text, count)}
      toolbar={
        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Copies per line
          </span>
          <input
            type="number"
            min={1}
            value={countInput}
            onChange={(e) => setCountInput(e.target.value)}
            className="h-10 w-40 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent"
          />
        </label>
      }
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
