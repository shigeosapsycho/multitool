import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

function getOutputDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('exe'), '..', 'output')
  }
  return join(__dirname, '..', '..', 'output')
}

async function ensureOutputDir(): Promise<string> {
  const dir = getOutputDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
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

app.whenReady().then(() => {
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

  ipcMain.handle('files:clearOutput', async () => {
    if (!mainWindow) return { canceled: true, deleted: 0 }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete All'],
      defaultId: 0,
      cancelId: 0,
      title: 'Clear output folder',
      message: 'Delete all files in the output folder?',
      detail: 'This cannot be undone.',
      noLink: true
    })
    if (choice.response !== 1) return { canceled: true, deleted: 0 }
    const dir = await ensureOutputDir()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let deleted = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      await fs.unlink(join(dir, entry.name))
      deleted++
    }
    return { canceled: false, deleted }
  })

  ipcMain.handle('files:listOutput', async () => {
    const dir = await ensureOutputDir()
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: { path: string; name: string; size: number; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const full = join(dir, entry.name)
      const stat = await fs.stat(full)
      out.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtimeMs })
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out
  })

  ipcMain.handle('files:getOutputDir', () => getOutputDir())

  ipcMain.handle('app:getVersion', () => app.getVersion())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
