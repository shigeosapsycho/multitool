import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { TwoFileTool } from './TwoFileTool'
import { ModeToggle, type FileMode } from '../components/ModeToggle'
import { dedupeFromText, dedupeFromTwoTexts } from '../lib/transforms'
import type { DedupeMatch } from '../lib/dedupe'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const MATCH_MODES: { id: DedupeMatch; label: string; example: string }[] = [
  { id: 'line', label: 'Whole line', example: 'the entire line must repeat' },
  {
    id: 'first-field',
    label: 'First field',
    example: '"john:pw1" and "john:pw2" count as one, the first is kept'
  }
]

export function RemoveDuplicatesPage({ onBack, onSetStatus, active }: Props) {
  const [mode, setMode] = useState<FileMode>('single')
  // Lives above the 1 File / 2 Files swap so switching layouts keeps the choice.
  const [match, setMatch] = useState<DedupeMatch>('line')
  const example = MATCH_MODES.find((m) => m.id === match)!.example

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <ModeToggle mode={mode} onChange={setMode} />
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Match
        </span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {MATCH_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMatch(m.id)}
              className={`inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium transition ${
                match === m.id
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-text-muted">{example}</span>
      </div>
    </div>
  )

  if (mode === 'double') {
    return (
      <TwoFileTool
        title="Remove Duplicates"
        hint="Combine two files and keep one copy of every line, in first-seen order."
        taskName="remove_duplicates_2files"
        resultLabel="Deduplicated"
        resultUnit="lines"
        emptyResultMessage="Both files were empty."
        runLabel="Remove Duplicates"
        transform={(t1, t2) => dedupeFromTwoTexts(t1, t2, match)}
        toolbar={toolbar}
        active={active}
        onBack={onBack}
        onSetStatus={onSetStatus}
      />
    )
  }

  return (
    <SingleFileTool
      title="Remove Duplicates"
      hint="Pick a text file to keep one copy of each line and drop the repeats."
      taskName="remove_duplicates"
      resultLabel="Deduplicated"
      resultUnit="lines"
      emptyResultMessage="File was empty."
      runLabel="Remove Duplicates"
      transform={(text) => dedupeFromText(text, match)}
      toolbar={toolbar}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
