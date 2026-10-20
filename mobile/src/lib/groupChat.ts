/**
 * HALQA Mobile — Group Chat API helpers
 * Mirrors frontend/src/lib/groupChat.ts — all endpoints in sync.
 */
import api from './api';

export const groupChatApi = {
  // ── Conversations ──────────────────────────────────────────────────────────
  list: (params?: { schoolId?: string; classId?: string }) =>
    api.get('/group-chat/conversations', { params }),

  create: (data: {
    name: string;
    description?: string;
    privacy?: 'PUBLIC' | 'PRIVATE' | 'SCHOOL_ONLY' | 'CLASS_ONLY';
    avatarUrl?: string;
    maxMembers?: number;
    schoolId?: string;
    classId?: string;
  }) => api.post('/group-chat/conversations', data),

  get: (id: string) => api.get(`/group-chat/conversations/${id}`),

  // ── Members ────────────────────────────────────────────────────────────────
  addMember: (convId: string, userId: string, role?: string) =>
    api.post(`/group-chat/conversations/${convId}/members`, { userId, role }),

  removeMember: (convId: string, userId: string) =>
    api.delete(`/group-chat/conversations/${convId}/members/${userId}`),

  // ── Messages ───────────────────────────────────────────────────────────────
  messages: (convId: string, before?: string, limit = 50) =>
    api.get(`/group-chat/conversations/${convId}/messages`, {
      params: { limit, ...(before ? { before } : {}) },
    }),

  send: (convId: string, data: {
    body?: string;
    type?: string;
    mediaUrl?: string;
    mimeType?: string;
    fileSize?: number;
    replyToId?: string;
  }) => api.post(`/group-chat/conversations/${convId}/messages`, data),

  /** Edit own group message — sender only, 15-min window */
  editMessage: (messageId: string, body: string) =>
    api.patch(`/group-chat/messages/${messageId}`, { body }),

  deleteMessage: (messageId: string) =>
    api.delete(`/group-chat/messages/${messageId}`),

  pinMessage: (convId: string, messageId: string, pin = true) =>
    api.post(`/group-chat/conversations/${convId}/messages/${messageId}/pin`, { pin }),

  // ── Reactions & Read ───────────────────────────────────────────────────────
  /** Toggle emoji reaction — same emoji removes it, different emoji replaces */
  react: (msgId: string, type: string) =>
    api.post(`/group-chat/messages/${msgId}/reactions`, { type }),

  markRead: (convId: string, messageIds: string[]) =>
    api.post(`/group-chat/conversations/${convId}/read`, { messageIds }),

  // ── Search & Counts ────────────────────────────────────────────────────────
  searchMessages: (convId: string, q: string, limit = 20) =>
    api.get(`/group-chat/conversations/${convId}/search`, { params: { q, limit } }),

  unreadCount: () => api.get('/group-chat/unread-count'),
};
