# Listify — Design Spec

- **Date:** 2026-06-01
- **Status:** Approved
- **Module:** Listify (new tool/page in Beu MultiTool)

## Overview

Listify turns a pasted/loaded text list into an interactive, numbered list. The
user selects rows and right-clicks to mark, reorder, or delete them, then copies
or saves the resulting list. It complements the existing line tools (Reverse,
Randomize, Multiply Lines) by adding hands-on, per-row editing instead of a
single batch transform.

## Locked decisions

- **Rearrange:** right-click context menu — Move up / Move down / To top / To
  bottom. No drag-and-drop (out of scope).
- **Marks:** visual triage only — ★ star, ✓ green check, ✗ red cross. Marks are
  NOT written to output and NOT persisted across app restart.
- **Output:** Save to Output file + Copy. Both emit plain text, current order,
  marks excluded.
- **Input:** left-panel editor (paste/type) + file open + drag-drop — standard
  tool convention. "Load to list" parses the editor into rows and REPLACES any
  existing list.
- **Selection:** multi-select — plain click selects one; Ctrl/Cmd-click toggles;
  Shift-click selects a range.

## Data model

```ts
type Mark = 'none' | 'star' | 'check' | 'cross'
type Item = { id: number; text: string; mark: Mark }
```

`id` is a monotonic integer, stable across reorder/delete, used for React keys
and selection membership. A counter (useRef) hands out ids; a fresh Load starts
from the current counter value so ids never collide with a prior list.

## Pure helpers — `src/renderer/src/lib/listify.ts`

No React. Unit-testable in isolation.

- `parseToItems(text: string, startId: number): Item[]` — split `/\r?\n/`,
  `trimEnd`, drop blank lines (same convention as `reverseLines`/`shuffleLines`),
  assign sequential ids from `startId`, `mark: 'none'`.
- `itemsToText(items: Item[]): string` — `items.map(i => i.text).join('\n')`.
- `moveItems(items, selectedIds: Set<number>, dir: 'up'|'down'|'top'|'bottom'): Item[]`
  — move the selected block, preserving the moved items' relative order;
  boundary moves (top item up) are no-ops.
- `setMark(items, ids: Set<number>, mark: Mark): Item[]`.
- `deleteItems(items, ids: Set<number>): Item[]`.
- `markCounts(items): { star: number; check: number; cross: number }`.

## Component — `src/renderer/src/pages/Listify.tsx`

State: `items: Item[]`, `selectedIds: Set<number>`, `filePath: string | null`,
`savedTo: string | null`, `menu: { x: number; y: number } | null`, `idCounter`
(ref).

Built on `ToolLayout` (2-col grid):
- **Banner:** `N items · ★a ✓b ✗c` once loaded, else the hint.
- **Header actions:** `Clear` (ghost) + `Load to list` (primary).
- **Left child:** `FilePanel` (input editor) — `onPick` → `window.api.files.open`,
  `onDropPath` → read + set, standard. `Load to list` reads `panelRef.getValue()`,
  runs `parseToItems`, replaces `items`, clears selection + `savedTo`.
- **Right child:** custom **ListPanel** in a `Card` (label "List", badge = count):
  scrollable rows; each row = `[number] [mark icon slot] [text]`. Row click sets
  selection; `onContextMenu` opens the menu. Footer mirrors `ResultPanel`:
  `Copy` + (`Save to Output` → after save, `Reveal`).

```
┌ Listify ──────────────────────────────────────────────┐
│ 12 items · ★3 ✓5 ✗1                       [Clear][Load]│
├─────────────────────────┬──────────────────────────────┤
│ INPUT (paste/drop/open) │ LIST                         │
│ hi                      │  1  ★  alpha                 │
│ hello                   │  2     bravo  ← selected     │
│ ...                     │  3  ✓  charlie               │
│ [Choose]                │  4  ✗  delta    [Copy][Save] │
└─────────────────────────┴──────────────────────────────┘
```

### Context menu (reuses `components/ContextMenu.tsx` as-is)

On right-click of a row: if the row is not in `selectedIds`, select just it
first. Items (flat, with separators):

`Mark ★` · `Mark ✓` · `Mark ✗` · `Clear mark` — sep — `Move up` · `Move down` ·
`To top` · `To bottom` — sep — `Delete` (danger).

All actions operate on the current selection.

### Keyboard

- `Delete` / `Backspace` — delete selection.
- `Esc` — clear selection (and close menu, already handled by ContextMenu).
- `Ctrl/Cmd+A` — select all (only when the list panel has focus, to avoid
  hijacking the editor textarea).

### Numbers

1-based, derived from array index at render — auto-correct on every
reorder/delete. No stored index.

## Output

- **Save:** `window.api.files.writeOutput('listify', itemsToText(items) + '\n')`
  → `savedTo`; then footer shows `Reveal` (`window.api.files.reveal(savedTo)`).
- **Copy:** `navigator.clipboard.writeText(itemsToText(items))`.
- Marks excluded from both (visual triage only).

## Files

- **New:** `src/renderer/src/lib/listify.ts`
- **New:** `src/renderer/src/pages/Listify.tsx`
- **Edit:** `src/renderer/src/types.ts` — add `'listify'` to `Route`.
- **Edit:** `src/renderer/src/App.tsx` — import page, add to `TOOL_ROUTES`, add
  `renderTool` switch case.
- **Edit:** `src/renderer/src/pages/Tools.tsx` — grid `ToolMeta` + icon + mapping.
- **Edit:** `src/renderer/src/components/Sidebar.tsx` — add to `TOOL_ROUTES` set
  (keeps Tools tab highlighted on the page).

## Edge cases

- Empty editor → Load is a no-op, status "Nothing to load".
- Load over an existing list → replace; marks reset (tied to items).
- Delete all rows → empty list, banner shows 0, Copy/Save disabled.
- Boundary reorder (top item "Move up") → no-op.
- Reload clears selection and `savedTo`.
- Right-click with an empty list → no menu (nothing to act on).

## Verification

No test framework in the repo (no test script, no test files) — match
convention. Verify via:
- `npx tsc -p tsconfig.web.json --noEmit`
- `npx vite build`
- Manual: load a list, multi-select (click/Ctrl/Shift), apply each mark, reorder
  via menu (incl. boundaries), delete, Copy, Save + Reveal.

(Optional, not in this scope: add vitest for the pure `lib/listify.ts` helpers.)

## Out of scope (YAGNI)

Drag-and-drop reorder; persistence across restart; marks in export; filter/sort
by mark; undo/redo. All deferrable without reworking the data model.

## Implementation steps

1. `lib/listify.ts` — pure helpers.
2. `pages/Listify.tsx` — UI + interactions, reusing `ToolLayout`, `FilePanel`,
   `Card`, `ContextMenu`, `Icons`.
3. Wire `types.ts`, `App.tsx`, `Tools.tsx`, `Sidebar.tsx`.
4. `tsc --noEmit` + `vite build`.
5. Manual verify per above.
