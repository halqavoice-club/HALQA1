import api from './api'

export const groupChatApi = {
  // ── Conversations ──────────────────────────────────────────────────────────
  list:   (params?: { schoolId?: string; classId?: string }) =>
    api.get('/group-chat/conversations', { params }),

  create: (data: {
    name: string
    description?: string
    privacy?: 'PUBLIC' | 'PRIVATE' | 'SCHOOL_ONLY' | 'CLASS_ONLY'
    avatarUrl?: string
    maxMembers?: number
    schoolId?: string
    classId?: string
  }) => api.post('/group-chat/conversations', data),

  get: (id: string) => api.get(`/group-chat/conversations/${id}`),

  // Update group name/description/privacy/avatar (owner/admin)
  update: (id: string, data: {
    name?: string
    description?: string
    privacy?: 'PUBLIC' | 'PRIVATE' | 'SCHOOL_ONLY' | 'CLASS_ONLY'
    avatarUrl?: string
    maxMembers?: number
  }) => api.patch(`/group-chat/conversations/${id}`, data),

  // Delete group (OWNER only)
  deleteGroup: (id: string) => api.delete(`/group-chat/conversations/${id}`),

  // ── Members ────────────────────────────────────────────────────────────────
  addMember: (convId: string, userId: string, role?: string) =>
    api.post(`/group-chat/conversations/${convId}/members`, { userId, role }),

  removeMember: (convId: string, userId: string) =>
    api.delete(`/group-chat/conversations/${convId}/members/${userId}`),

  // Promote to ADMIN or demote to MEMBER (owner only); pass 'OWNER' to transfer ownership
  updateMemberRole: (convId: string, userId: string, role: 'ADMIN' | 'MEMBER' | 'OWNER') =>
    api.patch(`/group-chat/conversations/${convId}/members/${userId}/role`, { role }),

  // Update who can send messages / media (owner/admin)
  updatePermissions: (convId: string, data: {
    onlyAdminsCanSendMessages?: boolean
    onlyAdminsCanSendMedia?: boolean
  }) => api.patch(`/group-chat/conversations/${convId}/permissions`, data),

  // ── Messages ───────────────────────────────────────────────────────────────
  messages: (convId: string, before?: string, limit = 50) =>
    api.get(`/group-chat/conversations/${convId}/messages`, {
      params: { limit, ...(before ? { before } : {}) }
    }),

  send: (convId: string, data: {
    body?: string
    type?: string
    mediaUrl?: string
    mimeType?: string
    fileSize?: number
    fileName?: string
    duration?: number
    replyToId?: string
  }) => api.post(`/group-chat/conversations/${convId}/messages`, data),

  // Edit own message — sender only, 15-minute window
  editMessage: (messageId: string, body: string) =>
    api.patch(`/group-chat/messages/${messageId}`, { body }),

  // Soft-delete for sender; hard-delete for admin/owner
  deleteMessage: (messageId: string) =>
    api.delete(`/group-chat/messages/${messageId}`),

  // Pin / unpin message (admin/owner only)
  pinMessage: (convId: string, messageId: string, pin = true) =>
    api.post(`/group-chat/conversations/${convId}/messages/${messageId}/pin`, { pin }),

  // ── Reactions & Read ───────────────────────────────────────────────────────
  // Toggle: same emoji = remove, different emoji = replace
  react: (msgId: string, type: string) =>
    api.post(`/group-chat/messages/${msgId}/reactions`, { type }),

  markRead: (convId: string, messageIds: string[]) =>
    api.post(`/group-chat/conversations/${convId}/read`, { messageIds }),

  // ── Search & Counts ────────────────────────────────────────────────────────
  searchMessages: (convId: string, q: string, limit = 20) =>
    api.get(`/group-chat/conversations/${convId}/search`, { params: { q, limit } }),

  unreadCount: () => api.get('/group-chat/unread-count'),
}
