import { SingleFileTool } from './SingleFileTool'
import { csvToEmailPass } from '../lib/transforms'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

export function CsvEmailPassPage({ onBack, onSetStatus, active }: Props) {
  return (
    <SingleFileTool
      title="CSV → Email:Password"
      hint="Load a CSV with 'email' and 'password' columns; outputs one email:password per row."
      taskName="email-pass"
      inputLabel="CSV File"
      resultLabel="Email:Password"
      resultUnit="pairs"
      emptyResultMessage="No email/password columns found, or no rows had values in both."
      runLabel="Extract Pairs"
      transform={(text) => csvToEmailPass(text).lines}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
