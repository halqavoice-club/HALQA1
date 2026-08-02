import api from './api'

export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'GRADED' | 'REJECTED' | 'LATE'

export const assignmentApi = {
  // Student
  mySubmissions: (studentId: string, params?: { status?: string; gradeId?: string }) =>
    api.get(`/assignments/students/${studentId}/submissions`, { params }),
  getSubmission:    (id: string)  => api.get(`/assignments/submissions/${id}`),
  create: (data: {
    classId: string; gradeId?: string; studentId?: string; teacherId?: string
    title: string; description?: string; textContent?: string; attachments?: string[]
  }) => api.post('/assignments/submissions', data),
  update: (id: string, data: { title?: string; description?: string; textContent?: string; attachments?: string[] }) =>
    api.put(`/assignments/submissions/${id}`, data),
  submit:  (id: string, data?: { textContent?: string; attachments?: string[] }) =>
    api.post(`/assignments/submissions/${id}/submit`, data ?? {}),
  delete:  (id: string) => api.delete(`/assignments/submissions/${id}`),

  // Teacher
  classSubmissions: (gradeId: string, params?: { status?: string }) =>
    api.get(`/assignments/grades/${gradeId}/submissions`, { params }),
  grade: (id: string, data: { score: number; maxScore: number; feedback?: string }) =>
    api.post(`/assignments/submissions/${id}/grade`, data),
}

export const examApi = {
  // Student
  mySubmissions: (studentId: string, params?: { status?: string; gradeId?: string }) =>
    api.get(`/exams/students/${studentId}/submissions`, { params }),
  getSubmission:    (id: string)  => api.get(`/exams/submissions/${id}`),
  create: (data: {
    classId: string; gradeId?: string; studentId?: string; teacherId?: string
    title: string; answers?: Record<string, string>; attachments?: string[]
  }) => api.post('/exams/submissions', data),
  update: (id: string, data: { title?: string; answers?: Record<string, string>; attachments?: string[] }) =>
    api.put(`/exams/submissions/${id}`, data),
  submit:  (id: string, data?: { answers?: Record<string, string>; attachments?: string[] }) =>
    api.post(`/exams/submissions/${id}/submit`, data ?? {}),
  delete:  (id: string) => api.delete(`/exams/submissions/${id}`),

  // Teacher
  classSubmissions: (gradeId: string, params?: { status?: string }) =>
    api.get(`/exams/grades/${gradeId}/submissions`, { params }),
  grade: (id: string, data: { score: number; maxScore: number; feedback?: string }) =>
    api.post(`/exams/submissions/${id}/grade`, data),
  autoGrade: (id: string, data: { correctAnswers: Record<string, string>; maxScore: number }) =>
    api.post(`/exams/submissions/${id}/auto-grade`, data),
}
