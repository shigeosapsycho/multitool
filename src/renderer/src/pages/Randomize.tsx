import { SingleFileTool } from './SingleFileTool'
import { shuffleLines } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function RandomizePage({ onBack, onSetStatus }: Props) {
  return (
    <SingleFileTool
      title="Randomize List"
      hint="Pick a text file to shuffle its non-empty lines into random order."
      taskName="randomized"
      resultLabel="Randomized"
      resultUnit="lines"
      emptyResultMessage="File has no content to shuffle."
      runLabel="Randomize"
      transform={shuffleLines}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
