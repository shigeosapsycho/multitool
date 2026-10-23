import { TwoFileTool } from './TwoFileTool'
import { searchInMaster } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function SearchMasterPage({ onBack, onSetStatus, active }: Props) {
  return (
    <TwoFileTool
      title="Search Master"
      hint="Provide a master list and a search list. Returns the full master lines that a search item matches, whole or by any one field (e.g. an email finds email:password)."
      taskName="search_matches"
      file1Label="Master List"
      file2Label="Search List"
      resultLabel="Matches"
      resultUnit="matches"
      emptyResultMessage="No search items were found in the master."
      runLabel="Search"
      transform={searchInMaster}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
