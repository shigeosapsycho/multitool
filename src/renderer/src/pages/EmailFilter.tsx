import { TwoFileTool } from './TwoFileTool'
import { filterEmailsBySuccess } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function EmailFilterPage({ onBack, onSetStatus, active }: Props) {
  return (
    <TwoFileTool
      title="Email Filter"
      hint="Remove emails from a master list that already appear in a success list (email:password format)."
      taskName="emails_filtered"
      file1Label="Success List"
      file2Label="Master List"
      resultLabel="Filtered Master"
      resultUnit="remaining"
      emptyResultMessage="Every master email was filtered out."
      runLabel="Filter"
      transform={filterEmailsBySuccess}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
