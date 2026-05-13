import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    maximize: () => ipcRenderer.invoke('window:maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    onMaximizedChanged: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    }
  },
  files: {
    open: (opts?: {
      multiple?: boolean
      title?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('files:open', opts) as Promise<string[]>,
    read: (path: string) => ipcRenderer.invoke('files:read', path) as Promise<string>,
    writeOutput: (name: string, content: string) =>
      ipcRenderer.invoke('files:writeOutput', name, content) as Promise<string>,
    writeOutputs: (items: { name: string; content: string }[]) =>
      ipcRenderer.invoke('files:writeOutputs', items) as Promise<string[]>,
    reveal: (path: string) => ipcRenderer.invoke('files:reveal', path) as Promise<void>,
    openFile: (path: string) => ipcRenderer.invoke('files:openFile', path) as Promise<void>,
    openOutputDir: () => ipcRenderer.invoke('files:openOutputDir') as Promise<void>,
    listOutput: (sort?: 'name' | 'size' | 'modified') =>
      ipcRenderer.invoke('files:listOutput', sort) as Promise<
        { path: string; name: string; size: number; mtime: number }[]
      >,
    clearOutput: () =>
      ipcRenderer.invoke('files:clearOutput') as Promise<{ deleted: number }>,
    deleteOutput: (path: string) =>
      ipcRenderer.invoke('files:deleteOutput', path) as Promise<{
        ok: boolean
        error?: string
      }>,
    shuffleOutput: (path: string) =>
      ipcRenderer.invoke('files:shuffleOutput', path) as Promise<{
        ok: boolean
        error?: string
      }>,
    pickOutputDir: () => ipcRenderer.invoke('files:pickOutputDir') as Promise<string | null>,
    // Electron 32+ removed File.path for security; use webUtils to recover the
    // absolute path of a dropped File. Must run in the preload context.
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    onOutputChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('output:changed', handler)
      return () => ipcRenderer.removeListener('output:changed', handler)
    },
    getOutputDir: () => ipcRenderer.invoke('files:getOutputDir') as Promise<string>
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>
  },
  config: {
    get: () =>
      ipcRenderer.invoke('config:get') as Promise<{
        outputDir: string
        filePreview: boolean
        deleteToTrash: boolean
        theme: 'system' | 'light' | 'dark'
        outputSort: 'name' | 'size' | 'modified'
      }>,
    setFilePreview: (enabled: boolean) =>
      ipcRenderer.invoke('config:setFilePreview', enabled) as Promise<boolean>,
    setDeleteToTrash: (enabled: boolean) =>
      ipcRenderer.invoke('config:setDeleteToTrash', enabled) as Promise<boolean>,
    setTheme: (theme: 'system' | 'light' | 'dark') =>
      ipcRenderer.invoke('config:setTheme', theme) as Promise<'system' | 'light' | 'dark'>,
    setOutputSort: (sort: 'name' | 'size' | 'modified') =>
      ipcRenderer.invoke('config:setOutputSort', sort) as Promise<'name' | 'size' | 'modified'>
  },
  nav: {
    onBack: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('nav:back', handler)
      return () => ipcRenderer.removeListener('nav:back', handler)
    },
    onForward: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('nav:forward', handler)
      return () => ipcRenderer.removeListener('nav:forward', handler)
    }
  },
  updater: {
    onStatus: (
      cb: (
        status:
          | { type: 'checking'; currentVersion: string }
          | { type: 'no-update'; currentVersion: string }
          | { type: 'available'; version: string }
          | { type: 'downloaded'; version: string }
          | { type: 'error'; message: string }
      ) => void
    ) => {
      const handler = (_e: unknown, status: Parameters<typeof cb>[0]) => cb(status)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    },
    check: () =>
      ipcRenderer.invoke('updater:check') as Promise<{ ok: boolean; error?: string }>
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
