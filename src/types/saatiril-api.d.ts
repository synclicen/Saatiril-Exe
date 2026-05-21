/** Type declarations for the SAATIRIL Electron API exposed via preload.js */

interface SaatirilAPI {
  isElectron: boolean
  platform: string
  getVersion: () => Promise<string>
  selectFolder: (defaultPath?: string) => Promise<string | null>
  savePhoto: (data: {
    base64Data: string
    filename: string
    targetFolder: string
  }) => Promise<string | null>
}

declare global {
  interface Window {
    saatirilAPI?: SaatirilAPI
  }
}

export {}
