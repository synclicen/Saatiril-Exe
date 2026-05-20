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
})
