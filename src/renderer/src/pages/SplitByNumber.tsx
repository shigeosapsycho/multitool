import { useState } from 'react'
import { SplitTool } from './SplitTool'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function SplitByNumberPage({ onBack, onSetStatus }: Props) {
  const [nInput, setNInput] = useState<string>('5')

  return (
    <SplitTool
      title="Split by Number"
      hint="Split a file into N evenly-sized parts. Remainder is distributed across the first chunks."
      runLabel="Split"
      controls={
        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Number of files
          </span>
          <input
            type="number"
            min={1}
            value={nInput}
            onChange={(e) => setNInput(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent"
          />
        </label>
      }
      getChunks={(lines) => {
        const n = parseInt(nInput, 10)
        if (Number.isNaN(n)) return { error: 'Please enter a valid number.' }
        if (n <= 0) return { error: 'Number must be greater than 0.' }
        if (lines.length === 0) return { error: 'File is empty.' }
        if (n > lines.length)
          return { error: `Cannot split ${lines.length} lines into ${n} files.` }

        const baseSize = Math.floor(lines.length / n)
        const remainder = lines.length % n
        const chunks: string[][] = []
        let start = 0
        for (let i = 0; i < n; i++) {
          const size = baseSize + (i < remainder ? 1 : 0)
          chunks.push(lines.slice(start, start + size))
          start += size
        }
        return chunks
      }}
      partName={(base, i) => `${base}_part${i + 1}`}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
