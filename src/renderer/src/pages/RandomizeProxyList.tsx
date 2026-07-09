import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SingleFileTool } from './SingleFileTool'
import { Button } from '../components/ToolShell'
import { detectProviders } from '../lib/proxy'
import { weightedShuffleProxies } from '../lib/proxyShuffle'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

// Favor levels the user picks per provider. `weight` feeds the shuffle: Off (0)
// drops the provider from the map so it stays at the baseline weight of 1, while
// higher levels pull that provider's proxies toward the top ever more strongly.
const LEVELS = [
  { label: 'Off', weight: 0 },
  { label: 'Low', weight: 2 },
  { label: 'Med', weight: 6 },
  { label: 'High', weight: 20 },
  { label: 'Max', weight: 80 }
] as const

function levelLabel(weight: number | undefined): string | null {
  const found = LEVELS.find((l) => l.weight === weight)
  return found && found.weight > 0 ? found.label : null
}

// Distinct hues (drawn from the tool-accent vocabulary, legible on both themes)
// assigned to providers by their order in the detected list, so each provider
// reads as one color across its chip and its favor control.
const PROVIDER_COLORS = [
  '#60a5fa',
  '#f472b6',
  '#4ade80',
  '#fbbf24',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#f59e0b',
  '#38bdf8'
]

function colorFor(index: number): string {
  return PROVIDER_COLORS[index % PROVIDER_COLORS.length]!
}

/** Off/Low/Med/High/Max control; the active segment fills with the provider's color. */
function FavorLevels({
  value,
  color,
  label,
  onChange
}: {
  value: number
  color: string
  label: string
  onChange: (weight: number) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-md border border-border bg-bg p-0.5"
    >
      {LEVELS.map((lvl) => {
        const active = value === lvl.weight
        return (
          <button
            key={lvl.label}
            onClick={() => onChange(lvl.weight)}
            aria-pressed={active}
            className={`rounded-[5px] px-2 py-1 text-[11px] font-medium transition ${
              active ? '' : 'text-text-muted hover:text-text-primary'
            }`}
            style={active ? { backgroundColor: color, color: '#111' } : undefined}
          >
            {lvl.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Right-click popover for favoring providers in the shuffle. One color-coded
 * favor control per detected provider; changes apply live. Positioning and
 * dismiss behavior mirror ProxyCleaner's ProviderLimitsPopover.
 */
function WeightingPopover({
  x,
  y,
  providers,
  colors,
  weights,
  onChange,
  onClose
}: {
  x: number
  y: number
  providers: { provider: string; count: number }[]
  colors: Map<string, string>
  weights: Map<string, number>
  onChange: (updater: (prev: Map<string, number>) => Map<string, number>) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Nudge back into view if the popover would overflow the right or bottom edge.
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8)
    }
    setPosition({ left, top })
  }, [x, y])

  // Dismiss on outside interaction. Defer attaching so the opening click does
  // not immediately close it.
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Consume it so App's Escape-to-Tools handler does not also fire.
        e.stopPropagation()
        onClose()
      }
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('scroll', close, true)
      document.addEventListener('keydown', keyHandler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  // Off (weight 0) drops the provider from the map so the shuffle treats it as
  // baseline; any other level stores its weight. The functional update reads the
  // latest map, so setting two providers in one React batch cannot clobber.
  function setWeight(provider: string, weight: number) {
    onChange((prev) => {
      const next = new Map(prev)
      if (weight <= 0) next.delete(provider)
      else next.set(provider, weight)
      return next
    })
  }

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      className="fixed z-[1000] w-[290px] rounded-lg border border-border bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="pb-2 text-[12px] font-medium text-text-secondary">
        Favor providers
      </div>
      {providers.length === 0 ? (
        <div className="pb-1 text-[12px] text-text-muted">
          No providers detected. Load a proxy list first.
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-0.5">
          {providers.map(({ provider, count }) => {
            const color = colors.get(provider) ?? PROVIDER_COLORS[0]!
            const value = weights.get(provider) ?? 0
            return (
              <div key={provider} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {provider}
                    <span className="pl-1 text-[11px] text-text-muted">
                      · {count.toLocaleString()}
                    </span>
                  </span>
                </div>
                <FavorLevels
                  value={value}
                  color={color}
                  label={`Favor ${provider}`}
                  onChange={(w) => setWeight(provider, w)}
                />
              </div>
            )
          })}
        </div>
      )}
      {weights.size > 0 && (
        <div className="flex items-center justify-end pt-2.5">
          <Button variant="ghost" onClick={() => onChange(() => new Map())}>
            Reset
          </Button>
        </div>
      )}
    </div>,
    document.body
  )
}

export function RandomizeProxyListPage({ onBack, onSetStatus, active }: Props) {
  const [content, setContent] = useState('')
  const [weights, setWeights] = useState<Map<string, number>>(() => new Map())
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null)

  // Pages stay mounted (display:none) while the popover portals to body, so
  // close it when the page deactivates so it cannot float over another page.
  useEffect(() => {
    if (!active) setPopover(null)
  }, [active])

  const closePopover = useCallback(() => setPopover(null), [])

  const providers = useMemo(() => detectProviders(content), [content])

  // Stable provider -> color mapping (by detected order), shared by the chips
  // and the popover so a provider is the same color in both.
  const providerColors = useMemo(
    () => new Map(providers.map((p, i) => [p.provider, colorFor(i)])),
    [providers]
  )

  const toolbar =
    providers.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1">
        <span className="pr-1 text-[12px] text-text-muted">Providers:</span>
        {providers.map(({ provider, count }) => {
          const level = levelLabel(weights.get(provider))
          return (
            <button
              key={provider}
              onClick={(e) => setPopover({ x: e.clientX, y: e.clientY })}
              title="Set how much to favor this provider"
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-text-secondary transition hover:text-text-primary"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: providerColors.get(provider) }}
              />
              {provider} · {count.toLocaleString()}
              {level && <span className="text-text-primary">· {level}</span>}
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <>
      {/* display:contents draws no box, but a right-click anywhere on the page
          bubbles here and opens the weighting popover at the cursor. */}
      <div
        className="contents"
        onContextMenu={(e) => {
          e.preventDefault()
          setPopover({ x: e.clientX, y: e.clientY })
        }}
      >
        <SingleFileTool
          title="Randomize Proxy List"
          hint="Shuffle a proxy list, pulling favored providers toward the top. Right-click to set how much to favor each provider."
          taskName="randomized-proxies"
          inputLabel="Proxy List"
          resultLabel="Randomized"
          resultUnit="proxies"
          emptyResultMessage="Proxy list has no lines to shuffle."
          runLabel="Randomize"
          transform={(text) => weightedShuffleProxies(text, weights)}
          pickerTitle="Select a proxy list"
          toolbar={toolbar}
          onContentChange={setContent}
          active={active}
          onBack={onBack}
          onSetStatus={onSetStatus}
        />
      </div>
      {popover && (
        <WeightingPopover
          x={popover.x}
          y={popover.y}
          providers={providers}
          colors={providerColors}
          weights={weights}
          onChange={setWeights}
          onClose={closePopover}
        />
      )}
    </>
  )
}
