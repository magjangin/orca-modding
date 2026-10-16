'use strict'
// 데스크톱 셸: 로컬 서버를 같은 프로세스에서 띄우고 창 하나로 보여준다.
const path = require('node:path')
const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme, Menu } = require('electron')
const { startServer } = require('../server/index.js')

let server = null
let win = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    server = await startServer({ port: 0 })
    console.log(`Orca Duo 서버: ${server.url}`)
    Menu.setApplicationMenu(null)

    ipcMain.handle('duo:pick-folder', async (_event, initial) => {
      const result = await dialog.showOpenDialog(win, {
        title: '작업 폴더 선택',
        defaultPath: initial || undefined,
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? null : result.filePaths[0]
    })

    win = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 760,
      minHeight: 520,
      title: 'Orca Duo',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1e1d' : '#faf9f5',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // 외부 링크는 기본 브라우저로.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(server.url)) {
        event.preventDefault()
        if (/^https?:/i.test(url)) shell.openExternal(url)
      }
    })
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })

    await win.loadURL(server.url)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    if (server) server.close()
  })
}
