# Practice Quiz — Implementation Tasks

## Overview

New domain: practice quizzes scoped to a class, with real-time teacher dashboard.
All additions are purely additive — no existing tables, migrations, or API contracts are modified.

**New files:**
- `backend/prisma/migrations/20260905_add_practice_quiz/migration.sql`
- `backend/src/controllers/quiz.controller.js`
- `backend/src/services/quiz.service.js`
- `backend/src/routes/quiz.routes.js`
- `backend/src/middleware/validators/quiz.validator.js`
- `backend/prisma/schema.prisma` — additive: 5 new models + back-relations on Class, Teacher, Student
- `frontend/src/components/quiz/` — 5 new components
- `frontend/src/store/quiz.store.ts`
- `frontend/src/app/(dashboard)/quizzes/` — 6 new pages
- `mobile/app/(tabs)/quizzes.tsx`
- `mobile/app/quiz/[id].tsx`
- `mobile/app/quiz/[id]-result.tsx`

---

## Tasks

- [ ] 1. Database migration — add quiz tables
  - Create `backend/prisma/migrations/20260905_add_practice_quiz/migration.sql`
  - Creates tables in order: `quizzes`, `quiz_questions`, `quiz_options`, `quiz_attempts`, `quiz_answers`
  - All FK constraints use `ON DELETE CASCADE`
  - No existing tables altered
  - Add 5 new Prisma models to `backend/prisma/schema.prisma`: `Quiz`, `QuizQuestion`, `QuizOption`, `QuizAttempt`, `QuizAnswer`
  - Add additive back-relations to `Class`, `Teacher`, `Student` (no new columns on those tables)
  - Run `npx prisma generate` after schema update
  - **Files:** `backend/prisma/migrations/20260905_add_practice_quiz/migration.sql`, `backend/prisma/schema.prisma`

- [ ] 2. Quiz service — core business logic
  - Create `backend/src/services/quiz.service.js`
  - `autoScore(attemptId)` — scores MC questions, sets `QuizAttempt.score` as percentage
  - `closeQuiz(quizId)` — sets status to CLOSED, triggers auto-score for all SUBMITTED attempts
  - `scheduleAutoClose(quizId, closeAt)` — setTimeout stored in module-level Map (same pattern as live-class auto-end)
  - `cancelAutoClose(quizId)` — clears existing timer
  - `recordGrades(quizId, teacherUserId)` — upserts a `Grade` record for each SUBMITTED attempt
  - **Files:** `backend/src/services/quiz.service.js`

- [ ] 3. Quiz validator — input validation middleware
  - Create `backend/src/middleware/validators/quiz.validator.js`
  - `createQuizSchema`: title (required, max 200), classId (UUID), timeLimitMin (1–180, optional), openAt/closeAt (ISO date, optional)
  - `addQuestionSchema`: prompt (required), questionType (MULTIPLE_CHOICE | SHORT_ANSWER), options array (min 2 for MC, exactly 1 isCorrect), modelAnswer (optional for SA)
  - `submitAnswersSchema`: array of `{ questionId (UUID), selectedOptionId (UUID, nullable), answerText (string, nullable) }`
  - All UUID fields validated with UUID v4 format check
  - **Files:** `backend/src/middleware/validators/quiz.validator.js`

- [ ] 4. Quiz controller — teacher endpoints
  - Create `backend/src/controllers/quiz.controller.js`
  - Implement: `createQuiz`, `listQuizzes`, `getQuiz`, `updateQuiz`, `deleteQuiz`
  - Implement: `addQuestion`, `updateQuestion`, `deleteQuestion`
  - Implement: `publishQuiz` (validates ≥1 question, sets OPEN, notifies enrolled students via existing notification helper using type `'ANNOUNCEMENT'`)
  - Implement: `closeQuiz` (sets CLOSED, calls `quiz.service.closeQuiz`)
  - Implement: `reopenQuiz` (sets OPEN from CLOSED, creator only)
  - All writes scope to `schoolId` from auth token; verify active `TeacherClass` record before write
  - School isolation: every `prisma.quiz.findFirst` includes `schoolId` filter
  - **Files:** `backend/src/controllers/quiz.controller.js`

- [ ] 5. Quiz controller — results and grade endpoints
  - `getResults(quizId)` — returns all attempts with student name, score, submittedAt, timeTaken
  - `exportResults(quizId)` — same shape as getResults, formatted for client-side CSV
  - `recordGrades(quizId)` — delegates to `quiz.service.recordGrades`
  - `updateFeedback(attemptId, feedback)` — updates `QuizAttempt.feedback`; teacher/SCHOOL_ADMIN only
  - SCHOOL_ADMIN can call all result endpoints for any quiz in their school
  - **Files:** `backend/src/controllers/quiz.controller.js`

- [ ] 6. Quiz controller — student endpoints
  - `listMyQuizzes(classId)` — returns OPEN quizzes for the student's active enrollment in classId
  - `getQuizForTaking(quizId)` — returns questions + options with `isCorrect` stripped
  - `startAttempt(quizId)` — creates `QuizAttempt` (IN_PROGRESS); rejects if SUBMITTED attempt exists; rejects if quiz not OPEN
  - `submitAttempt(quizId, answers)` — validates time limit not exceeded; saves `QuizAnswer` records; sets SUBMITTED; triggers `autoScore`; emits `quiz:submission` socket event
  - `getMyResult(quizId)` — returns the student's own attempt score + answer feedback; 403 for other students
  - **Files:** `backend/src/controllers/quiz.controller.js`

- [ ] 7. Quiz routes — mount all endpoints
  - Create `backend/src/routes/quiz.routes.js`
  - Mount at `/api/v1/quizzes` in `backend/src/app.js`
  - Apply `requireSchoolMember()` to all routes
  - Apply `requireTeacherClass` guard (or inline check) to all teacher write routes
  - Apply validators from task 3
  - **Files:** `backend/src/routes/quiz.routes.js`, `backend/src/app.js`

- [ ] 8. Socket.IO — real-time quiz channel
  - In `backend/src/sockets/index.js` (or `backend/src/app.js`), add handlers:
    - `quiz:watch { quizId }` — validate teacher owns quiz, `socket.join('quiz:' + quizId)`; emit `quiz:snapshot` with current submission state
    - `quiz:unwatch { quizId }` — `socket.leave('quiz:' + quizId)`
  - `quiz:submission` emit happens inside `submitAttempt` controller: `io.to('quiz:' + quizId).emit('quiz:submission', { ... })`
  - **Files:** `backend/src/sockets/index.js` (or `backend/src/app.js`)

- [ ] 9. Frontend — Zustand store + API helpers
  - Create `frontend/src/store/quiz.store.ts`
    - State: `activeAttempt`, `answers` (Record<questionId, answer>), `timeRemaining`
    - Actions: `setAnswer`, `clearAttempt`, `setTimeRemaining`
  - Create `frontend/src/lib/quiz.ts` — typed axios wrappers for all quiz API endpoints
  - **Files:** `frontend/src/store/quiz.store.ts`, `frontend/src/lib/quiz.ts`

- [ ] 10. Frontend — shared quiz components
  - `QuizCard.tsx` — card showing quiz title, status badge, question count, time limit
  - `QuizBuilder.tsx` — teacher form for adding/editing questions and options; drag-to-reorder positions
  - `QuizResultsDashboard.tsx` — live results panel: submitted count / total, student rows with score; uses `useQuizDashboard` hook (Socket.IO + initial REST fetch)
  - `StudentQuizView.tsx` — question stepper with countdown timer; answers saved to quiz store on change
  - `QuizResultCard.tsx` — student's own score + per-question correct/incorrect display
  - All components use shadcn/ui primitives; follow existing Tailwind class patterns in the codebase
  - **Files:** `frontend/src/components/quiz/*.tsx`

- [ ] 11. Frontend — teacher pages
  - `/quizzes` (`app/(dashboard)/quizzes/page.tsx`) — list quizzes filterable by class; links to create + dashboard
  - `/quizzes/new` — create form using `QuizBuilder`; redirects to `/quizzes/[id]/edit` after save
  - `/quizzes/[id]/edit` — edit title/settings + manage questions via `QuizBuilder`; publish/close/reopen actions
  - `/quizzes/[id]` — `QuizResultsDashboard`; export CSV button; "Record as Grades" button
  - Wrap any `useSearchParams` usage in `<Suspense>` (Next.js 14 requirement per steering rules)
  - **Files:** `frontend/src/app/(dashboard)/quizzes/`

- [ ] 12. Frontend — student pages
  - `/quizzes/[id]/take` — `StudentQuizView`; submit triggers `POST /start` then `POST /submit`; redirects to result on success
  - `/quizzes/[id]/result` — `QuizResultCard` showing student's score and per-answer feedback
  - Students access open quizzes from their class dashboard (add "Quizzes" card to existing class view if present, otherwise link from the dashboard sidebar)
  - **Files:** `frontend/src/app/(dashboard)/quizzes/[id]/take/page.tsx`, `frontend/src/app/(dashboard)/quizzes/[id]/result/page.tsx`

- [ ] 13. Mobile — student quiz screens
  - `mobile/app/(tabs)/quizzes.tsx` — tab screen listing OPEN quizzes for the student's enrolled classes; uses `GET /api/v1/quizzes/my`
  - `mobile/app/quiz/[id].tsx` — take quiz screen; saves answers to `expo-secure-store` on each change for offline resilience; countdown timer via `useTimer` hook; submits via `POST /submit`; if offline at submit, queues via existing `Offline_Manager`
  - `mobile/app/quiz/[id]-result.tsx` — result screen matching `QuizResultCard` logic
  - Use `@/` alias (not `@/src/`) for all imports per steering rules
  - **Files:** `mobile/app/(tabs)/quizzes.tsx`, `mobile/app/quiz/[id].tsx`, `mobile/app/quiz/[id]-result.tsx`

- [ ] 14. Add "Quizzes" to frontend sidebar navigation
  - Add entry to `frontend/src/components/layout/sidebar.tsx` under the academic section
  - Visible to TEACHER, STUDENT, SCHOOL_ADMIN roles
  - Use composite key `href__label` pattern (matches existing duplicate-key fix in codebase)
  - **Files:** `frontend/src/components/layout/sidebar.tsx`
