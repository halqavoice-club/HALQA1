import api from './api'

export const dmApi = {
  conversations:    ()           => api.get('/dm/conversations'),
  startWith:        (userId: string) => api.get(`/dm/conversations/${userId}/with`),
  messages:         (convId: string, before?: string) =>
    api.get(`/dm/conversations/${convId}/messages${before ? `?before=${before}` : ''}`),
  send:             (convId: string, body: string) =>
    api.post(`/dm/conversations/${convId}/messages`, { body }),
  markRead:         (convId: string) => api.patch(`/dm/conversations/${convId}/read`),
  deleteMessage:    (msgId: string)  => api.delete(`/dm/messages/${msgId}`),
  unreadCount:      ()           => api.get('/dm/unread-count'),
}
