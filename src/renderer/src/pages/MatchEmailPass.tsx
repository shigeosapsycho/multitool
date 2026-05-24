import { TwoFileTool } from './TwoFileTool'
import { matchEmailPassByEmails } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function MatchEmailPassPage({ onBack, onSetStatus, active }: Props) {
  return (
    <TwoFileTool
      title="Match Email:Password"
      hint="Keep email:password rows whose email appears in a separate emails list."
      taskName="email_pass_matched"
      file1Label="Emails List"
      file2Label="Email:Password List"
      resultLabel="Matched Email:Password"
      resultUnit="matched"
      emptyResultMessage="No email:password rows matched the emails list."
      runLabel="Match"
      transform={matchEmailPassByEmails}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
