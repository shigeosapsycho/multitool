import { useEffect, useState } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { Select } from '../components/Select'
import { Icons } from '../components/ToolShell'
import type { GroupingMode } from '../lib/targetSkus'
import { PROXY_SPEED_DEFAULTS } from '../lib/proxySpeed'

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
)

const UpdateCheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

type ThemePref = 'system' | 'light' | 'dark'
type OutputSort = 'name' | 'size' | 'modified'

type Props = {
  filePreview: boolean
  onFilePreviewChange: (next: boolean) => void
  deleteToTrash: boolean
  onDeleteToTrashChange: (next: boolean) => void
  theme: ThemePref
  onThemeChange: (next: ThemePref) => void
  outputSort: OutputSort
  onOutputSortChange: (next: OutputSort) => void
  pokemonGrouping: GroupingMode
  onPokemonGroupingChange: (next: GroupingMode) => void
  restoreLastModule: boolean
  onRestoreLastModuleChange: (next: boolean) => void
  orderBySelectDate: boolean
  onOrderBySelectDateChange: (next: boolean) => void
  autoFocusInput: boolean
  onAutoFocusInputChange: (next: boolean) => void
  formatCsv: boolean
  onFormatCsvChange: (next: boolean) => void
  confirmPermanentDelete: boolean
  onConfirmPermanentDeleteChange: (next: boolean) => void
  proxyGoodMs: number
  onProxyGoodMsChange: (next: number) => void
  proxyOkMs: number
  onProxyOkMsChange: (next: number) => void
}

export function SettingsPage({
  filePreview,
  onFilePreviewChange,
  deleteToTrash,
  onDeleteToTrashChange,
  theme,
  onThemeChange,
  outputSort,
  onOutputSortChange,
  pokemonGrouping,
  onPokemonGroupingChange,
  restoreLastModule,
  onRestoreLastModuleChange,
  orderBySelectDate,
  onOrderBySelectDateChange,
  autoFocusInput,
  onAutoFocusInputChange,
  formatCsv,
  onFormatCsvChange,
  confirmPermanentDelete,
  onConfirmPermanentDeleteChange,
  proxyGoodMs,
  onProxyGoodMsChange,
  proxyOkMs,
  onProxyOkMsChange
}: Props) {
  const [outputDir, setOutputDir] = useState('-')

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

  async function handleToggleTrash(next: boolean) {
    await window.api.config.setDeleteToTrash(next)
    onDeleteToTrashChange(next)
  }

  async function handleToggleConfirmPermanentDelete(next: boolean) {
    await window.api.config.setConfirmPermanentDelete(next)
    onConfirmPermanentDeleteChange(next)
  }

  async function handleChangeTheme(next: ThemePref) {
    await window.api.config.setTheme(next)
    onThemeChange(next)
  }

  async function handleChangeOutputSort(next: OutputSort) {
    await window.api.config.setOutputSort(next)
    onOutputSortChange(next)
  }

  async function handleChangePokemonGrouping(next: GroupingMode) {
    await window.api.config.setPokemonGrouping(next)
    onPokemonGroupingChange(next)
  }

  async function handleToggleRestoreLastModule(next: boolean) {
    await window.api.config.setRestoreLastModule(next)
    onRestoreLastModuleChange(next)
  }

  async function handleToggleOrderBySelectDate(next: boolean) {
    await window.api.config.setOrderBySelectDate(next)
    onOrderBySelectDateChange(next)
  }

  async function handleToggleAutoFocusInput(next: boolean) {
    await window.api.config.setAutoFocusInput(next)
    onAutoFocusInputChange(next)
  }

  async function handleToggleFormatCsv(next: boolean) {
    await window.api.config.setFormatCsv(next)
    onFormatCsvChange(next)
  }

  const [checkingUpdate, setCheckingUpdate] = useState(false)
  async function handleCheckForUpdates() {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
      await window.api.updater.check()
    } finally {
      // Brief visual feedback. Real result lands in the Logs tab via the
      // updater:status events, which App.tsx already subscribes to.
      setTimeout(() => setCheckingUpdate(false), 800)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Settings"
        subtitle="App configuration."
        actions={
          <Button onClick={handleCheckForUpdates} variant="secondary" disabled={checkingUpdate}>
            <UpdateCheckIcon />
            {checkingUpdate ? 'Checking…' : 'Check for updates'}
          </Button>
        }
      />
      <div className="grid grid-cols-1 items-start gap-4 px-8 pb-8 xl:grid-cols-2">
        <Card label="Theme">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-text-primary">Color theme</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  Match your system, or pick light or dark explicitly.
                </div>
              </div>
              <Select
                value={theme}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]}
                onChange={handleChangeTheme}
                ariaLabel="Color theme"
              />
            </div>
          </div>
        </Card>

        <Card label="Navigation">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-text-primary">Resume last module</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  When on, the Tools tab reopens the module you had open instead of the
                  tool list, so switching to Settings or Output and back keeps your place.
                </div>
              </div>
              <Toggle
                checked={restoreLastModule}
                onChange={handleToggleRestoreLastModule}
                ariaLabel="Toggle resume last module"
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-[14px] text-text-primary">Auto-focus input</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  When on, opening a module puts the cursor in its input box, so you can
                  paste (Ctrl+V) right away without clicking first.
                </div>
              </div>
              <Toggle
                checked={autoFocusInput}
                onChange={handleToggleAutoFocusInput}
                ariaLabel="Toggle auto-focus input"
              />
            </div>
          </div>
        </Card>

        <Card label="Deletion">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-text-primary">Send to Recycle Bin</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  When on, deleted files are moved to the Windows Recycle Bin and can be
                  restored. When off, files are permanently deleted and cannot be recovered.
                </div>
              </div>
              <Toggle
                checked={deleteToTrash}
                onChange={handleToggleTrash}
                ariaLabel="Toggle send to Recycle Bin"
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-[14px] text-text-primary">Confirm permanent deletes</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  Ask before permanently deleting emails in Email Cleaner. Turn this back
                  on if you checked “Don’t ask me again”.
                </div>
              </div>
              <Toggle
                checked={confirmPermanentDelete}
                onChange={handleToggleConfirmPermanentDelete}
                ariaLabel="Toggle confirm permanent deletes"
              />
            </div>
          </div>
        </Card>

        <Card label="Output">
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
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-[14px] text-text-primary">Format .CSV</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  When on, CSV output and saved .csv files are shown as a table instead of raw
                  comma-separated text.
                </div>
              </div>
              <Toggle
                checked={formatCsv}
                onChange={handleToggleFormatCsv}
                ariaLabel="Toggle CSV table formatting"
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-[14px] text-text-primary">Sort by</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  Order of files in the Output tab.
                </div>
              </div>
              <Select
                value={outputSort}
                options={[
                  { value: 'name', label: 'Name' },
                  { value: 'size', label: 'Size' },
                  { value: 'modified', label: 'Date Modified' }
                ]}
                onChange={handleChangeOutputSort}
                ariaLabel="Output sort order"
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

        <Card label="Target SKUs">
          <div className="space-y-4 p-4 text-[13px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[14px] text-text-primary">Pokémon grouping</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  How Pokémon SKUs are grouped in the Target SKUs checklist.
                </div>
              </div>
              <Select
                value={pokemonGrouping}
                options={[
                  { value: 'set', label: 'By set' },
                  { value: 'era-set', label: 'By era → set' },
                  { value: 'era', label: 'By era' }
                ]}
                onChange={handleChangePokemonGrouping}
                ariaLabel="Pokémon grouping"
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-[14px] text-text-primary">Order by select date</div>
                <div className="mt-0.5 text-[12.5px] text-text-secondary">
                  Add newly checked SKUs to the end of the export, in the order you check
                  them. Off: insert them in catalog order. Dragging rows in the Order tab
                  overrides this either way.
                </div>
              </div>
              <Toggle
                checked={orderBySelectDate}
                onChange={handleToggleOrderBySelectDate}
                ariaLabel="Toggle order SKUs by select date"
              />
            </div>
          </div>
        </Card>

        <Card label="Proxy Tester">
          <div className="space-y-4 p-4 text-[13px]">
            <div>
              <div className="text-[14px] text-text-primary">Speed thresholds</div>
              <div className="mt-0.5 text-[12.5px] text-text-secondary">
                Latency cutoffs (ms) used to bucket tested proxies. Good is ≤ the first
                value, Ok is ≤ the second, and anything higher is Slow.
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-text-secondary">Good ≤ (ms)</span>
                <input
                  type="number"
                  min={1}
                  value={proxyGoodMs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isFinite(n) && n >= 1) onProxyGoodMsChange(n)
                  }}
                  className="h-9 w-28 rounded-lg border border-border bg-surface px-3 font-mono text-[12.5px] text-text-primary outline-none transition focus:border-accent"
                  aria-label="Good latency threshold in milliseconds"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-text-secondary">Ok ≤ (ms)</span>
                <input
                  type="number"
                  min={1}
                  value={proxyOkMs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isFinite(n) && n >= 1) onProxyOkMsChange(n)
                  }}
                  className="h-9 w-28 rounded-lg border border-border bg-surface px-3 font-mono text-[12.5px] text-text-primary outline-none transition focus:border-accent"
                  aria-label="Ok latency threshold in milliseconds"
                />
              </label>
              <Button
                onClick={() => {
                  onProxyGoodMsChange(PROXY_SPEED_DEFAULTS.goodMs)
                  onProxyOkMsChange(PROXY_SPEED_DEFAULTS.okMs)
                }}
                variant="ghost"
              >
                Reset to defaults
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
