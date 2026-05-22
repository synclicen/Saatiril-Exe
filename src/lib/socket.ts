'use client'

import { io, Socket } from 'socket.io-client'

// ─── Types ────────────────────────────────────────────────────────────────
export type LocalNetworkCallback = (data: any) => void

// ─── Module-level state ───────────────────────────────────────────────────
let socket: Socket | null = null
const listeners: Record<string, LocalNetworkCallback[]> = {}

// ─── Connection health tracking ───────────────────────────────────────────
let connectTime: number | null = null
let lastEventTime: number | null = null
let reconnectCount = 0
let isReconnecting = false

export interface ConnectionHealth {
  connected: boolean
  connectTime: number | null
  lastEventTime: number | null
  reconnectCount: number
  socketId: string | null
  uptime: number // seconds since connect
}

export function getConnectionHealth(): ConnectionHealth {
  return {
    connected: socket?.connected ?? false,
    connectTime,
    lastEventTime,
    reconnectCount,
    socketId: socket?.id ?? null,
    uptime: connectTime ? Math.round((Date.now() - connectTime) / 1000) : 0,
  }
}

/**
 * Get the Socket.io server URL.
 *
 * In Electron desktop mode:
 *   - Read socketPort from URL query parameter (passed by Electron main process)
 *   - Connect directly to localhost:PORT (no Caddy gateway)
 *
 * External device on LAN (served by Electron HTTP server):
 *   - The page was loaded from http://LAN_IP:PORT/ via the Electron server
 *   - Connect to the same origin (which IS the socket server)
 *   - Detected by: not Electron, but URL has socketPort param or non-standard port
 *
 * In web/sandbox mode:
 *   - Use XTransformPort=3003 for Caddy gateway routing
 *   - Path must be '/' to match the server's path config
 */
function getSocketUrl(): string {
  if (typeof window === 'undefined') return '/'

  // Check if running in Electron
  const isElectron = !!(window as any).saatirilAPI?.isElectron

  if (isElectron) {
    // Electron: read socketPort from URL params, connect directly
    const params = new URLSearchParams(window.location.search)
    const port = params.get('socketPort') || '3003'
    return `http://localhost:${port}`
  }

  // Check if we're being served by the Electron server (external device on LAN)
  // Case 1: URL has a socketPort query parameter (from copyLink)
  const params = new URLSearchParams(window.location.search)
  const socketPortParam = params.get('socketPort')
  if (socketPortParam) {
    // We have a socketPort parameter — we're an external device connecting to Electron
    // The current origin is the Electron server, connect directly
    return window.location.origin
  }

  // Case 2: Current port is non-standard (not Next.js dev server, not standard web ports)
  // This means we're likely being served by the Electron HTTP server directly
  const currentPort = window.location.port
  if (currentPort && !['3000', '80', '443', ''].includes(currentPort)) {
    return window.location.origin
  }

  // Web/sandbox mode: use Caddy gateway with XTransformPort
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  return '/?XTransformPort=3003'
}

export function getSocket(): Socket | null {
  return socket
}

// ─── Critical event queue ─────────────────────────────────────────────────
// Events emitted while disconnected are queued and sent on reconnect
interface QueuedEvent {
  event: string
  data: any
  timestamp: number
  retries: number
}

const eventQueue: QueuedEvent[] = []
const MAX_QUEUE_SIZE = 50
const MAX_RETRIES = 3
const CRITICAL_EVENTS = new Set(['PHOTOS_SAVED', 'MC_CALL', 'SYNC_DB'])

function queueEvent(event: string, data: any) {
  // Only queue critical events
  if (!CRITICAL_EVENTS.has(event)) return
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    // Remove oldest non-critical event
    const oldestIdx = eventQueue.findIndex(e => !CRITICAL_EVENTS.has(e.event))
    if (oldestIdx !== -1) {
      eventQueue.splice(oldestIdx, 1)
    } else {
      // All are critical — remove oldest
      eventQueue.shift()
    }
  }
  eventQueue.push({ event, data, timestamp: Date.now(), retries: 0 })
  console.log(`[SAATIRIL] Queued critical event: ${event} (queue: ${eventQueue.length})`)
}

function flushEventQueue() {
  if (!socket?.connected || eventQueue.length === 0) return

  const toSend = [...eventQueue]
  eventQueue.length = 0

  for (const item of toSend) {
    if (item.retries >= MAX_RETRIES) {
      console.warn(`[SAATIRIL] Dropping event after ${MAX_RETRIES} retries: ${item.event}`)
      continue
    }
    item.retries++
    socket.emit('lan-message', { event: item.event, data: item.data })
    console.log(`[SAATIRIL] Flushed queued event: ${item.event} (attempt ${item.retries})`)
  }
}

// ─── Connect Socket ───────────────────────────────────────────────────────
export function connectSocket(): Socket {
  if (socket?.connected) return socket

  const socketUrl = getSocketUrl()
  const isElectron = !!(window as any).saatirilAPI?.isElectron

  const socketOptions = isElectron
    ? {
        // Electron: connect directly to Socket.io server
        path: '/',
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,    // Never give up during ceremony!
        reconnectionDelay: 1000,           // Start at 1s
        reconnectionDelayMax: 10000,       // Max 10s between retries
        timeout: 15000,                    // 15s connection timeout
      }
    : {
        // Web/sandbox: use Caddy gateway
        path: '/',
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,    // Never give up during ceremony!
        reconnectionDelay: 1000,           // Start at 1s
        reconnectionDelayMax: 10000,       // Max 10s between retries
        timeout: 15000,                    // 15s connection timeout
      }

  console.log('[SAATIRIL] Connecting to Socket.io server...', socketUrl)
  socket = io(socketUrl, socketOptions)

  // ── Connection lifecycle ──────────────────────────────────────────────
  socket.on('connect', () => {
    connectTime = Date.now()
    isReconnecting = false
    console.log('[SAATIRIL] Socket connected:', socket?.id, `(reconnects: ${reconnectCount})`)

    // Identify ourselves to the server
    socket?.emit('identify', {
      role: typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('role') || 'unknown'
        : 'unknown',
      channel: typeof window !== 'undefined'
        ? parseInt(new URLSearchParams(window.location.search).get('channel') || '1', 10)
        : 1,
    })

    // Flush any queued events from when we were disconnected
    flushEventQueue()
  })

  socket.on('disconnect', (reason) => {
    console.warn('[SAATIRIL] Socket disconnected. Reason:', reason)
    // If server initiated disconnect, we need manual reconnect
    if (reason === 'io server disconnect') {
      // Server kicked us — reconnect after delay
      setTimeout(() => {
        console.log('[SAATIRIL] Attempting manual reconnect...')
        socket?.connect()
      }, 2000)
    }
  })

  socket.on('connect_error', (error) => {
    if (!isReconnecting) {
      isReconnecting = true
      reconnectCount++
    }
    console.warn('[SAATIRIL] Connection error (attempt #' + reconnectCount + '):', error.message)
  })

  socket.on('reconnect', (attemptNumber) => {
    console.log('[SAATIRIL] Reconnected after', attemptNumber, 'attempts')
    isReconnecting = false
  })

  socket.on('reconnect_error', (error) => {
    console.warn('[SAATIRIL] Reconnection error:', error.message)
  })

  socket.on('reconnect_failed', () => {
    console.error('[SAATIRIL] Reconnection failed — will keep trying manually')
    // Manual retry every 5 seconds
    const manualRetry = setInterval(() => {
      if (socket?.connected) {
        clearInterval(manualRetry)
        return
      }
      console.log('[SAATIRIL] Manual reconnection attempt...')
      socket?.connect()
    }, 5000)
  })

  // ── Server shutdown notification ──────────────────────────────────────
  socket.on('lan-message', (payload: { event: string; data: any }) => {
    const { event: evt, data } = payload
    lastEventTime = Date.now()

    if (evt === 'SERVER_SHUTDOWN') {
      console.warn('[SAATIRIL] Server is shutting down:', data)
      return
    }

    if (listeners[evt]) {
      listeners[evt].forEach(cb => {
        try {
          cb(data)
        } catch (err) {
          console.error(`[SAATIRIL] Error in listener for ${evt}:`, err)
        }
      })
    }
  })

  return socket
}

// ─── Emit with queue ──────────────────────────────────────────────────────
export function emitLocal(event: string, data: any) {
  if (socket?.connected) {
    socket.emit('lan-message', { event, data })
  } else if (CRITICAL_EVENTS.has(event)) {
    // Queue critical events for later delivery
    queueEvent(event, data)
  } else {
    console.warn(`[SAATIRIL] Event "${event}" lost — socket not connected and not critical`)
  }

  // Always trigger local listeners immediately (even if disconnected)
  if (listeners[event]) {
    listeners[event].forEach(cb => {
      try {
        cb(data)
      } catch (err) {
        console.error(`[SAATIRIL] Error in local listener for ${event}:`, err)
      }
    })
  }
}

// ─── Listener management ──────────────────────────────────────────────────
export function onLocal(event: string, callback: LocalNetworkCallback) {
  if (!listeners[event]) listeners[event] = []
  listeners[event].push(callback)
  return () => {
    listeners[event] = listeners[event].filter(cb => cb !== callback)
  }
}

export function offLocal(event: string, callback?: LocalNetworkCallback) {
  if (!listeners[event]) return
  if (callback) {
    listeners[event] = listeners[event].filter(cb => cb !== callback)
  } else {
    delete listeners[event]
  }
}
