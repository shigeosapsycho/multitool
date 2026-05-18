import { SingleFileTool } from './SingleFileTool'
import { reverseLines } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function ReverseListPage({ onBack, onSetStatus, active }: Props) {
  return (
    <SingleFileTool
      title="Reverse List"
      hint="Pick a text file to reverse the order of its non-empty lines."
      taskName="reversed"
      resultLabel="Reversed"
      resultUnit="lines"
      emptyResultMessage="File has no content to reverse."
      runLabel="Reverse"
      transform={reverseLines}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
