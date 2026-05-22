/**
 * SAATIRIL — Electron Preload Script
 *
 * Bridges the Electron main process and the web renderer.
 * Provides safe access to system info and IPC.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('saatirilAPI', {
  /** Check if running inside Electron */
  isElectron: true,

  /** Get the platform (win32, darwin, linux) */
  platform: process.platform,

  /** Get application version */
  getVersion: () => ipcRenderer.invoke('get-version'),

  /** Open native folder picker dialog — returns selected path or null */
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),

  /** Save a photo to disk — returns the saved file path or null */
  savePhoto: (data) => ipcRenderer.invoke('save-photo', data),

  /** Get LAN IP addresses — returns array of {name, address} */
  getLanIPs: () => ipcRenderer.invoke('get-lan-ips'),
})
