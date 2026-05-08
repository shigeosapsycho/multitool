import { SingleFileTool } from './SingleFileTool'
import { stripPasswordsFromText } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void }

export function RemovePasswordsPage({ onBack, onSetStatus }: Props) {
  return (
    <SingleFileTool
      title="Remove Passwords"
      hint="Strips ':password' from each line. Lines without a colon pass through unchanged."
      taskName="usernames"
      resultLabel="Usernames"
      resultUnit="usernames"
      emptyResultMessage="No usernames extracted."
      runLabel="Strip Passwords"
      transform={stripPasswordsFromText}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
