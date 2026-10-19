'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dual', {
  command: message => ipcRenderer.invoke('dual:command', message),
  onState: callback => { ipcRenderer.on('dual:state', (_event, state) => callback(state)); }
});
