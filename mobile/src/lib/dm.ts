/**
 * HALQA Mobile — DM API helpers (Phase 4: full media support)
 */
import api from './api';

export type DmMsgType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'GIF' | 'VOICE' | 'AUDIO' | 'FILE';

export interface SendMessagePayload {
  body?: string;
  replyToId?: string;
  msgType?: DmMsgType;
  mediaUrl?: string;
  mimeType?: string;
  fileSize?: number;
  fileName?: string;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export const dmApi = {
  conversations:  () => api.get('/dm/conversations'),
  startWith:      (otherUserId: string) => api.get(`/dm/conversations/${otherUserId}/with`),
  messages:       (convId: string, before?: string, limit = 30) =>
    api.get(`/dm/conversations/${convId}/messages`, {
      params: { limit, ...(before ? { before } : {}) },
    }),
  /** Send any message type */
  send:           (convId: string, payload: SendMessagePayload) =>
    api.post(`/dm/conversations/${convId}/messages`, payload),
  editMessage:    (msgId: string, body: string) => api.patch(`/dm/messages/${msgId}`, { body }),
  deleteMessage:  (msgId: string) => api.delete(`/dm/messages/${msgId}`),
  markRead:       (convId: string) => api.patch(`/dm/conversations/${convId}/read`),
  reactMessage:   (msgId: string, emoji: string) =>
    api.post(`/dm/messages/${msgId}/reactions`, { emoji }),
  searchMessages: (convId: string, q: string, limit = 20) =>
    api.get(`/dm/conversations/${convId}/search`, { params: { q, limit } }),
  unreadCount:    () => api.get('/dm/unread-count'),
};
