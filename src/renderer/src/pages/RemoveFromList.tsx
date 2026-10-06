import { useRef, useState } from 'react'
import { TwoFileTool } from './TwoFileTool'
import { Toggle } from '../components/Toggle'
import {
  removeFromList,
  type MatchMode,
  type RemoveFromListOptions,
  type RemoveFromListResult
} from '../lib/removeFromList'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const MATCH_MODES: { id: MatchMode; label: string; example: string }[] = [
  { id: 'line', label: 'Whole line', example: 'the entire line must match' },
  { id: 'field', label: 'Field', example: '"john" removes "john:pass", not "johnny:pass"' },
  { id: 'contains', label: 'Contains', example: '"john" removes any line with john in it' }
]

type CachedRun = { master: string; remove: string; opts: RemoveFromListOptions; result: RemoveFromListResult }

export function RemoveFromListPage({ onBack, onSetStatus, active }: Props) {
  // Defaults suit email lists, where case and stray spaces never matter.
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [ignoreSpacing, setIgnoreSpacing] = useState(true)
  const [match, setMatch] = useState<MatchMode>('line')
  const [showUnused, setShowUnused] = useState(false)

  // TwoFileTool calls the main and the secondary transform back to back on
  // the same inputs. Caching the last run lets both read one computation
  // instead of matching the lists twice.
  const lastRun = useRef<CachedRun | null>(null)
  function run(master: string, remove: string): RemoveFromListResult {
    const opts: RemoveFromListOptions = { caseSensitive, ignoreSpacing, match }
    const c = lastRun.current
    if (
      c &&
      c.master === master &&
      c.remove === remove &&
      c.opts.caseSensitive === opts.caseSensitive &&
      c.opts.ignoreSpacing === opts.ignoreSpacing &&
      c.opts.match === opts.match
    ) {
      return c.result
    }
    const result = removeFromList(master, remove, opts)
    lastRun.current = { master, remove, opts, result }
    return result
  }

  const mode = MATCH_MODES.find((m) => m.id === match)!

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
        <span className="text-[12px] text-text-muted">{mode.example}</span>
      </div>
      <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
        <Toggle checked={caseSensitive} onChange={setCaseSensitive} ariaLabel="Case sensitive" />
        Case sensitive
      </label>
      <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
        <Toggle checked={ignoreSpacing} onChange={setIgnoreSpacing} ariaLabel="Ignore spacing" />
        Ignore spacing
      </label>
      <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
        <input
          type="checkbox"
          checked={showUnused}
          onChange={(e) => setShowUnused(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Show unused entries
      </label>
    </div>
  )

  return (
    <TwoFileTool
      title="Remove From List"
      hint="Provide a master list and a list of entries to remove. Every master line that matches an entry is dropped."
      taskName="removed_from_list"
      file1Label="Master List"
      file2Label="Remove List"
      resultLabel="Remaining"
      resultUnit="remaining"
      emptyResultMessage="Every line in the master list was removed."
      runLabel="Remove"
      transform={(master, remove) => run(master, remove).kept}
      secondary={
        showUnused
          ? {
              label: 'Unused Entries',
              unit: 'unused',
              emptyResultMessage: 'Every entry in the remove list matched something.',
              taskName: 'unused_entries',
              transform: (master, remove) => run(master, remove).unused
            }
          : undefined
      }
      toolbar={toolbar}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
