const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3847'

export const SOCKET_URL = BASE_URL
export const API_BASE = `${BASE_URL}/api`
export const API_TOKEN = import.meta.env.VITE_API_TOKEN || ''
