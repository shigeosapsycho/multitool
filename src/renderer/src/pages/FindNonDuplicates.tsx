import { SingleFileTool } from './SingleFileTool'
import { nonDuplicatesFromText } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function FindNonDuplicatesPage({ onBack, onSetStatus }: Props) {
  return (
    <SingleFileTool
      title="Find Non-Duplicates"
      hint="Pick a text file to surface lines that appear only once."
      taskName="non_duplicates"
      resultLabel="Non-Duplicates"
      resultUnit="unique items"
      emptyResultMessage="No non-duplicates found."
      runLabel="Find Non-Duplicates"
      transform={nonDuplicatesFromText}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
