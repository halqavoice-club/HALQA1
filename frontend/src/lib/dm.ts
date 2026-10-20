import api from './api'

// Message types supported by the DM system
export type DmMsgType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'GIF' | 'VOICE' | 'AUDIO' | 'FILE' | 'VOICE_ROOM_SHARE'

export interface SendMessagePayload {
  body?: string | null
  replyToId?: string
  msgType?: DmMsgType
  mediaUrl?: string
  mimeType?: string
  fileSize?: number
  fileName?: string
  duration?: number   // seconds (audio/video/voice)
  width?: number      // px
  height?: number     // px
  thumbnail?: string  // URL
  // Phase 5: structured entity reference (VOICE_ROOM_SHARE)
  refEntityType?: string
  refEntityId?: string
}

export const dmApi = {
  conversations:  ()                               => api.get('/dm/conversations'),
  startWith:      (userId: string)                 => api.get(`/dm/conversations/${userId}/with`),
  messages:       (convId: string, before?: string, limit = 30) =>
    api.get(`/dm/conversations/${convId}/messages`, {
      params: { limit, ...(before ? { before } : {}) }
    }),

  /** Send any message type: text, image, video, GIF, voice, audio, file */
  send: (convId: string, payload: SendMessagePayload) =>
    api.post(`/dm/conversations/${convId}/messages`, payload),

  editMessage:    (msgId: string, body: string)    => api.patch(`/dm/messages/${msgId}`, { body }),
  deleteMessage:  (msgId: string)                  => api.delete(`/dm/messages/${msgId}`),
  markRead:       (convId: string)                 => api.patch(`/dm/conversations/${convId}/read`),
  reactMessage:   (msgId: string, emoji: string)   => api.post(`/dm/messages/${msgId}/reactions`, { emoji }),
  searchMessages: (convId: string, q: string)      => api.get(`/dm/conversations/${convId}/search`, { params: { q } }),
  unreadCount:    ()                               => api.get('/dm/unread-count'),
}
