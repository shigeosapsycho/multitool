import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { promises as fs, watch as fsWatch, type FSWatcher } from 'fs'
import { autoUpdater } from 'electron-updater'
import iconPath from '../../resources/icon.ico?asset'

type UpdaterStatus =
  | { type: 'checking'; currentVersion: string }
  | { type: 'no-update'; currentVersion: string }
  | { type: 'available'; version: string }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

function broadcastUpdaterStatus(status: UpdaterStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', status)
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcastUpdaterStatus({ type: 'checking', currentVersion: app.getVersion() })
  })
  autoUpdater.on('update-not-available', () => {
    broadcastUpdaterStatus({ type: 'no-update', currentVersion: app.getVersion() })
  })
  autoUpdater.on('update-available', (info) => {
    broadcastUpdaterStatus({ type: 'available', version: info.version })
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcastUpdaterStatus({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    broadcastUpdaterStatus({ type: 'error', message: err?.message ?? String(err) })
  })

  // Only check when the app is packaged (electron-updater needs a real install).
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {
      // Errors already surfaced via the 'error' event above
    })
  }
}

let outputDirCache = ''

function defaultOutputDir(): string {
  if (app.isPackaged) {
    // Portable build sets PORTABLE_EXECUTABLE_DIR; write next to the .exe.
    // Installed (NSIS) build runs from Program Files which is read-only —
    // fall back to a writable location under the user's Documents folder.
    const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
    if (portableDir) return join(portableDir, 'output')
    return join(app.getPath('documents'), 'BeuMultiTool', 'output')
  }
  return join(__dirname, '..', '..', 'output')
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

async function loadConfig(): Promise<void> {
  try {
    const text = await fs.readFile(configPath(), 'utf-8')
    const cfg = JSON.parse(text)
    if (typeof cfg.outputDir === 'string' && cfg.outputDir.length > 0) {
      outputDirCache = cfg.outputDir
    }
  } catch {
    // missing or unreadable — fall through to default
  }
  if (!outputDirCache) outputDirCache = defaultOutputDir()
}

async function saveOutputDir(newPath: string): Promise<void> {
  outputDirCache = newPath
  await fs.writeFile(
    configPath(),
    JSON.stringify({ outputDir: newPath }, null, 2),
    'utf-8'
  )
}

function getOutputDir(): string {
  return outputDirCache || defaultOutputDir()
}

async function ensureOutputDir(): Promise<string> {
  const dir = getOutputDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// Watch the active output dir; debounce + notify renderer so Results auto-refreshes.
let outputWatcher: FSWatcher | null = null
let watchDebounce: NodeJS.Timeout | null = null

function startOutputWatcher() {
  if (outputWatcher) {
    try {
      outputWatcher.close()
    } catch {
      // ignore
    }
    outputWatcher = null
  }
  const dir = getOutputDir()
  try {
    outputWatcher = fsWatch(dir, { persistent: false }, () => {
      if (watchDebounce) clearTimeout(watchDebounce)
      watchDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('output:changed')
        }
      }, 120)
    })
    outputWatcher.on('error', () => {
      // path went away or some transient; renderer can re-pull on demand
    })
  } catch {
    // dir may not exist yet — caller should ensureOutputDir() first
  }
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${d.getFullYear()}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a10',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Lock zoom: no Ctrl+=, Ctrl+-, Ctrl+0, no pinch zoom, no Ctrl+wheel.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  mainWindow.webContents.setZoomFactor(1)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.control || input.meta)) return
    const k = input.key
    if (k === '=' || k === '+' || k === '-' || k === '_' || k === '0') {
      event.preventDefault()
    }
  })

  // Notify renderer when maximized state changes so the title bar can update its icon
  const sendMaxState = () => {
    if (!mainWindow) return
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await loadConfig()
  await ensureOutputDir()
  startOutputWatcher()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('files:open', async (_e, opts?: { multiple?: boolean; title?: string }) => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts?.title ?? 'Select a text file',
      properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Text files', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('files:read', async (_e, path: string) => {
    return fs.readFile(path, 'utf-8')
  })

  ipcMain.handle('files:writeOutput', async (_e, name: string, content: string) => {
    const dir = await ensureOutputDir()
    const filename = `${name}_${timestamp()}.txt`
    const fullPath = join(dir, filename)
    await fs.writeFile(fullPath, content, 'utf-8')
    return fullPath
  })

  ipcMain.handle(
    'files:writeOutputs',
    async (_e, items: { name: string; content: string }[]) => {
      const dir = await ensureOutputDir()
      const stamp = timestamp()
      const paths: string[] = []
      for (const item of items) {
        const fullPath = join(dir, `${item.name}_${stamp}.txt`)
        await fs.writeFile(fullPath, item.content, 'utf-8')
        paths.push(fullPath)
      }
      return paths
    }
  )

  ipcMain.handle('files:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('files:openOutputDir', async () => {
    const dir = await ensureOutputDir()
    shell.openPath(dir)
  })

  // Confirmation is handled by the in-app themed dialog in the renderer.
  // These IPCs just perform the action.
  ipcMain.handle('files:clearOutput', async () => {
    const dir = await ensureOutputDir()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let deleted = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.txt')) continue
      await fs.unlink(join(dir, entry.name))
      deleted++
    }
    return { deleted }
  })

  ipcMain.handle('files:deleteOutput', async (_e, path: string) => {
    try {
      await fs.unlink(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('files:listOutput', async () => {
    const dir = await ensureOutputDir()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: { path: string; name: string; size: number; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.txt')) continue
      const full = join(dir, entry.name)
      const stat = await fs.stat(full)
      out.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtimeMs })
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out
  })

  ipcMain.handle('files:pickOutputDir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getOutputDir()
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const newPath = result.filePaths[0]!
    await saveOutputDir(newPath)
    await fs.mkdir(newPath, { recursive: true })
    startOutputWatcher()
    return newPath
  })

  ipcMain.handle('files:getOutputDir', () => getOutputDir())

  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Auto-updater (GitHub Releases). No-op in dev (app.isPackaged is false).
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
