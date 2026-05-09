import { TwoFileTool } from './TwoFileTool'
import { searchInMaster } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function SearchMasterPage({ onBack, onSetStatus, active }: Props) {
  return (
    <TwoFileTool
      title="Search Master"
      hint="Provide a master list and a search list. Returns items from the search list that also appear in the master."
      taskName="search_matches"
      file1Label="Master List"
      file2Label="Search List"
      resultLabel="Matches"
      resultUnit="matches"
      emptyResultMessage="No items from the search list were found in the master."
      runLabel="Search"
      transform={searchInMaster}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
