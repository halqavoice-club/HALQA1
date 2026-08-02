import api from './api'

export const socialApi = {
  // Follow
  follow:      (userId: string) => api.post(`/social/follow/${userId}`),
  unfollow:    (userId: string) => api.delete(`/social/follow/${userId}`),
  followers:   (userId: string, limit = 50) => api.get(`/social/followers/${userId}?limit=${limit}`),
  following:   (userId: string, limit = 50) => api.get(`/social/following/${userId}?limit=${limit}`),
  counts:      (userId: string) => api.get(`/social/counts/${userId}`),
  search:      (q: string, limit = 20) => api.get(`/social/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  // Friends
  friends:          (search = '') => api.get(`/social/friends?search=${encodeURIComponent(search)}`),
  incomingRequests: () => api.get('/social/friends/requests'),
  sentRequests:     () => api.get('/social/friends/requests/sent'),
  sendRequest:      (userId: string) => api.post(`/social/friends/request/${userId}`),
  acceptRequest:    (userId: string) => api.post(`/social/friends/accept/${userId}`),
  rejectRequest:    (userId: string) => api.post(`/social/friends/reject/${userId}`),
  cancelRequest:    (userId: string) => api.delete(`/social/friends/request/${userId}`),
  removeFriend:     (userId: string) => api.delete(`/social/friends/${userId}`),

  // Report
  reportUser:  (userId: string, reason: string, description?: string, roomId?: string) =>
    api.post(`/social/report/${userId}`, { reason, description, roomId }),

  // Block
  blockUser:       (userId: string) => api.post(`/social/block/${userId}`),
  unblockUser:     (userId: string) => api.delete(`/social/block/${userId}`),
  blockedUsers:    () => api.get('/social/blocked'),
  blockStatus:     (userId: string) => api.get(`/social/block/${userId}/status`),
}
