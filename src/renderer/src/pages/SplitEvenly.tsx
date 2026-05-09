import { SplitTool } from './SplitTool'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function SplitEvenlyPage({ onBack, onSetStatus, active }: Props) {
  return (
    <SplitTool
      title="Split File Evenly"
      hint="Split a file into two equally-sized parts. On odd line counts, part 1 gets the extra line."
      runLabel="Split"
      getChunks={(lines) => {
        if (lines.length === 0) return { error: 'File is empty.' }
        const total = lines.length
        const mid = Math.floor(total / 2) + (total % 2)
        return [lines.slice(0, mid), lines.slice(mid)]
      }}
      partName={(base, i) => `${base}_part${i + 1}`}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
