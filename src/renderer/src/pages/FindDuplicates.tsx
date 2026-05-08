import { SingleFileTool } from './SingleFileTool'
import { duplicatesFromText } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function FindDuplicatesPage({ onBack, onSetStatus }: Props) {
  return (
    <SingleFileTool
      title="Find Duplicates"
      hint="Pick a text file. Lines like '1\ttext' are auto-stripped to just the content."
      taskName="duplicates"
      resultLabel="Duplicates"
      resultUnit="duplicates"
      emptyResultMessage="No duplicates found."
      runLabel="Find Duplicates"
      transform={duplicatesFromText}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
