import { TwoFileTool } from './TwoFileTool'
import { duplicatesFromTwoTexts } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function FindDuplicates2Page({ onBack, onSetStatus }: Props) {
  return (
    <TwoFileTool
      title="Duplicates Across 2 Files"
      hint="Combine two files and surface lines that appear more than once across both."
      taskName="duplicates_2files"
      resultLabel="Duplicates"
      resultUnit="duplicates"
      emptyResultMessage="No duplicates across the two files."
      runLabel="Find Duplicates"
      transform={duplicatesFromTwoTexts}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
