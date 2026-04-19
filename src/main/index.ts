import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { db } from './database'
import { registerIpcHandlers } from './ipc/handlers'
import { pluginManager } from './plugins/manager'
import { initLLM } from './llm/service'

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Mail Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    console.log('Loading renderer from:', htmlPath)
    mainWindow.loadFile(htmlPath)
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Failed to load:', code, desc)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Renderer loaded successfully')
    mainWindow!.webContents.executeJavaScript(`
      JSON.stringify({
        errors: window.__errors || [],
        hasRoot: !!document.getElementById('root'),
        rootHTML: document.getElementById('root')?.innerHTML?.substring(0, 200) || 'empty',
        consoleErrors: []
      })
    `).then(result => console.log('Renderer state:', result))
      .catch(err => console.error('JS eval error:', err))
  })

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const prefix = ['LOG', 'WARN', 'ERR', 'INFO'][level] || 'MSG'
    console.log(`[renderer:${prefix}]`, message)
  })
}

app.whenReady().then(async () => {
  await db.init()
  await initLLM()
  await pluginManager.init()
  registerIpcHandlers()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await pluginManager.shutdown()
  await db.close()
})
