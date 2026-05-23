/**
 * SAATIRIL — Electron Main Process (Windows Desktop)
 *
 * Architecture: NO Next.js server needed!
 * - Next.js is built as static HTML/JS/CSS (output: 'export')
 * - Electron loads files via custom protocol (saatiril://) for admin window
 * - HTTP static file server on port 3000 serves files for LAN devices (MC/Operator)
 * - Socket.io server runs IN-PROCESS on port 3003
 * - Socket.io port is auto-detected and passed to renderer
 *
 * MC/Operator on other devices access: http://<LAN_IP>:3000/?role=mc&channel=1&socketPort=3003
 * Admin uses Electron window with saatiril:// protocol
 */

const { app, BrowserWindow, Menu, dialog, shell, protocol, net, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { pathToFileURL } = require('url')
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
let httpPort = 3000
let staticFileServer = null

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

// ─── MIME types for static file server ──────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.eot':  'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4',
  '.map':  'application/json',
  '.txt':  'text/plain',
  '.xml':  'application/xml',
}

// ─── Start HTTP static file server for LAN access ──────────────────────────
// Serves Next.js static export so MC/Operator devices on the LAN
// can access the web interface at http://<LAN_IP>:3000/
async function startStaticFileServer() {
  httpPort = await findAvailablePort(3000)
  console.log(`[SAATIRIL] Using HTTP static file port: ${httpPort}`)

  staticFileServer = createServer((req, res) => {
    // Parse URL — strip query params
    const url = new URL(req.url, `http://${req.headers.host}`)
    let filePath = url.pathname

    // Normalize: remove leading slash, handle directory -> index.html
    if (filePath.startsWith('/')) filePath = filePath.slice(1)
    if (filePath === '' || filePath.endsWith('/')) {
      filePath += 'index.html'
    }

    const fullPath = path.normalize(path.join(STATIC_DIR, filePath))

    // Security: prevent directory traversal
    if (!fullPath.startsWith(path.normalize(STATIC_DIR))) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(fullPath, (err, data) => {
      if (err) {
        // If file not found, serve index.html (for client-side routing)
        const indexFile = path.join(STATIC_DIR, 'index.html')
        fs.readFile(indexFile, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(404)
            res.end('Not Found')
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(indexData)
        })
        return
      }

      // Determine content type
      const ext = path.extname(fullPath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    })
  })

  return new Promise((resolve, reject) => {
    staticFileServer.listen(httpPort, '0.0.0.0', () => {
      const ips = getLocalIPs()
      console.log(`[SAATIRIL] HTTP static file server running on port ${httpPort}`)
      if (ips.length > 0) {
        console.log(`[SAATIRIL] MC/Operator can access at: http://${ips[0].address}:${httpPort}`)
      }
      resolve()
    })
    staticFileServer.on('error', reject)
  })
}

// ─── Start Socket.io server (in-process, no child process) ─────────────────
let totalMessagesRelayed = 0
let totalConnections = 0

async function startSocketServer() {
  socketPort = await findAvailablePort(3003)
  console.log(`[SAATIRIL] Using Socket.io port: ${socketPort}`)

  httpServer = createServer()
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
// isFreshInstall is passed so we can clear localStorage BEFORE the first load
// (not after, which caused an infinite reload loop)
let freshInstallCleared = false

function createMainWindow(isFreshInstall = false) {
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

  const startUrl = `saatiril://localhost/index.html?socketPort=${socketPort}`

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // If fresh install, clear localStorage BEFORE the first page load
  // This avoids the infinite reload loop that happened when clearing AFTER load
  if (isFreshInstall && !freshInstallCleared) {
    freshInstallCleared = true
    console.log('[SAATIRIL] Fresh install — clearing localStorage before first load...')
    mainWindow.webContents.session.clearStorageData({
      storages: ['localstorage'],
    }).then(() => {
      console.log('[SAATIRIL] localStorage cleared — loading app...')
      mainWindow.loadURL(startUrl)
    }).catch((err) => {
      console.error('[SAATIRIL] Failed to clear localStorage:', err.message)
      mainWindow.loadURL(startUrl)
    })
  } else {
    mainWindow.loadURL(startUrl)
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
              detail: `Versi: ${app.getVersion()}\n\nHTTP: Port ${httpPort}\nSocket.io: Port ${socketPort}\n\nAkses perangkat lain di LAN:\n${ipList ? ips.map(ip => `  http://${ip.address}:${httpPort}`).join('\n') : 'Tidak ada jaringan LAN terdeteksi'}`,
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
                ? ips.map(ip => `  ${ip.name}: http://${ip.address}:${httpPort}`).join('\n')
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

ipcMain.handle('get-lan-info', () => {
  const ips = getLocalIPs()
  return {
    httpPort,
    socketPort,
    ips: ips.map(ip => ({ name: ip.name, address: ip.address })),
  }
})

ipcMain.handle('get-lan-ips', () => {
  const ips = getLocalIPs()
  return ips.map(ip => ({ name: ip.name, address: ip.address }))
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
    // Use pathToFileURL for correct file:// URLs on Windows (backslash → forward slash)
    const fileUrl = pathToFileURL(fullPath).href
    return net.fetch(fileUrl)
  })

  console.log('[SAATIRIL] Starting HTTP static file server...')
  try {
    await startStaticFileServer()
  } catch (err) {
    console.error('[SAATIRIL] Failed to start HTTP server:', err)
  }

  console.log('[SAATIRIL] Starting Socket.io server...')
  try {
    await startSocketServer()
  } catch (err) {
    console.error('[SAATIRIL] Failed to start Socket.io server:', err)
  }

  // ── Fresh install detection ──────────────────────────────────────────────
  // Write a session marker file. If the marker is missing, it means the app
  // was freshly installed (or the userData dir was cleaned). We pass this
  // info to the renderer so it can clear stale localStorage data.
  const userDataPath = app.getPath('userData')
  const sessionMarkerPath = path.join(userDataPath, '.saatiril_session')
  let isFreshInstall = false
  try {
    if (fs.existsSync(sessionMarkerPath)) {
      // Existing install — read the marker
      const storedMarker = fs.readFileSync(sessionMarkerPath, 'utf8').trim()
      const currentVersion = app.getVersion()
      if (storedMarker !== currentVersion) {
        // Version changed (update or reinstall) — mark as fresh
        isFreshInstall = true
        fs.writeFileSync(sessionMarkerPath, currentVersion)
        console.log(`[SAATIRIL] Version changed (${storedMarker} → ${currentVersion}) — fresh install detected`)
      }
    } else {
      // No marker file — first launch after install
      isFreshInstall = true
      fs.writeFileSync(sessionMarkerPath, app.getVersion())
      console.log('[SAATIRIL] First launch detected — marking as fresh install')
    }
  } catch (e) {
    console.error('[SAATIRIL] Session marker error:', e.message)
  }

  // Pass isFreshInstall flag so createMainWindow can clear localStorage
  // BEFORE the first page load (not after, which caused infinite reload loop)
  createMainWindow(isFreshInstall)

  mainWindow.webContents.on('did-finish-load', () => {
    const ips = getLocalIPs()
    if (ips.length > 0) {
      console.log(`[SAATIRIL] Perangkat lain bisa akses: http://${ips[0].address}:${httpPort}`)
      console.log(`[SAATIRIL] Socket.io berjalan di: ${ips[0].address}:${socketPort}`)
    }
    // NOTE: No reload logic here! Fresh install clearing is done
    // BEFORE the first load in createMainWindow() to avoid infinite loops.
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
  if (staticFileServer) staticFileServer.close()
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
