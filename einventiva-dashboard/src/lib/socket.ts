import { io, Socket } from 'socket.io-client'
import { SOCKET_URL, API_TOKEN } from './config'

let sharedSocket: Socket | null = null
let refCount = 0

export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      auth: { token: API_TOKEN },
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    })
  }
  refCount++
  return sharedSocket
}

export function releaseSharedSocket(): void {
  refCount--
  if (refCount <= 0 && sharedSocket) {
    sharedSocket.disconnect()
    sharedSocket = null
    refCount = 0
  }
}

export function createDedicatedSocket(): Socket {
  return io(SOCKET_URL, {
    auth: { token: API_TOKEN },
    reconnection: true,
    reconnectionDelay: 2000,
  })
}
