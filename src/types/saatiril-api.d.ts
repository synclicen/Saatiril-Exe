/** Type declarations for the SAATIRIL Electron API exposed via preload.js */

interface LanInfo {
  httpPort: number
  socketPort: number
  useHttps: boolean
  ips: Array<{ name: string; address: string }>
}

interface SaatirilAPI {
  isElectron: boolean
  platform: string
  getVersion: () => Promise<string>
  getLanInfo: () => Promise<LanInfo>
  selectFolder: (defaultPath?: string) => Promise<string | null>
  savePhoto: (data: {
    base64Data: string
    filename: string
    targetFolder: string
  }) => Promise<string | null>
  getLanIPs: () => Promise<Array<{ name: string; address: string }>>
}

declare global {
  interface Window {
    saatirilAPI?: SaatirilAPI
  }
}

export {}
