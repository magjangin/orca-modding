'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('duoDesktop', {
  pickFolder: (initial) => ipcRenderer.invoke('duo:pick-folder', initial)
})
