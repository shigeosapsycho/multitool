// Renderer-side Tauri API shim. Mirrors the shape that was previously exposed
// by the Electron preload (`window.api`), so the rest of the React code keeps
// working without a sweep through every call site.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'

type ThemePref = 'system' | 'light' | 'dark'
type OutputSort = 'name' | 'size' | 'modified'

type DialogFilter = { name: string; extensions: string[] }
type OpenOpts = { multiple?: boolean; title?: string; filters?: DialogFilter[] }

type OutputEntry = { path: string; name: string; size: number; mtime: number }

export type ProxyTestEntry = {
  raw: string
  normalized: string | null
  latencyMs: number | null
  status: number | null
  error: string | null
}

type UpdaterStatus =
  | { type: 'checking'; currentVersion: string }
  | { type: 'no-update'; currentVersion: string }
  | { type: 'available'; version: string }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// ---------- drag-drop routing ----------
// With `dragDropEnabled: true` in tauri.conf.json the webview's HTML5 drag
// events (`dragover`/`dragleave`/`drop`) never fire — Tauri intercepts at the
// OS layer and emits its own enter/over/leave/drop events. We hit-test by
// position to dispatch to whichever registered zone is under the cursor.

type DropHandlers = {
  onDrop: (paths: string[]) => void
  onEnter?: () => void
  onLeave?: () => void
}
const dropZones = new Map<HTMLElement, DropHandlers>()
let activeZone: HTMLElement | null = null
let dropListenerInstalled = false

function hitTest(x: number, y: number): HTMLElement | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null
  while (el) {
    if (dropZones.has(el)) return el
    el = el.parentElement
  }
  return null
}

function setActiveZone(next: HTMLElement | null): void {
  if (activeZone === next) return
  const prev = activeZone
  activeZone = next
  if (prev) dropZones.get(prev)?.onLeave?.()
  if (next) dropZones.get(next)?.onEnter?.()
}

async function ensureDropListener(): Promise<void> {
  if (dropListenerInstalled) return
  dropListenerInstalled = true
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload as unknown as
        | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
        | { type: 'over'; position: { x: number; y: number } }
        | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
        | { type: 'leave' }
      const ratio = window.devicePixelRatio || 1
      if (payload.type === 'enter' || payload.type === 'over') {
        const x = payload.position.x / ratio
        const y = payload.position.y / ratio
        setActiveZone(hitTest(x, y))
      } else if (payload.type === 'leave') {
        setActiveZone(null)
      } else if (payload.type === 'drop') {
        const x = payload.position.x / ratio
        const y = payload.position.y / ratio
        const zone = hitTest(x, y)
        if (zone && payload.paths && payload.paths.length > 0) {
          dropZones.get(zone)?.onDrop(payload.paths)
        }
        setActiveZone(null)
      }
    })
  } catch {
    dropListenerInstalled = false
  }
}

function registerDropZone(el: HTMLElement, handlers: DropHandlers): () => void {
  void ensureDropListener()
  dropZones.set(el, handlers)
  return () => {
    if (activeZone === el) activeZone = null
    dropZones.delete(el)
  }
}

// ---------- event listeners ----------

function onEvent<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false
  listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (cancelled) {
      u()
    } else {
      unlisten = u
    }
  })
  return () => {
    cancelled = true
    if (unlisten) unlisten()
  }
}

// ---------- api shape ----------

export const api = {
  window: {
    minimize: () => invoke<void>('window_minimize'),
    maximize: () => invoke<boolean>('window_maximize'),
    close: () => invoke<void>('window_close'),
    isMaximized: () => invoke<boolean>('window_is_maximized'),
    onMaximizedChanged: (cb: (maximized: boolean) => void) =>
      onEvent<boolean>('window:maximized-changed', cb)
  },
  files: {
    open: (opts?: OpenOpts) => invoke<string[]>('files_open', { opts }),
    read: (path: string) => invoke<string>('files_read', { path }),
    writeOutput: (name: string, content: string) =>
      invoke<string>('files_write_output', { name, content }),
    writeOutputs: (items: { name: string; content: string }[]) =>
      invoke<string[]>('files_write_outputs', { items }),
    reveal: (path: string) => invoke<void>('files_reveal', { path }),
    openFile: (path: string) => invoke<void>('files_open_file', { path }),
    openOutputDir: () => invoke<void>('files_open_output_dir'),
    listOutput: (sort?: OutputSort) =>
      invoke<OutputEntry[]>('files_list_output', { sort }),
    clearOutput: () => invoke<{ deleted: number }>('files_clear_output'),
    deleteOutput: (path: string) =>
      invoke<{ ok: boolean; error?: string }>('files_delete_output', { path }),
    shuffleOutput: (path: string) =>
      invoke<{ ok: boolean; error?: string }>('files_shuffle_output', { path }),
    pickOutputDir: () => invoke<string | null>('files_pick_output_dir'),
    /**
     * Electron-era API: returned the absolute path for an HTML5-dropped File.
     * In Tauri, drops never reach the DOM — paths come from the OS-level
     * drag-drop event. The renderer should call `registerDropZone` instead;
     * `pathForFile` is retained as a no-op so call sites compile during the
     * migration but should be removed.
     */
    pathForFile: (_file: File): string | null => null,
    registerDropZone,
    onOutputChanged: (cb: () => void) => onEvent<unknown>('output:changed', () => cb()),
    getOutputDir: () => invoke<string>('files_get_output_dir')
  },
  app: {
    getVersion: () => invoke<string>('app_get_version')
  },
  config: {
    get: () =>
      invoke<{
        outputDir: string
        filePreview: boolean
        deleteToTrash: boolean
        theme: ThemePref
        outputSort: OutputSort
      }>('config_get'),
    setFilePreview: (enabled: boolean) =>
      invoke<boolean>('config_set_file_preview', { enabled }),
    setDeleteToTrash: (enabled: boolean) =>
      invoke<boolean>('config_set_delete_to_trash', { enabled }),
    setTheme: (theme: ThemePref) => invoke<ThemePref>('config_set_theme', { theme }),
    setOutputSort: (sort: OutputSort) => invoke<OutputSort>('config_set_output_sort', { sort })
  },
  nav: {
    onBack: (cb: () => void) => onEvent<unknown>('nav:back', () => cb()),
    onForward: (cb: () => void) => onEvent<unknown>('nav:forward', () => cb())
  },
  net: {
    testProxies: (args: { url: string; proxies: string[]; concurrency?: number }) =>
      invoke<ProxyTestEntry[]>('net_test_proxies', { args }),
    cancelProxies: () => invoke<void>('net_cancel_proxies')
  },
  updater: {
    onStatus: (cb: (status: UpdaterStatus) => void) =>
      onEvent<UpdaterStatus>('updater:status', cb),
    onProgress: (cb: (p: { downloaded: number; total: number }) => void) =>
      onEvent<{ downloaded: number; total: number }>('updater:progress', cb),
    /** Fires once on launch when the app detects it just self-updated. Payload is the new version. */
    onUpgradeApplied: (cb: (version: string) => void) =>
      onEvent<string>('upgrade-applied', cb),
    check: () => invoke<{ ok: boolean; error?: string }>('updater_check'),
    /** Swaps in the staged exe and relaunches. Does not resolve on success — the process exits. */
    applyAndRestart: () => invoke<void>('updater_apply_and_restart')
  }
}

export type Api = typeof api

declare global {
  interface Window {
    api: Api
  }
}

// Mount on window so existing 42 call sites (`window.api.*`) keep working.
window.api = api
