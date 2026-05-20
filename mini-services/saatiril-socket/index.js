/**
 * SAATIRIL — Socket.io Relay Server
 *
 * This server relays LAN messages between SAATIRIL clients
 * (admin, MC, operators) connected on the same network.
 *
 * Can be run standalone or imported as a module from Electron.
 */

const { createServer } = require('http')
const { Server } = require('socket.io')

function createSocketServer(port = 3003) {
  const httpServer = createServer()
  const io = new Server(httpServer, {
    path: '/',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  io.on('connection', (socket) => {
    console.log(`[SAATIRIL] Client connected: ${socket.id}`)

    // Relay LAN messages between clients
    socket.on('lan-message', (payload) => {
      // Broadcast to all other clients
      socket.broadcast.emit('lan-message', payload)
    })

    socket.on('disconnect', () => {
      console.log(`[SAATIRIL] Client disconnected: ${socket.id}`)
    })

    socket.on('error', (error) => {
      console.error(`[SAATIRIL] Socket error (${socket.id}):`, error)
    })
  })

  return new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`[SAATIRIL] Socket.io server running on port ${port}`)
      resolve({ httpServer, io, port })
    })

    httpServer.on('error', reject)
  })
}

// ─── Run standalone if called directly ───────────────────────────────────────
const isMainModule = typeof require !== 'undefined' &&
  (require.main === module ||
   (process.argv[1] && require('path').basename(process.argv[1]) === 'index.js'))

if (isMainModule) {
  const PORT = parseInt(process.env.PORT || '3003', 10)

  createSocketServer(PORT).then(({ httpServer }) => {
    process.on('SIGTERM', () => {
      httpServer.close(() => process.exit(0))
    })

    process.on('SIGINT', () => {
      httpServer.close(() => process.exit(0))
    })
  }).catch((err) => {
    console.error('[SAATIRIL] Failed to start Socket.io server:', err)
    process.exit(1)
  })
}

// ─── Export for Electron integration ─────────────────────────────────────────
module.exports = { createSocketServer }
