/**
 * SAATIRIL — Electron Preload Script
 *
 * Runs in the renderer process before the web page loads.
 * Provides a safe bridge between the Electron main process
 * and the web app via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('saatirilAPI', {
  /**
   * Get the application version
   */
  getVersion: () => ipcRenderer.invoke('get-version'),

  /**
   * Check if running inside Electron
   */
  isElectron: true,

  /**
   * Get the platform (win32, darwin, linux)
   */
  platform: process.platform,
})
