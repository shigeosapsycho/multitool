import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { TwoFileTool } from './TwoFileTool'
import { ModeToggle, type FileMode } from '../components/ModeToggle'
import { nonDuplicatesFromText, nonDuplicatesFromTwoTexts } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function FindNonDuplicatesPage({ onBack, onSetStatus, active }: Props) {
  const [mode, setMode] = useState<FileMode>('single')
  const toggle = <ModeToggle mode={mode} onChange={setMode} />

  if (mode === 'double') {
    return (
      <TwoFileTool
        title="Find Non-Duplicates"
        hint="Combine two files and surface lines that appear exactly once in the union."
        taskName="non_duplicates_2files"
        resultLabel="Non-Duplicates"
        resultUnit="unique items"
        emptyResultMessage="No non-duplicates in the union."
        runLabel="Find Non-Duplicates"
        transform={nonDuplicatesFromTwoTexts}
        toolbar={toggle}
        active={active}
        onBack={onBack}
        onSetStatus={onSetStatus}
      />
    )
  }

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
      toolbar={toggle}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
