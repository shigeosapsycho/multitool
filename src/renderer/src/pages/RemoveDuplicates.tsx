import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { TwoFileTool } from './TwoFileTool'
import { ModeToggle, type FileMode } from '../components/ModeToggle'
import { dedupeFromText, dedupeFromTwoTexts } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function RemoveDuplicatesPage({ onBack, onSetStatus, active }: Props) {
  const [mode, setMode] = useState<FileMode>('single')
  const toggle = <ModeToggle mode={mode} onChange={setMode} />

  if (mode === 'double') {
    return (
      <TwoFileTool
        title="Remove Duplicates"
        hint="Combine two files and keep one copy of every line, in first-seen order."
        taskName="remove_duplicates_2files"
        resultLabel="Deduplicated"
        resultUnit="lines"
        emptyResultMessage="Both files were empty."
        runLabel="Remove Duplicates"
        transform={dedupeFromTwoTexts}
        toolbar={toggle}
        active={active}
        onBack={onBack}
        onSetStatus={onSetStatus}
      />
    )
  }

  return (
    <SingleFileTool
      title="Remove Duplicates"
      hint="Pick a text file to keep one copy of each line and drop the repeats."
      taskName="remove_duplicates"
      resultLabel="Deduplicated"
      resultUnit="lines"
      emptyResultMessage="File was empty."
      runLabel="Remove Duplicates"
      transform={dedupeFromText}
      toolbar={toggle}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
