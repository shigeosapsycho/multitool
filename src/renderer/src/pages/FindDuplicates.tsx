import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { TwoFileTool } from './TwoFileTool'
import { ModeToggle, type FileMode } from '../components/ModeToggle'
import { duplicatesFromText, duplicatesFromTwoTexts } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function FindDuplicatesPage({ onBack, onSetStatus, active }: Props) {
  const [mode, setMode] = useState<FileMode>('single')
  const toggle = <ModeToggle mode={mode} onChange={setMode} />

  if (mode === 'double') {
    return (
      <TwoFileTool
        title="Find Duplicates"
        hint="Combine two files and surface lines that appear more than once across both."
        taskName="duplicates_2files"
        resultLabel="Duplicates"
        resultUnit="duplicates"
        emptyResultMessage="No duplicates across the two files."
        runLabel="Find Duplicates"
        transform={duplicatesFromTwoTexts}
        toolbar={toggle}
        active={active}
        onBack={onBack}
        onSetStatus={onSetStatus}
      />
    )
  }

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
      toolbar={toggle}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
