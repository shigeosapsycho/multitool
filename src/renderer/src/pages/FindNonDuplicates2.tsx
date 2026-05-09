import { TwoFileTool } from './TwoFileTool'
import { nonDuplicatesFromTwoTexts } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function FindNonDuplicates2Page({ onBack, onSetStatus, active }: Props) {
  return (
    <TwoFileTool
      title="Non-Duplicates Across 2 Files"
      hint="Combine two files and surface lines that appear exactly once in the union."
      taskName="non_duplicates_2files"
      resultLabel="Non-Duplicates"
      resultUnit="unique items"
      emptyResultMessage="No non-duplicates in the union."
      runLabel="Find Non-Duplicates"
      transform={nonDuplicatesFromTwoTexts}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
