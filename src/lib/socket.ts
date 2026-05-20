'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export type LocalNetworkCallback = (data: any) => void

const listeners: Record<string, LocalNetworkCallback[]> = {}

export function getSocket(): Socket | null {
  return socket
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket

  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  })

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
