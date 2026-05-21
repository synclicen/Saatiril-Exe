'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export type LocalNetworkCallback = (data: any) => void

const listeners: Record<string, LocalNetworkCallback[]> = {}

/**
 * Get the Socket.io server URL.
 * 
 * In Electron desktop mode:
 *   - Read socketPort from URL query parameter (passed by Electron main process)
 *   - Connect directly to localhost:PORT (no Caddy gateway)
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
  
  // Web/sandbox mode: use Caddy gateway with XTransformPort
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  return '/?XTransformPort=3003'
}

export function getSocket(): Socket | null {
  return socket
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket

  const socketUrl = getSocketUrl()
  const isElectron = !!(window as any).saatirilAPI?.isElectron

  const socketOptions = isElectron
    ? {
        // Electron: connect directly to Socket.io server
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 10000,
      }
    : {
        // Web/sandbox: use Caddy gateway
        // Path must be '/' to match the server's path config
        path: '/',
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 10000,
      }

  socket = io(socketUrl, socketOptions)

  socket.on('connect', () => {
    console.log('[SAATIRIL] Socket connected:', socket?.id)
  })

  socket.on('disconnect', () => {
    console.log('[SAATIRIL] Socket disconnected')
  })

  socket.on('lan-message', (payload: { event: string; data: any }) => {
    const { event: evt, data } = payload
    if (listeners[evt]) {
      listeners[evt].forEach(cb => cb(data))
    }
  })

  return socket
}

export function emitLocal(event: string, data: any) {
  if (socket?.connected) {
    socket.emit('lan-message', { event, data })
  }
  // Also trigger local listeners
  if (listeners[event]) {
    listeners[event].forEach(cb => cb(data))
  }
}

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
