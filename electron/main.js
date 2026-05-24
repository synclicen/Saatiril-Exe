/**
 * SAATIRIL — Electron Main Process (Windows Desktop)
 *
 * Architecture: DUAL SERVER for maximum compatibility
 * ─────────────────────────────────────────────────────
 * - Port 3000: HTTP static file server (ALWAYS runs — for MC display)
 * - Port 3001: HTTPS static file server (BEST-EFFORT — for Operator camera)
 * - Port 3003: HTTP Socket.io server (ALWAYS runs — admin + MC + HTTP operator)
 * - Port 3001: HTTPS Socket.io (shares port with HTTPS static, for HTTPS operator)
 *
 * Why dual server?
 *   Browsers require HTTPS (secure context) for getUserMedia() camera access
 *   on non-localhost origins. But self-signed HTTPS may fail on some Windows
 *   configs. HTTP always works, so MC can always access via HTTP.
 *   Operator needs HTTPS for camera — if HTTPS fails, they use Chrome flag:
 *   chrome://flags/#unsafely-treat-insecure-origin-as-secure
 *
 * Admin uses Electron window with saatiril:// custom protocol.
 */

const { app, BrowserWindow, Menu, dialog, shell, protocol, net, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { createServer: createHttpServer } = require('http')
const { createServer: createHttpsServer } = require('https')
const { Server } = require('socket.io')
const selfsigned = require('selfsigned')

// ─── Configuration ──────────────────────────────────────────────────────────
const isDev = !app.isPackaged
const STATIC_DIR = isDev
  ? path.join(__dirname, '..', 'out')
  : path.join(process.resourcesPath, 'app')

let mainWindow = null

// ─── Server state ───────────────────────────────────────────────────────────
let httpPort = 3000          // HTTP static file server (ALWAYS runs)
let httpsPort = 3001         // HTTPS static file server (BEST-EFFORT)
let socketPort = 3003        // HTTP Socket.io server (ALWAYS runs)
let httpStaticServer = null  // HTTP server instance
let httpsStaticServer = null // HTTPS server instance
let httpSocketServer = null  // HTTP Socket.io server instance
let httpsCert = null         // { cert: string, key: string } — PEM format
let httpsServerRunning = false  // True only when HTTPS is ACTUALLY listening

// Socket.io instances
let ioHttp = null   // Primary Socket.io on HTTP
let ioHttps = null  // Secondary Socket.io on HTTPS (bridged to ioHttp)

// ─── Stats ──────────────────────────────────────────────────────────────────
let totalMessagesRelayed = 0
let totalConnections = 0

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

// ─── Generate self-signed HTTPS certificate ──────────────────────────────────
// Always regenerated on startup because LAN IPs change across networks.
// Includes Subject Alternative Names (SANs) with current LAN IPs — required
// by modern Chrome/Edge for certificate validation.
function generateCert() {
  console.log('[SAATIRIL] Generating self-signed HTTPS certificate...')
  try {
    const attrs = [
      { name: 'commonName', value: 'SAATIRIL' },
      { name: 'organizationName', value: 'SAATIRIL - Graduation Photo System' },
    ]

    // Build SANs with current LAN IPs
    const ips = getLocalIPs()
    const altNames = []
    // Add DNS names
    altNames.push({ type: 2, value: 'localhost' })
    altNames.push({ type: 2, value: 'SAATIRIL' })
    // Add IP addresses
    altNames.push({ type: 7, ip: '127.0.0.1' })
    for (const ip of ips) {
      altNames.push({ type: 7, ip: ip.address })
    }

    console.log(`[SAATIRIL] Certificate SANs: ${altNames.map(s => s.type === 7 ? s.ip : s.value).join(', ')}`)

    const pems = selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{
        name: 'subjectAltName',
        altNames: altNames,
      }],
    })

    // Save to disk for debugging/inspection
    try {
      const userDataPath = app.getPath('userData')
      fs.writeFileSync(path.join(userDataPath, 'saatiril-cert.pem'), pems.cert, 'utf8')
      fs.writeFileSync(path.join(userDataPath, 'saatiril-key.pem'), pems.private, 'utf8')
      console.log('[SAATIRIL] Certificate saved to disk for inspection')
    } catch (e) {
      console.warn('[SAATIRIL] Could not save cert to disk:', e.message)
    }

    console.log('[SAATIRIL] ✅ HTTPS certificate generated successfully')
    return { cert: pems.cert, key: pems.private }
  } catch (e) {
    console.error('[SAATIRIL] ❌ Failed to generate self-signed cert:', e.message)
    return null
  }
}

// ─── Find available port ────────────────────────────────────────────────────
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const net = require('net')
    const tryPort = (port) => {
      const server = net.createServer()
      server.listen(port, '0.0.0.0', () => {
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

// ─── Static file handler (shared by HTTP and HTTPS servers) ─────────────────
function staticFileHandler(req, res) {
  const protocol = req.socket.encrypted ? 'https' : 'http'
  const url = new URL(req.url, `${protocol}://${req.headers.host}`)
  let filePath = url.pathname

  // Normalize: remove leading slash, handle directory → index.html
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
      // File not found → serve index.html (client-side routing)
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

    const ext = path.extname(fullPath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}

// ─── Socket.io shared config ────────────────────────────────────────────────
const SOCKET_IO_CONFIG = {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 15000,
  maxHttpBufferSize: 20e6,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
}

// ─── Setup Socket.io event handlers ─────────────────────────────────────────
function setupSocketHandlers(io, label) {
  io.on('connection', (socket) => {
    totalConnections++
    console.log(`[SAATIRIL] Client connected [${label}]: ${socket.id} (total: ${getAllSocketCount()}, all-time: ${totalConnections})`)

    socket.on('lan-message', (payload) => {
      totalMessagesRelayed++
      // Broadcast to OTHER clients on the SAME server
      socket.broadcast.emit('lan-message', payload)
      // Bridge to the OTHER server's clients
      bridgeMessage(payload, label)
      // Log critical events
      if (payload.event === 'PHOTOS_SAVED' || payload.event === 'MC_CALL' || payload.event === 'SYNC_DB') {
        console.log(`[SAATIRIL] Relay [${label}]: ${payload.event} from ${socket.id}`)
      }
    })

    socket.on('identify', (data) => {
      console.log(`[SAATIRIL] Client identified [${label}]: ${socket.id} → ${data.role} Ch.${data.channel}`)
    })

    socket.on('disconnect', (reason) => {
      console.log(`[SAATIRIL] Client disconnected [${label}]: ${socket.id} (reason: ${reason})`)
    })

    socket.on('error', (error) => {
      console.error(`[SAATIRIL] Socket error [${label}] (${socket.id}):`, error.message)
    })
  })
}

// ─── Bridge messages between HTTP and HTTPS Socket.io servers ───────────────
// When a message arrives on one server, it needs to reach clients on the other.
function bridgeMessage(payload, sourceLabel) {
  if (sourceLabel === 'http' && ioHttps) {
    // Forward HTTP server message to all HTTPS clients
    ioHttps.emit('lan-message', payload)
  } else if (sourceLabel === 'https' && ioHttp) {
    // Forward HTTPS server message to all HTTP clients
    ioHttp.emit('lan-message', payload)
  }
}

// ─── Get total connected socket count across both servers ───────────────────
function getAllSocketCount() {
  const httpCount = ioHttp?.sockets.sockets.size ?? 0
  const httpsCount = ioHttps?.sockets.sockets.size ?? 0
  return httpCount + httpsCount
}

// ─── Start HTTP static file server (ALWAYS runs, port 3000) ────────────────
async function startHttpServer() {
  httpPort = await findAvailablePort(3000)
  console.log(`[SAATIRIL] Starting HTTP static file server on port ${httpPort}...`)

  httpStaticServer = createHttpServer(staticFileHandler)

  return new Promise((resolve, reject) => {
    httpStaticServer.listen(httpPort, '0.0.0.0', () => {
      const ips = getLocalIPs()
      console.log(`[SAATIRIL] ✅ HTTP server running on port ${httpPort}`)
      if (ips.length > 0) {
        console.log(`[SAATIRIL] MC access: http://${ips[0].address}:${httpPort}`)
      }
      resolve()
    })
    httpStaticServer.on('error', reject)
  })
}

// ─── Start HTTPS static file server (BEST-EFFORT, port 3001) ───────────────
async function startHttpsServer() {
  if (!httpsCert) {
    console.warn('[SAATIRIL] ⚠️  No HTTPS cert — skipping HTTPS server')
    httpsServerRunning = false
    return
  }

  httpsPort = await findAvailablePort(3001)
  console.log(`[SAATIRIL] Starting HTTPS static file server on port ${httpsPort}...`)

  try {
    httpsStaticServer = createHttpsServer(
      { key: httpsCert.key, cert: httpsCert.cert },
      staticFileHandler,
    )

    // Add error handling for TLS issues
    httpsStaticServer.on('tlsClientError', (err) => {
      // These are common with self-signed certs and can be noisy — log at debug level
      // console.debug('[SAATIRIL] TLS client error:', err.message)
    })

    await new Promise((resolve, reject) => {
      httpsStaticServer.listen(httpsPort, '0.0.0.0', () => {
        httpsServerRunning = true
        const ips = getLocalIPs()
        console.log(`[SAATIRIL] ✅ HTTPS server running on port ${httpsPort}`)
        if (ips.length > 0) {
          console.log(`[SAATIRIL] Operator camera access: https://${ips[0].address}:${httpsPort}`)
          console.log(`[SAATIRIL] ⚠️  Operator must click Advanced → Proceed on cert warning`)
        }
        resolve()
      })
      httpsStaticServer.on('error', (err) => {
        console.warn('[SAATIRIL] ❌ HTTPS server failed:', err.message)
        httpsServerRunning = false
        reject(err)
      })
    })
  } catch (err) {
    console.warn('[SAATIRIL] ❌ HTTPS server failed to start:', err.message)
    httpsServerRunning = false
    httpsStaticServer = null
  }
}

// ─── Start HTTP Socket.io server (ALWAYS runs, port 3003) ──────────────────
async function startHttpSocketServer() {
  socketPort = await findAvailablePort(3003)
  console.log(`[SAATIRIL] Starting HTTP Socket.io server on port ${socketPort}...`)

  httpSocketServer = createHttpServer()
  ioHttp = new Server(httpSocketServer, SOCKET_IO_CONFIG)
  setupSocketHandlers(ioHttp, 'http')

  return new Promise((resolve, reject) => {
    httpSocketServer.listen(socketPort, '0.0.0.0', () => {
      console.log(`[SAATIRIL] ✅ Socket.io (HTTP/WS) running on port ${socketPort}`)
      resolve()
    })
    httpSocketServer.on('error', reject)
  })
}

// ─── Start HTTPS Socket.io server (BEST-EFFORT, shares HTTPS static server) ─
// This is created AFTER the HTTPS static server is running, by attaching
// Socket.io to the same HTTPS server instance.
function startHttpsSocketServer() {
  if (!httpsStaticServer || !httpsServerRunning) {
    console.log('[SAATIRIL] Skipping HTTPS Socket.io — HTTPS static server not available')
    return
  }

  try {
    ioHttps = new Server(httpsStaticServer, SOCKET_IO_CONFIG)
    setupSocketHandlers(ioHttps, 'https')
    console.log(`[SAATIRIL] ✅ Socket.io (HTTPS/WSS) attached to HTTPS server on port ${httpsPort}`)
  } catch (err) {
    console.warn('[SAATIRIL] ❌ HTTPS Socket.io failed:', err.message)
    ioHttps = null
  }
}

// ─── Create main window ─────────────────────────────────────────────────────
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

  const startUrl = `saatiril://localhost/index.html?socketPort=${socketPort}&httpPort=${httpPort}&httpsPort=${httpsPort}&httpsAvailable=${httpsServerRunning ? '1' : '0'}`

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

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
              detail:
                `Versi: ${app.getVersion()}\n\n` +
                `HTTP: Port ${httpPort} (selalu aktif)\n` +
                `HTTPS: Port ${httpsPort} (${httpsServerRunning ? 'aktif' : 'TIDAK aktif'})\n` +
                `Socket.io: Port ${socketPort}\n\n` +
                `Akses perangkat lain di LAN:\n` +
                (ips.length > 0
                  ? ips.map(ip => `  http://${ip.address}:${httpPort}`).join('\n') + '\n' +
                    (httpsServerRunning ? ips.map(ip => `  https://${ip.address}:${httpsPort}`).join('\n') : '')
                  : 'Tidak ada jaringan LAN terdeteksi') +
                (httpsServerRunning
                  ? '\n\n✅ HTTPS aktif — kamera operator bisa diakses'
                  : '\n\n⚠️ HTTPS tidak aktif — Operator perlu Chrome Flag untuk kamera'),
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
              detail:
                `HTTP (MC & dasar):\n` +
                (ips.length > 0
                  ? ips.map(ip => `  http://${ip.address}:${httpPort}`).join('\n')
                  : 'Tidak ada jaringan LAN terdeteksi') +
                (httpsServerRunning
                  ? `\n\nHTTPS (Operator kamera):\n` + ips.map(ip => `  https://${ip.address}:${httpsPort}`).join('\n')
                  : '\n\n⚠️ HTTPS tidak aktif'),
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
              detail: `HTTP Socket.io: port ${socketPort}\n${httpsServerRunning ? `HTTPS Socket.io: port ${httpsPort}` : 'HTTPS Socket.io: tidak aktif'}`,
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

// ─── IPC Handlers ───────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-lan-info', () => {
  const ips = getLocalIPs()
  return {
    httpPort,
    httpsPort,
    socketPort,
    httpsAvailable: httpsServerRunning,  // Based on ACTUAL running status
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
  try {
    const { base64Data, filename, targetFolder } = data
    if (!base64Data || !filename || !targetFolder) {
      console.error('[SAATIRIL] save-photo: missing required fields')
      return null
    }
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true })
    }
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

// ─── App lifecycle ──────────────────────────────────────────────────────────
app.on('ready', async () => {
  // Register protocol handler for serving static files
  protocol.handle('saatiril', (request) => {
    const url = new URL(request.url)
    let filePath = url.pathname
    if (filePath.startsWith('/')) filePath = filePath.slice(1)
    if (filePath === '' || filePath.endsWith('/')) {
      filePath += 'index.html'
    }
    const fullPath = path.join(STATIC_DIR, filePath)
    const fileUrl = pathToFileURL(fullPath).href
    return net.fetch(fileUrl)
  })

  // ── Step 1: Start HTTP server (ALWAYS works) ───────────────────────────
  try {
    await startHttpServer()
  } catch (err) {
    console.error('[SAATIRIL] ❌ CRITICAL: HTTP server failed:', err)
  }

  // ── Step 2: Generate cert and start HTTPS server (BEST-EFFORT) ─────────
  httpsCert = generateCert()
  if (httpsCert) {
    try {
      await startHttpsServer()
    } catch (err) {
      console.warn('[SAATIRIL] HTTPS server failed (non-critical):', err.message)
      httpsServerRunning = false
    }
  }

  // ── Step 3: Start HTTP Socket.io server (ALWAYS works) ─────────────────
  try {
    await startHttpSocketServer()
  } catch (err) {
    console.error('[SAATIRIL] ❌ CRITICAL: Socket.io server failed:', err)
  }

  // ── Step 4: Attach HTTPS Socket.io to HTTPS server (BEST-EFFORT) ───────
  startHttpsSocketServer()

  // ── Step 5: Fresh install detection ────────────────────────────────────
  const userDataPath = app.getPath('userData')
  const sessionMarkerPath = path.join(userDataPath, '.saatiril_session')
  let isFreshInstall = false
  try {
    if (fs.existsSync(sessionMarkerPath)) {
      const storedMarker = fs.readFileSync(sessionMarkerPath, 'utf8').trim()
      const currentVersion = app.getVersion()
      if (storedMarker !== currentVersion) {
        isFreshInstall = true
        fs.writeFileSync(sessionMarkerPath, currentVersion)
        console.log(`[SAATIRIL] Version changed (${storedMarker} → ${currentVersion}) — fresh install`)
      }
    } else {
      isFreshInstall = true
      fs.writeFileSync(sessionMarkerPath, app.getVersion())
      console.log('[SAATIRIL] First launch detected')
    }
  } catch (e) {
    console.error('[SAATIRIL] Session marker error:', e.message)
  }

  // ── Step 6: Create main window ────────────────────────────────────────
  createMainWindow(isFreshInstall)

  mainWindow.webContents.on('did-finish-load', () => {
    const ips = getLocalIPs()
    if (ips.length > 0) {
      console.log(`[SAATIRIL] ════════════════════════════════════════════════════`)
      console.log(`[SAATIRIL]  MC akses:         http://${ips[0].address}:${httpPort}`)
      if (httpsServerRunning) {
        console.log(`[SAATIRIL]  Operator kamera:  https://${ips[0].address}:${httpsPort}`)
      } else {
        console.log(`[SAATIRIL]  ⚠️  HTTPS tidak aktif — Operator gunakan Chrome Flag`)
      }
      console.log(`[SAATIRIL]  Socket.io:        port ${socketPort}`)
      console.log(`[SAATIRIL] ════════════════════════════════════════════════════`)
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  console.log('[SAATIRIL] Shutting down...')
  console.log(`[SAATIRIL] Stats: ${totalMessagesRelayed} messages, ${totalConnections} connections`)
  if (ioHttp) ioHttp.emit('lan-message', { event: 'SERVER_SHUTDOWN', data: { reason: 'app-quit', timestamp: Date.now() } })
  if (ioHttps) ioHttps.emit('lan-message', { event: 'SERVER_SHUTDOWN', data: { reason: 'app-quit', timestamp: Date.now() } })
  if (ioHttp) ioHttp.close()
  if (ioHttps) ioHttps.close()
  if (httpSocketServer) httpSocketServer.close()
  if (httpStaticServer) httpStaticServer.close()
  if (httpsStaticServer) httpsStaticServer.close()
})

process.on('uncaughtException', (error) => {
  console.error('[SAATIRIL] UNCAUGHT EXCEPTION (app stays alive):', error.message)
})

process.on('unhandledRejection', (reason) => {
  console.error('[SAATIRIL] UNHANDLED REJECTION (app stays alive):', reason)
})

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow()
  }
})
