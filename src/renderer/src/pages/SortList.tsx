import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { sortList, type SortDirection } from '../lib/sortList'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function SortListPage({ onBack, onSetStatus, active }: Props) {
  const [direction, setDirection] = useState<SortDirection>('asc')

  const toolbar = (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
        Order
      </span>
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
        {(
          [
            ['asc', 'A → Z'],
            ['desc', 'Z → A']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setDirection(id)}
            className={`inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium transition ${
              direction === id
                ? 'bg-accent-soft text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <SingleFileTool
      title="Alphabetizer"
      hint="Pick a text file to sort its lines alphabetically (case-insensitive, natural order)."
      taskName="sorted"
      resultLabel="Sorted"
      resultUnit="lines"
      emptyResultMessage="File has no lines to sort."
      runLabel="Sort"
      transform={(text) => sortList(text, direction)}
      toolbar={toolbar}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
