import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[SAATIRIL] Client connected: ${socket.id}`)

  // Relay LAN messages between clients
  socket.on('lan-message', (payload: { event: string; data: any }) => {
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

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[SAATIRIL] Socket.io server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
