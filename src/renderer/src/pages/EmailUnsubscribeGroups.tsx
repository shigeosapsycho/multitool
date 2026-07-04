import { useState } from 'react'
import type { UnsubEmail, UnsubRunItem } from '../lib/api'
import type { SenderGroup } from './EmailCleanerGroups'
import { formatDate } from './EmailCleanerGroups'
import { ContextMenu } from '../components/ContextMenu'
import { VirtualGroupList } from '../components/VirtualGroupList'

/** How a given sender can be unsubscribed from. */
export type UnsubMethod = 'one-click' | 'link' | 'email'

export type GroupUnsub = {
  method: UnsubMethod
  /** `http(s)` URL — present for `one-click` and `link`. */
  url: string | null
  /** `mailto:` URI — present for `email` (and sometimes as an extra). */
  mailto: string | null
}

/**
 * Derive a sender group's unsubscribe action from its newest email — the
 * freshest `List-Unsubscribe` link is the one most likely to still work.
 * Every scanned email carries at least one unsubscribe option, so the newest
 * email always yields a usable method.
 */
export function groupUnsubInfo(group: SenderGroup<UnsubEmail>): GroupUnsub {
  const newest = group.emails.reduce((a, b) => (b.dateMs > a.dateMs ? b : a))
  if (newest.oneClick && newest.httpUrl) {
    return { method: 'one-click', url: newest.httpUrl, mailto: newest.mailto }
  }
  if (newest.httpUrl) {
    return { method: 'link', url: newest.httpUrl, mailto: newest.mailto }
  }
  return { method: 'email', url: null, mailto: newest.mailto }
}

const CaretIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const EyeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const TrashIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
)

/** Simple on/off checkbox for selecting a sender group. */
function Check({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        on ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface'
      }`}
      role="checkbox"
      aria-checked={on}
    >
      {on && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  )
}

const METHOD_BADGE: Record<UnsubMethod, { label: string; cls: string; hint: string }> = {
  'one-click': {
    label: 'One-click',
    cls: 'bg-success/15 text-success',
    hint: 'Unsubscribes automatically with a single request.'
  },
  link: {
    label: 'Link',
    cls: 'bg-accent-soft text-accent',
    hint: 'Unsubscribes by visiting the sender’s unsubscribe page.'
  },
  email: {
    label: 'Email only',
    cls: 'bg-surface-3 text-text-muted',
    hint: 'This sender only offers a mailto: unsubscribe — open it to finish.'
  }
}

type Props = {
  groups: SenderGroup<UnsubEmail>[]
  /** Selected sender-group keys. */
  selected: Set<string>
  /** Expanded sender-group keys. */
  expanded: Set<string>
  /** Per-group unsubscribe outcomes, keyed by group key. */
  results: Map<string, UnsubRunItem>
  /** Precomputed unsubscribe action per group key (covers all scanned groups). */
  unsubInfo: ReadonlyMap<string, GroupUnsub>
  /** Scrolls the list back to the top when it changes (fresh scan results). */
  resetKey?: unknown
  onToggleGroup: (key: string) => void
  onToggleExpand: (key: string) => void
  onPreview: (email: UnsubEmail) => void
  onOpenMailto: (mailto: string) => void
  onDeleteEmail: (email: UnsubEmail) => void
}

export function EmailUnsubscribeGroups({
  groups,
  selected,
  expanded,
  results,
  unsubInfo,
  resetKey,
  onToggleGroup,
  onToggleExpand,
  onPreview,
  onOpenMailto,
  onDeleteEmail
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; email: UnsubEmail } | null>(null)

  return (
    <>
      <VirtualGroupList
        groups={groups}
        expanded={expanded}
        resetKey={resetKey}
        renderGroupRow={(g) => {
          const info = unsubInfo.get(g.key) ?? groupUnsubInfo(g)
          const isOpen = expanded.has(g.key)
          const isSelected = selected.has(g.key)
          const result = results.get(g.key)
          const selectable = info.method !== 'email'
          const subline = g.addr || (g.addrCount > 1 ? `${g.addrCount} addresses` : '')
          const badge = METHOD_BADGE[info.method]
          return (
            <div
              className={`flex h-full cursor-pointer items-center gap-2.5 px-3 hover:bg-surface-2 ${
                isOpen ? '' : 'border-b border-border/60'
              }`}
              onClick={() => onToggleExpand(g.key)}
            >
              {selectable ? (
                <Check on={isSelected} onClick={() => onToggleGroup(g.key)} />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
              <span className="text-text-muted">
                <CaretIcon open={isOpen} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text-primary">{g.name}</div>
                {result ? (
                  <div
                    className={`truncate text-[11px] ${
                      result.ok ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {result.detail}
                  </div>
                ) : (
                  subline && (
                    <div className="truncate text-[11px] text-text-muted">{subline}</div>
                  )
                )}
              </div>
              {result ? (
                <span
                  title={result.detail}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                    result.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                  }`}
                >
                  {result.ok
                    ? info.method === 'one-click'
                      ? 'Unsubscribed'
                      : 'Request sent'
                    : 'Failed'}
                </span>
              ) : (
                <span
                  title={badge.hint}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${badge.cls}`}
                >
                  {badge.label}
                </span>
              )}
              {info.method === 'email' && info.mailto && !result && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenMailto(info.mailto as string)
                  }}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
                >
                  Open
                </button>
              )}
              <span className="w-16 shrink-0 text-right text-[12px] text-text-secondary">
                {g.emails.length} {g.emails.length === 1 ? 'email' : 'emails'}
              </span>
            </div>
          )
        }}
        renderEmailRow={(e, _g, isLast) => (
          <div
            onContextMenu={(ev) => {
              ev.preventDefault()
              setMenu({ x: ev.clientX, y: ev.clientY, email: e })
            }}
            title="Right-click to preview"
            className={`flex h-full select-none items-center gap-2.5 bg-surface-2/40 pl-11 pr-3 hover:bg-surface-2 ${
              isLast ? 'border-b border-border/60' : ''
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary">
              {e.subject || '(no subject)'}
            </span>
            <span className="w-20 shrink-0 text-right text-[11px] text-text-muted">
              {formatDate(e.dateMs)}
            </span>
          </div>
        )}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Preview email',
              icon: <EyeIcon />,
              onClick: () => onPreview(menu.email),
              separatorAfter: true
            },
            {
              label: 'Delete email permanently',
              icon: <TrashIcon />,
              onClick: () => onDeleteEmail(menu.email),
              danger: true
            }
          ]}
        />
      )}
    </>
  )
}
