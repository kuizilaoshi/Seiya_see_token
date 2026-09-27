const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexUsage', {
  get: () => ipcRenderer.invoke('usage:get'),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  onUpdate: (callback) => ipcRenderer.on('usage:update', (_event, data) => callback(data)),
  onCloseAsk: (callback) => ipcRenderer.on('close:ask', callback),
  onWindowState: (callback) => ipcRenderer.on('window:state', (_event, data) => callback(data)),
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  toggleTop: () => ipcRenderer.send('window:toggle-top')
});
