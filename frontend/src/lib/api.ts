'use client'

import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1',
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// ─── Single-flight refresh ────────────────────────────────────────────────────
// Prevents multiple concurrent 401s from each firing their own /auth/refresh,
// which causes the "unique constraint on refresh_tokens_token_key" crash.
let isRefreshing = false
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = []

function processQueue(error: any, token: string | null = null) {
  refreshQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  refreshQueue = []
}

// ─── Request interceptor — attach token ──────────────────────────────────────
// FE-001: Token is read from the auth store's in-memory getter, NOT from
// localStorage. This ensures the token is never accessible via XSS.
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      // Lazy import — avoids circular dependency at module load time
      try {
        const { useAuthStore } = require('@/store/auth.store')
        const token = useAuthStore.getState().getAccessToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
      } catch {
        // Store not yet initialized — proceed without token (login page etc.)
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ─── Response interceptor — handle 401 with single-flight refresh ─────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      if (isRefreshing) {
        // Queue this request until the in-flight refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        }).catch((err) => Promise.reject(err))
      }

      isRefreshing = true

      try {
        const response = await api.post('/auth/refresh')
        const { accessToken } = response.data.data

        // FE-001: push new token into memory store, not localStorage
        if (typeof window !== 'undefined') {
          try {
            const { useAuthStore } = require('@/store/auth.store')
            useAuthStore.getState().setToken(accessToken)
          } catch {}
        }

        processQueue(null, accessToken)
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        if (typeof window !== 'undefined') {
          try {
            const { useAuthStore } = require('@/store/auth.store')
            useAuthStore.getState().logout()
          } catch {
            localStorage.removeItem('halqa-auth')
            window.location.href = '/login'
          }
        }
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

export default api
