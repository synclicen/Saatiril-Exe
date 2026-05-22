/**
 * SAATIRIL — Electron Main Process (Windows Desktop)
 *
 * Architecture: NO Next.js server needed!
 * - Next.js is built as static HTML/JS/CSS (output: 'export')
 * - Electron loads files via custom protocol (saatiril://)
 * - Socket.io server runs IN-PROCESS (no child process, no port 3000!)
 * - Socket.io port is auto-detected and passed to renderer
 *
 * This eliminates ALL port conflict issues.
 */

const { app, BrowserWindow, Menu, dialog, shell, protocol, net, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { createServer } = require('http')
const { Server } = require('socket.io')

// ─── Configuration ──────────────────────────────────────────────────────────
const isDev = !app.isPackaged
const STATIC_DIR = isDev
  ? path.join(__dirname, '..', 'out')
  : path.join(process.resourcesPath, 'app')

let mainWindow = null
let io = null
let httpServer = null
let socketPort = 3003

// ─── Utility: Get local network IPs ─────────────────────────────────────────
function getLocalIPs() {
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address })
      }
    }
  }
  return ips
}

// ─── Find available port ────────────────────────────────────────────────────
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const net = require('net')
    const tryPort = (port) => {
      const server = net.createServer()
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port))
      })
      server.on('error', () => {
        if (port < startPort + 100) {
          tryPort(port + 1)
        } else {
          reject(new Error('No available port found'))
        }
      })
    }
    tryPort(startPort)
  })
}

// ─── Register custom protocol for serving static files ──────────────────────
// This must be called BEFORE app.ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'saatiril',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ─── Start Socket.io server (in-process, no child process) ─────────────────
let totalMessagesRelayed = 0
let totalConnections = 0

async function startSocketServer() {
  socketPort = await findAvailablePort(3003)
  console.log(`[SAATIRIL] Using Socket.io port: ${socketPort}`)

  httpServer = createServer((req, res) => {
    // Serve static files for external devices (MC/Operator on other devices)
    const urlPath = (req.url || '/').split('?')[0]

    // Let Socket.io handle its own paths
    if (urlPath.startsWith('/socket.io')) return

    let filePath = urlPath
    if (filePath === '/' || filePath === '') filePath = '/index.html'
    if (filePath.startsWith('/')) filePath = filePath.slice(1)

    const fullPath = path.join(STATIC_DIR, filePath)
    const ext = path.extname(fullPath).toLowerCase()

    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.webp': 'image/webp',
      '.map': 'application/json; charset=utf-8',
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        // Try serving index.html for SPA routing
        const indexPath = path.join(STATIC_DIR, 'index.html')
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(404)
            res.end('Not Found')
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(indexData)
          }
        })
      } else {
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        res.end(data)
      }
    })
  })
  io = new Server(httpServer, {
    path: '/',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // Production-grade settings for ceremony stability
    pingTimeout: 30000,       // 30s — generous for LAN
    pingInterval: 15000,      // 15s — faster disconnect detection
    maxHttpBufferSize: 20e6,  // 20MB — supports dual-channel photo bursts
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
  })

  io.on('connection', (socket) => {
    totalConnections++
    console.log(`[SAATIRIL] Client connected: ${socket.id} (total: ${io.sockets.sockets.size}, all-time: ${totalConnections})`)

    socket.on('lan-message', (payload) => {
      totalMessagesRelayed++
      socket.broadcast.emit('lan-message', payload)
      // Log critical events for debugging
      if (payload.event === 'PHOTOS_SAVED' || payload.event === 'MC_CALL' || payload.event === 'SYNC_DB') {
        console.log(`[SAATIRIL] Relay: ${payload.event} from ${socket.id}`)
      }
    })

    socket.on('identify', (data) => {
      console.log(`[SAATIRIL] Client identified: ${socket.id} → ${data.role} Ch.${data.channel}`)
    })

    socket.on('disconnect', (reason) => {
      console.log(`[SAATIRIL] Client disconnected: ${socket.id} (reason: ${reason}, remaining: ${io.sockets.sockets.size - 1})`)
    })

    socket.on('error', (error) => {
      console.error(`[SAATIRIL] Socket error (${socket.id}):`, error.message)
    })
  })

  return new Promise((resolve, reject) => {
    httpServer.listen(socketPort, '0.0.0.0', () => {
      console.log(`[SAATIRIL] Socket.io server running on port ${socketPort}`)
      console.log(`[SAATIRIL] Production config: ping=15s/30s, maxPayload=20MB, connectionRecovery=2min`)
      resolve()
    })
    httpServer.on('error', reject)
  })
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // Load the static Next.js app via custom protocol
  // Pass socketPort so the renderer knows where to connect
  const startUrl = `saatiril://localhost/index.html?socketPort=${socketPort}`
  mainWindow.loadURL(startUrl)

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
              detail: `Versi: ${app.getVersion()}\n\nSocket.io: Port ${socketPort}\n\nAkses perangkat lain di LAN:\n${ipList || 'Tidak ada jaringan LAN terdeteksi'}`,
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
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'IP Address LAN',
              message: 'Perangkat lain dapat mengakses SAATIRIL di:',
              detail: ips.length > 0
                ? ips.map(ip => `  ${ip.name}: http://${ip.address}:${socketPort}`).join('\n')
                : 'Tidak ada jaringan LAN terdeteksi',
            })
          },
        },
        {
          label: 'Info Socket Server',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Socket.io Server',
              message: `Socket.io berjalan di port ${socketPort}`,
              detail: `Port dipilih otomatis agar tidak bentrok dengan aplikasi lain.`,
            })
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

// ─── IPC Handlers (must be registered before app.ready) ────────────────────
ipcMain.handle('get-version', () => {
  return app.getVersion()
})

ipcMain.handle('select-folder', async (event, defaultPath) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih Folder Tujuan Output',
    defaultPath: defaultPath || 'C:\\SAATIRIL_System_Out',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const selectedPath = result.filePaths[0]
  // Ensure folder exists
  try {
    if (!fs.existsSync(selectedPath)) {
      fs.mkdirSync(selectedPath, { recursive: true })
    }
  } catch (e) {
    console.error('[SAATIRIL] Failed to create folder:', e.message)
  }
  return selectedPath
})

ipcMain.handle('save-photo', async (event, data) => {
  // data: { base64Data: string, filename: string, targetFolder: string }
  try {
    const { base64Data, filename, targetFolder } = data
    if (!base64Data || !filename || !targetFolder) {
      console.error('[SAATIRIL] save-photo: missing required fields')
      return null
    }

    // Ensure target folder exists
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true })
    }

    // Strip data URL prefix (data:image/jpeg;base64,)
    const base64Raw = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Raw, 'base64')

    const filePath = path.join(targetFolder, filename)
    fs.writeFileSync(filePath, buffer)
    console.log(`[SAATIRIL] Photo saved: ${filePath} (${(buffer.length / 1024).toFixed(1)}KB)`)
    return filePath
  } catch (e) {
    console.error('[SAATIRIL] save-photo failed:', e.message)
    return null
  }
})

ipcMain.handle('get-lan-ips', () => {
  return getLocalIPs()
})

// ─── Handle custom protocol ─────────────────────────────────────────────────
app.on('ready', async () => {
  // Register protocol handler for serving static files
  protocol.handle('saatiril', (request) => {
    const url = new URL(request.url)
    let filePath = url.pathname

    // Normalize: remove leading slash, handle directory -> index.html
    if (filePath.startsWith('/')) filePath = filePath.slice(1)
    if (filePath === '' || filePath.endsWith('/')) {
      filePath += 'index.html'
    }

    const fullPath = path.join(STATIC_DIR, filePath)
    return net.fetch(`file://${fullPath}`)
  })

  console.log('[SAATIRIL] Starting Socket.io server...')
  try {
    await startSocketServer()
  } catch (err) {
    console.error('[SAATIRIL] Failed to start Socket.io server:', err)
  }

  createMainWindow()

  mainWindow.webContents.on('did-finish-load', () => {
    const ips = getLocalIPs()
    if (ips.length > 0) {
      console.log(`[SAATIRIL] Perangkat lain bisa akses Socket.io di: ${ips[0].address}:${socketPort}`)
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  console.log('[SAATIRIL] Shutting down...')
  console.log(`[SAATIRIL] Final stats: ${totalMessagesRelayed} messages relayed, ${totalConnections} total connections`)
  // Notify clients before shutting down
  if (io) {
    io.emit('lan-message', { event: 'SERVER_SHUTDOWN', data: { reason: 'app-quit', timestamp: Date.now() } })
  }
  if (io) io.close()
  if (httpServer) httpServer.close()
})

// ─── Prevent crashes during ceremony ──────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('[SAATIRIL] UNCAUGHT EXCEPTION (app stays alive):', error.message)
  // Don't exit — keep the app running for the ceremony!
})

process.on('unhandledRejection', (reason) => {
  console.error('[SAATIRIL] UNHANDLED REJECTION (app stays alive):', reason)
  // Don't exit — keep the app running for the ceremony!
})

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow()
  }
})
