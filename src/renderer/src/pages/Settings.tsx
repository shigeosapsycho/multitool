import { useEffect, useState } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Icons } from '../components/ToolShell'

export function SettingsPage() {
  const [outputDir, setOutputDir] = useState('—')

  useEffect(() => {
    void window.api.files.getOutputDir().then(setOutputDir)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" subtitle="App configuration." />
      <div className="grid grid-cols-1 gap-4 px-8 pb-8 xl:grid-cols-2">
        <Card label="Output">
          <div className="space-y-4 p-4 text-[13px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                Output folder
              </div>
              <div className="mt-1.5 break-all font-mono text-text-primary">{outputDir}</div>
            </div>
            <Button onClick={() => window.api.files.openOutputDir()} variant="secondary">
              <Icons.Folder />
              Open output folder
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
