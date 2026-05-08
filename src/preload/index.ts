import { contextBridge, ipcRenderer } from 'electron'

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
    open: (opts?: { multiple?: boolean; title?: string }) =>
      ipcRenderer.invoke('files:open', opts) as Promise<string[]>,
    read: (path: string) => ipcRenderer.invoke('files:read', path) as Promise<string>,
    writeOutput: (name: string, content: string) =>
      ipcRenderer.invoke('files:writeOutput', name, content) as Promise<string>,
    writeOutputs: (items: { name: string; content: string }[]) =>
      ipcRenderer.invoke('files:writeOutputs', items) as Promise<string[]>,
    reveal: (path: string) => ipcRenderer.invoke('files:reveal', path) as Promise<void>,
    openOutputDir: () => ipcRenderer.invoke('files:openOutputDir') as Promise<void>,
    listOutput: () =>
      ipcRenderer.invoke('files:listOutput') as Promise<
        { path: string; name: string; size: number; mtime: number }[]
      >,
    clearOutput: () =>
      ipcRenderer.invoke('files:clearOutput') as Promise<{
        canceled: boolean
        deleted: number
      }>,
    pickOutputDir: () => ipcRenderer.invoke('files:pickOutputDir') as Promise<string | null>,
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
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
