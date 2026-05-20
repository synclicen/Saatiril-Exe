/**
 * SAATIRIL — Electron Main Process
 *
 * This is the entry point for the Electron desktop application.
 * It starts both the Next.js server and the Socket.io relay server,
 * then opens a BrowserWindow pointing to the local Next.js app.
 *
 * Other devices on the LAN can connect to this machine's IP:3000
 * (Next.js) and IP:3003 (Socket.io) to join the session.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const os = require('os')
const net = require('net')

// ─── Configuration ──────────────────────────────────────────────────────────
const NEXT_PORT = 3000
const SOCKET_PORT = 3003
const isDev = !app.isPackaged

// Keep references to child processes so we can kill them on quit
let nextServerProcess = null
let socketServerProcess = null
let mainWindow = null

// ─── Utility: Get local network IPs ─────────────────────────────────────────
function getLocalIPs() {
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address })
      }
    }
  }
  return ips
}

// ─── Utility: Wait for a port to be available ───────────────────────────────
function waitForPort(port, host = 'localhost', timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tryConnect = () => {
      const socket = new net.Socket()
      socket.setTimeout(1000)
      socket.on('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`))
        } else {
          setTimeout(tryConnect, 500)
        }
      })
      socket.on('timeout', () => {
        socket.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`))
        } else {
          setTimeout(tryConnect, 500)
        }
      })
      socket.connect(port, host)
    }
    tryConnect()
  })
}

// ─── Start Next.js server ───────────────────────────────────────────────────
async function startNextServer() {
  if (isDev) {
    console.log('[SAATIRIL Electron] Dev mode: Next.js server should already be running on port', NEXT_PORT)
    return
  }

  const standaloneDir = path.join(process.resourcesPath, 'standalone')
  const serverPath = path.join(standaloneDir, 'server.js')

  console.log('[SAATIRIL Electron] Starting Next.js server from:', serverPath)

  nextServerProcess = spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      PORT: String(NEXT_PORT),
      HOSTNAME: '0.0.0.0',
      NODE_ENV: 'production',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  nextServerProcess.stdout.on('data', (data) => {
    console.log('[Next.js]', data.toString().trim())
  })

  nextServerProcess.stderr.on('data', (data) => {
    console.error('[Next.js]', data.toString().trim())
  })

  nextServerProcess.on('error', (err) => {
    console.error('[SAATIRIL Electron] Next.js server error:', err)
  })

  nextServerProcess.on('exit', (code) => {
    console.log('[SAATIRIL Electron] Next.js server exited with code:', code)
  })

  // Wait for the server to be ready
  try {
    await waitForPort(NEXT_PORT, 'localhost', 30000)
    console.log('[SAATIRIL Electron] Next.js server is ready on port', NEXT_PORT)
  } catch (err) {
    console.error('[SAATIRIL Electron] Failed to start Next.js server:', err)
    dialog.showErrorBox(
      'Server Error',
      'Gagal memulai server Next.js. Pastikan port 3000 tidak digunakan aplikasi lain.'
    )
  }
}

// ─── Start Socket.io relay server ───────────────────────────────────────────
async function startSocketServer() {
  const socketServerPath = isDev
    ? path.join(__dirname, '..', 'mini-services', 'saatiril-socket', 'index.ts')
    : path.join(process.resourcesPath, 'socket-server', 'index.js')

  console.log('[SAATIRIL Electron] Starting Socket.io server from:', socketServerPath)

  const cmd = isDev ? 'bun' : process.execPath
  const args = isDev ? ['--hot', socketServerPath] : [socketServerPath]

  socketServerProcess = spawn(cmd, args, {
    cwd: path.dirname(socketServerPath),
    env: {
      ...process.env,
      PORT: String(SOCKET_PORT),
      NODE_ENV: isDev ? 'development' : 'production',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  socketServerProcess.stdout.on('data', (data) => {
    console.log('[Socket.io]', data.toString().trim())
  })

  socketServerProcess.stderr.on('data', (data) => {
    console.error('[Socket.io]', data.toString().trim())
  })

  socketServerProcess.on('error', (err) => {
    console.error('[SAATIRIL Electron] Socket.io server error:', err)
  })

  socketServerProcess.on('exit', (code) => {
    console.log('[SAATIRIL Electron] Socket.io server exited with code:', code)
  })

  // Wait for the socket server to be ready
  try {
    await waitForPort(SOCKET_PORT, 'localhost', 15000)
    console.log('[SAATIRIL Electron] Socket.io server is ready on port', SOCKET_PORT)
  } catch (err) {
    console.warn('[SAATIRIL Electron] Socket.io server may not be ready yet:', err.message)
  }
}

// ─── Create main window ─────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'SAATIRIL — Sistem Auto Track Input Raw into Live',
    backgroundColor: '#1a0b2e',
    icon: path.join(__dirname, '..', 'public', 'logo.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the Next.js app
  const url = isDev
    ? `http://localhost:${NEXT_PORT}`
    : `http://localhost:${NEXT_PORT}`

  mainWindow.loadURL(url)

  // Dev tools in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // Build application menu
  const template = [
    {
      label: 'SAATIRIL',
      submenu: [
        {
          label: 'Tentang SAATIRIL',
          click: () => {
            const ips = getLocalIPs()
            const ipList = ips.map(ip => `${ip.name}: ${ip.address}`).join('\n')
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Tentang SAATIRIL',
              message: 'SAATIRIL — Sistem Auto Track Input Raw into Live',
              detail: `Versi: ${app.getVersion()}\n\nAkses perangkat lain di LAN:\n${ipList || 'Tidak ada jaringan LAN terdeteksi'}\n\nNext.js: http://localhost:${NEXT_PORT}\nSocket.io: http://localhost:${SOCKET_PORT}`,
            })
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Potong' },
        { role: 'copy', label: 'Salin' },
        { role: 'paste', label: 'Tempel' },
        { role: 'selectAll', label: 'Pilih Semua' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Muat Ulang' },
        { role: 'forceReload', label: 'Muat Ulang (Paksa)' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Ukuran Normal' },
        { role: 'zoomIn', label: 'Perbesar' },
        { role: 'zoomOut', label: 'Perkecil' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Layar Penuh' },
      ],
    },
    {
      label: 'Jaringan',
      submenu: [
        {
          label: 'Lihat IP Address LAN',
          click: () => {
            const ips = getLocalIPs()
            const ipList = ips.map(ip => `${ip.name}: ${ip.address}`).join('\n')
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'IP Address LAN',
              message: 'Perangkat lain dapat mengakses SAATIRIL di:',
              detail: ipList
                ? ips.map(ip =>
                    `  ${ip.name}: http://${ip.address}:${NEXT_PORT}`
                  ).join('\n')
                : 'Tidak ada jaringan LAN terdeteksi',
            })
          },
        },
        {
          label: 'Buka di Browser',
          click: () => {
            shell.openExternal(`http://localhost:${NEXT_PORT}`)
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

app.on('ready', async () => {
  console.log('[SAATIRIL Electron] App ready, starting servers...')

  try {
    // Start servers in parallel
    await Promise.all([
      startNextServer(),
      startSocketServer(),
    ])

    createMainWindow()

    // Show LAN info after window loads
    mainWindow.webContents.on('did-finish-load', () => {
      const ips = getLocalIPs()
      if (ips.length > 0) {
        const primaryIP = ips[0].address
        console.log(`[SAATIRIL Electron] Perangkat lain bisa akses di: http://${primaryIP}:${NEXT_PORT}`)
      }
    })
  } catch (err) {
    console.error('[SAATIRIL Electron] Failed to start:', err)
    dialog.showErrorBox(
      'Startup Error',
      `Gagal memulai SAATIRIL:\n${err.message}`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  console.log('[SAATIRIL Electron] Shutting down servers...')

  if (nextServerProcess) {
    nextServerProcess.kill('SIGTERM')
    nextServerProcess = null
  }

  if (socketServerProcess) {
    socketServerProcess.kill('SIGTERM')
    socketServerProcess = null
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow()
  }
})
