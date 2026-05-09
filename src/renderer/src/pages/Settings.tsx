import { useEffect, useState } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { Icons } from '../components/ToolShell'

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
)

type Props = {
  filePreview: boolean
  onFilePreviewChange: (next: boolean) => void
}

export function SettingsPage({ filePreview, onFilePreviewChange }: Props) {
  const [outputDir, setOutputDir] = useState('—')

  useEffect(() => {
    void window.api.files.getOutputDir().then(setOutputDir)
  }, [])

  async function handleChangeFolder() {
    const next = await window.api.files.pickOutputDir()
    if (next) setOutputDir(next)
  }

  async function handleTogglePreview(next: boolean) {
    await window.api.config.setFilePreview(next)
    onFilePreviewChange(next)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" subtitle="App configuration." />
      <div className="grid grid-cols-1 gap-4 px-8 pb-8 xl:grid-cols-2">
        <Card label="Preview">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-text-primary">File previews</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  When on, the Output tab splits into a list and a preview pane. Clicking a file
                  shows its contents inline.
                </div>
              </div>
              <Toggle
                checked={filePreview}
                onChange={handleTogglePreview}
                ariaLabel="Toggle file previews"
              />
            </div>
          </div>
        </Card>

        <Card label="Output Folder">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="break-all font-mono text-text-primary">{outputDir}</div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleChangeFolder} variant="secondary">
                <PencilIcon />
                Change folder
              </Button>
              <Button onClick={() => window.api.files.openOutputDir()} variant="ghost">
                <Icons.Folder />
                Open
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
