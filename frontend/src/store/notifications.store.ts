'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: Date
  read: boolean
  actionUrl?: string
  actionLabel?: string
}

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  deleteNotification: (id: string) => void
  clearAll: () => void
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,

      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          read: false,
        }

        set((state) => ({
          notifications: [newNotification, ...state.notifications].slice(0, 100), // Keep last 100
          unreadCount: state.unreadCount + 1,
        }))
      },

      markAsRead: (id) => {
        set((state) => {
          const notifications = state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          )
          const unreadCount = notifications.filter((n) => !n.read).length
          return { notifications, unreadCount }
        })
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        }))
      },

      deleteNotification: (id) => {
        set((state) => {
          const notifications = state.notifications.filter((n) => n.id !== id)
          const unreadCount = notifications.filter((n) => !n.read).length
          return { notifications, unreadCount }
        })
      },

      clearAll: () => {
        set({ notifications: [], unreadCount: 0 })
      },
    }),
    {
      name: 'halqa-notifications',
      partialize: (state) => ({ notifications: state.notifications }),
    }
  )
)
