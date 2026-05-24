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
 * MC/Operator on other devices access: https://<LAN_IP>:3000/?role=mc&channel=1&socketPort=3003
 * Admin uses Electron window with saatiril:// protocol
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
let io = null
let httpServer = null
let socketPort = 3003
let httpPort = 3000
let staticFileServer = null
let httpsCert = null  // { cert: Buffer, key: Buffer } — cached for the session

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
// Required for camera access (getUserMedia) from LAN devices.
// Browsers block camera on plain HTTP; HTTPS (even self-signed) enables it.
// Certificate is cached to disk so the operator only accepts the warning once.
function generateOrLoadCert() {
  const userDataPath = app.getPath('userData')
  const certFile = path.join(userDataPath, 'saatiril-cert.pem')
  const keyFile = path.join(userDataPath, 'saatiril-key.pem')

  // Try to load existing cert from disk
  try {
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      const cert = fs.readFileSync(certFile, 'utf8')
      const key = fs.readFileSync(keyFile, 'utf8')
      // Verify the cert hasn't expired (parse the Not After date)
      try {
        const certDetails = new (require('crypto')).X509Certificate(cert)
        if (!certDetails.validToDate || new Date(certDetails.validToDate) > new Date()) {
          console.log('[SAATIRIL] Loaded existing HTTPS certificate from disk')
          return { cert, key }
        }
        console.log('[SAATIRIL] Existing certificate expired — generating new one')
      } catch {
        // If X509Certificate parsing fails, just use it anyway
        console.log('[SAATIRIL] Could not parse cert date — using existing cert')
        return { cert, key }
      }
    }
  } catch (e) {
    console.warn('[SAATIRIL] Could not load existing cert:', e.message)
  }

  // Generate new self-signed certificate
  console.log('[SAATIRIL] Generating new self-signed HTTPS certificate...')
  try {
    const attrs = [
      { name: 'commonName', value: 'SAATIRIL' },
      { name: 'organizationName', value: 'SAATIRIL - Graduation Photo System' },
    ]
    const pems = selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
    })

    // Save to disk for reuse across restarts
    try {
      fs.writeFileSync(certFile, pems.cert, 'utf8')
      fs.writeFileSync(keyFile, pems.private, 'utf8')
      console.log('[SAATIRIL] Certificate saved to disk for reuse')
    } catch (e) {
      console.warn('[SAATIRIL] Could not save cert to disk:', e.message)
    }

    return { cert: pems.cert, key: pems.private }
  } catch (e) {
    console.error('[SAATIRIL] Failed to generate self-signed cert:', e.message)
    return null
  }
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

// ─── Request handler for static file serving ────────────────────────────────
// Shared between HTTP and HTTPS servers — serves Next.js static export
function staticFileHandler(req, res) {
  // Parse URL — strip query params
  const protocol = req.socket.encrypted ? 'https' : 'http'
  const url = new URL(req.url, `${protocol}://${req.headers.host}`)
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
}

// ─── Start HTTPS static file server for LAN access ──────────────────────────
// Serves Next.js static export over HTTPS so MC/Operator devices on the LAN
// can access the web interface AND use their local cameras.
// Browsers require HTTPS (secure context) for getUserMedia() camera access.
// Self-signed cert is generated once and cached to disk.
async function startStaticFileServer() {
  httpPort = await findAvailablePort(3000)
  console.log(`[SAATIRIL] Using HTTPS static file port: ${httpPort}`)

  // Try HTTPS first (required for camera access on LAN devices)
  if (httpsCert) {
    try {
      staticFileServer = createHttpsServer(
        { key: httpsCert.key, cert: httpsCert.cert },
        staticFileHandler,
      )

      await new Promise((resolve, reject) => {
        staticFileServer.listen(httpPort, '0.0.0.0', () => {
          const ips = getLocalIPs()
          console.log(`[SAATIRIL] ✅ HTTPS static file server running on port ${httpPort}`)
          if (ips.length > 0) {
            console.log(`[SAATIRIL] MC/Operator can access at: https://${ips[0].address}:${httpPort}`)
            console.log(`[SAATIRIL] ⚠️  Operator will see a certificate warning — click Advanced → Proceed to enable camera`)
          }
          resolve()
        })
        staticFileServer.on('error', reject)
      })
      return
    } catch (err) {
      console.warn('[SAATIRIL] HTTPS server failed, falling back to HTTP:', err.message)
      staticFileServer = null
    }
  }

  // Fallback to HTTP (camera won't work on LAN devices)
  console.warn('[SAATIRIL] ⚠️  Using HTTP — camera access will NOT work on LAN devices!')
  staticFileServer = createHttpServer(staticFileHandler)

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

// ─── Start Socket.io server (in-process, with HTTPS support) ──────────────
let totalMessagesRelayed = 0
let totalConnections = 0

async function startSocketServer() {
  socketPort = await findAvailablePort(3003)
  console.log(`[SAATIRIL] Using Socket.io port: ${socketPort}`)

  // Use HTTPS for Socket.io server too (prevents mixed content blocking
  // when the page is served over HTTPS and tries to connect via WS)
  if (httpsCert) {
    try {
      httpServer = createHttpsServer({ key: httpsCert.key, cert: httpsCert.cert })
      console.log('[SAATIRIL] Socket.io server using HTTPS (WSS)')
    } catch (err) {
      console.warn('[SAATIRIL] HTTPS for Socket.io failed, using HTTP:', err.message)
      httpServer = createHttpServer()
    }
  } else {
    httpServer = createHttpServer()
  }

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
            const scheme = httpsCert ? 'https' : 'http'
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Tentang SAATIRIL',
              message: 'SAATIRIL — Sistem Auto Track Input Raw into Live',
              detail: `Versi: ${app.getVersion()}\n\nHTTP: Port ${httpPort} (${scheme.toUpperCase()})\nSocket.io: Port ${socketPort}\n\nAkses perangkat lain di LAN:\n${ipList ? ips.map(ip => `  ${scheme}://${ip.address}:${httpPort}`).join('\n') : 'Tidak ada jaringan LAN terdeteksi'}${httpsCert ? '\n\n✅ HTTPS aktif — kamera bisa diakses dari perangkat LAN' : '\n\n⚠️ HTTPS tidak aktif — kamera TIDAK bisa diakses dari perangkat LAN'}`,
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
            const scheme = httpsCert ? 'https' : 'http'
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'IP Address LAN',
              message: 'Perangkat lain dapat mengakses SAATIRIL di:',
              detail: ips.length > 0
                ? ips.map(ip => `  ${ip.name}: ${scheme}://${ip.address}:${httpPort}`).join('\n')
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
    useHttps: !!httpsCert,
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

  // ── Generate HTTPS certificate ────────────────────────────────────────────
  // Must be done BEFORE starting servers so both static + Socket.io use the same cert
  httpsCert = generateOrLoadCert()
  if (httpsCert) {
    console.log('[SAATIRIL] ✅ HTTPS certificate ready — camera access will work on LAN devices')
  } else {
    console.warn('[SAATIRIL] ⚠️  No HTTPS certificate — camera will NOT work on LAN devices')
  }

  console.log('[SAATIRIL] Starting HTTPS static file server...')
  try {
    await startStaticFileServer()
  } catch (err) {
    console.error('[SAATIRIL] Failed to start HTTPS server:', err)
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
    const scheme = httpsCert ? 'https' : 'http'
    if (ips.length > 0) {
      console.log(`[SAATIRIL] Perangkat lain bisa akses: ${scheme}://${ips[0].address}:${httpPort}`)
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
