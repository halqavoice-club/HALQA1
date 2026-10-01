# Practice Quiz — Technical Design

## Overview

The Practice Quiz feature adds a new `quiz` domain to the Halqa backend, a Teacher Dashboard web page, a Student Quiz View on web and mobile, and a real-time Socket.IO channel for live results. All additions are purely additive — no existing tables, API contracts, or migrations are modified.

---

## Database Schema

Four new tables added via a single migration (`20260905_add_practice_quiz`).

```prisma
// status: DRAFT | OPEN | CLOSED
model Quiz {
  id           String    @id @default(uuid())
  schoolId     String
  school       School    @relation(fields: [schoolId], references: [id])
  classId      String
  class        Class     @relation(fields: [classId], references: [id])
  teacherId    String    // Teacher.id (not User.id)
  teacher      Teacher   @relation(fields: [teacherId], references: [id])
  title        String    @db.VarChar(200)
  description  String?   @db.Text
  status       String    @default("DRAFT") // DRAFT | OPEN | CLOSED
  timeLimitMin Int?      // optional time limit 1–180 minutes
  openAt       DateTime? // scheduled open time
  closeAt      DateTime? // scheduled close time
  deletedAt    DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  questions    QuizQuestion[]
  attempts     QuizAttempt[]

  @@index([schoolId])
  @@index([classId])
  @@index([teacherId])
  @@index([classId, status])  // student quiz list
  @@map("quizzes")
}

// questionType: MULTIPLE_CHOICE | SHORT_ANSWER
model QuizQuestion {
  id            String   @id @default(uuid())
  quizId        String
  quiz          Quiz     @relation(fields: [quizId], references: [id], onDelete: Cascade)
  position      Int      // 1-based ordering
  questionType  String   // MULTIPLE_CHOICE | SHORT_ANSWER
  prompt        String   @db.Text
  modelAnswer   String?  @db.Text  // short-answer reference only
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  options       QuizOption[]
  answers       QuizAnswer[]

  @@index([quizId])
  @@index([quizId, position])
  @@map("quiz_questions")
}

model QuizOption {
  id         String       @id @default(uuid())
  questionId String
  question   QuizQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)
  text       String       @db.VarChar(500)
  isCorrect  Boolean      @default(false)
  position   Int          // 1-based ordering

  @@index([questionId])
  @@map("quiz_options")
}

// status: IN_PROGRESS | SUBMITTED | TIMED_OUT
model QuizAttempt {
  id          String    @id @default(uuid())
  quizId      String
  quiz        Quiz      @relation(fields: [quizId], references: [id], onDelete: Cascade)
  studentId   String    // Student.id (not User.id)
  student     Student   @relation(fields: [studentId], references: [id])
  userId      String    // User.id — for quick auth lookup
  status      String    @default("IN_PROGRESS") // IN_PROGRESS | SUBMITTED | TIMED_OUT
  score       Float?    // percentage 0–100, null until auto-scored
  feedback    String?   @db.Text  // teacher feedback per attempt
  startedAt   DateTime  @default(now())
  submittedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  answers     QuizAnswer[]

  @@unique([quizId, studentId])  // one attempt per student per quiz
  @@index([quizId])
  @@index([studentId])
  @@index([quizId, status])     // teacher dashboard count
  @@map("quiz_attempts")
}

model QuizAnswer {
  id         String       @id @default(uuid())
  attemptId  String
  attempt    QuizAttempt  @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  questionId String
  question   QuizQuestion @relation(fields: [questionId], references: [id])
  selectedOptionId String? // null for short-answer
  answerText String?      @db.Text  // short-answer response
  isCorrect  Boolean?     // null until scored

  @@unique([attemptId, questionId])
  @@index([attemptId])
  @@map("quiz_answers")
}
```

The `Class`, `Teacher`, `Student`, and `Grade` models each gain a new relation (additive back-references only — no column additions to existing tables).

---

## Backend

### File Structure

```
backend/src/
├── controllers/quiz.controller.js      Main quiz CRUD + attempt logic
├── routes/quiz.routes.js               Express router mounted at /api/v1/quizzes
├── middleware/validators/
│   └── quiz.validator.js               express-validator schemas
└── services/
    └── quiz.service.js                 Auto-scoring, grade-record creation
```

### API Endpoints

All routes require a valid JWT. Teacher-only and student-only restrictions are enforced per route.

#### Quiz Management (Teacher / SCHOOL_ADMIN)
```
POST   /api/v1/quizzes                  Create quiz (DRAFT)
GET    /api/v1/quizzes?classId=         List quizzes for a class
GET    /api/v1/quizzes/:id              Get quiz with questions
PATCH  /api/v1/quizzes/:id              Update quiz (title, status, timeLimitMin, etc.)
DELETE /api/v1/quizzes/:id              Delete quiz (cascade)
POST   /api/v1/quizzes/:id/questions    Add question (with options)
PATCH  /api/v1/quizzes/:id/questions/:qid  Update question
DELETE /api/v1/quizzes/:id/questions/:qid  Delete question
PATCH  /api/v1/quizzes/:id/publish      Set status → OPEN (validates ≥1 question)
PATCH  /api/v1/quizzes/:id/close        Set status → CLOSED
PATCH  /api/v1/quizzes/:id/reopen       Set status → OPEN (from CLOSED)
```

#### Results (Teacher / SCHOOL_ADMIN)
```
GET    /api/v1/quizzes/:id/results      Full results with per-student attempts
GET    /api/v1/quizzes/:id/results/export  Structured JSON for CSV export
POST   /api/v1/quizzes/:id/record-grades  Create/update Grade records
PATCH  /api/v1/quizzes/:id/attempts/:aid  Update feedback on an attempt
```

#### Student Endpoints
```
GET    /api/v1/quizzes/my?classId=      List OPEN quizzes for the student's class
GET    /api/v1/quizzes/:id/take         Get quiz for taking (questions, no correct flags)
POST   /api/v1/quizzes/:id/start        Create a new Attempt (IN_PROGRESS)
POST   /api/v1/quizzes/:id/submit       Submit answers → SUBMITTED + auto-score
GET    /api/v1/quizzes/:id/my-result    Student's own result after submission
```

### Authorization Guards

- `requireSchoolMember()` — all routes
- `requireTeacherClass(classId)` — all teacher write routes (verifies active `TeacherClass` record)
- School isolation: every query filters by `schoolId` derived from the auth token
- Student isolation: `GET /my-result` only returns the requesting student's own attempt

### Auto-Scoring Logic (`quiz.service.js`)

```
autoScore(attemptId):
  1. Load all QuizAnswers for the attempt with their QuizQuestion type
  2. For MULTIPLE_CHOICE questions: mark isCorrect = (selectedOptionId === question's correct option)
  3. For SHORT_ANSWER questions: isCorrect = null (teacher review only)
  4. score = (count of MULTIPLE_CHOICE correct / count of MULTIPLE_CHOICE questions) × 100
     - If no MULTIPLE_CHOICE questions: score = null
  5. Update QuizAttempt.score + all QuizAnswer.isCorrect in one transaction
```

### Scheduled Close (`quiz.service.js`)

When a quiz is published with a `closeAt` value, `quiz.service.js` schedules a `setTimeout` (same pattern as the live class auto-end timer in `live-class.controller.js`) to call `closeQuiz(quizId)` at the configured time. The timer is stored in a module-level Map keyed by `quizId` and cancelled if the quiz is manually closed or deleted first.

### Socket.IO Events

Channel: `quiz:{quizId}` — teacher joins on dashboard open, leaves on close.

```
# Server → Client (teacher channel)
quiz:submission   { quizId, studentId, firstName, lastName, submittedAt, score }
quiz:snapshot     { quizId, submitted: [...], pending: [...], total: number }
```

No new Socket.IO namespaces — events are emitted on the existing `io` instance in `backend/src/app.js`. The teacher joins the room via a new socket event:

```
# Client → Server
quiz:watch   { quizId }   // teacher only; server validates ownership
quiz:unwatch { quizId }
```

### Grade Recording (`quiz.service.js → recordGrades`)

```
recordGrades(quizId, teacherUserId):
  For each SUBMITTED attempt:
    upsert Grade where (studentId, classId, title = "Quiz: <quizTitle>", type = "QUIZ")
    set score = attempt.score, maxScore = 100, gradedAt = now()
```

Uses Prisma `upsert` to satisfy requirement 5.4 (no duplicates).

---

## Frontend (Web)

### New Pages

| Route | File | Who |
|---|---|---|
| `/quizzes` | `app/(dashboard)/quizzes/page.tsx` | Teacher list |
| `/quizzes/new` | `app/(dashboard)/quizzes/new/page.tsx` | Teacher create |
| `/quizzes/[id]` | `app/(dashboard)/quizzes/[id]/page.tsx` | Teacher dashboard (live results) |
| `/quizzes/[id]/edit` | `app/(dashboard)/quizzes/[id]/edit/page.tsx` | Teacher edit |
| `/quizzes/[id]/take` | `app/(dashboard)/quizzes/[id]/take/page.tsx` | Student quiz view |
| `/quizzes/[id]/result` | `app/(dashboard)/quizzes/[id]/result/page.tsx` | Student result view |

### New Components

```
frontend/src/components/quiz/
├── QuizBuilder.tsx          Question/option CRUD form (teacher)
├── QuizCard.tsx             Card for list views
├── QuizResultsDashboard.tsx  Live results panel with Socket.IO
├── StudentQuizView.tsx       Question stepper with timer
└── QuizResultCard.tsx        Student's own result display
```

### State Management

A lightweight `quiz.store.ts` in `frontend/src/store/` using Zustand:
- `activeAttempt` — current IN_PROGRESS attempt (survives tab navigation)
- `answers` — draft answers keyed by questionId
- `timeRemaining` — countdown in seconds (derived from attempt start + timeLimitMin)

TanStack React Query handles server state (quiz data, results list).

### Real-Time (Teacher Dashboard)

`useQuizDashboard(quizId)` hook:
- Fetches initial snapshot via `GET /api/v1/quizzes/:id/results`
- Joins `quiz:{quizId}` socket channel
- Listens to `quiz:submission` events and appends to local state
- Cleans up on unmount (emits `quiz:unwatch`)

---

## Mobile

### New Screens

```
mobile/app/(tabs)/quizzes.tsx            Tab: list of open quizzes for student
mobile/app/quiz/[id].tsx                 Take quiz screen
mobile/app/quiz/[id]-result.tsx          Result screen
```

### Offline Handling

Student answers are persisted to `expo-secure-store` (keyed by attemptId) on each answer change. On submit, the payload is read from secure store and POSTed. If offline at submit time, the mutation is queued via the existing `Offline_Manager` pattern from `mobile/src/lib/offline.ts`.

---

## Migration File

`backend/prisma/migrations/20260905_add_practice_quiz/migration.sql`

Creates tables in order: `quizzes` → `quiz_questions` → `quiz_options` → `quiz_attempts` → `quiz_answers`. All foreign key constraints include `ON DELETE CASCADE`. No existing tables are altered.

---

## Notification

When a quiz is published (`PATCH /publish`), the backend calls the existing notification utility to create a `QUIZ_OPEN` notification for each enrolled student (adding `QUIZ_OPEN` as a new value to the `NotificationType` enum via migration, or using `ANNOUNCEMENT` as a safe fallback to avoid enum migration complexity — prefer the fallback until the enum migration is confirmed safe for the deployment pipeline).

> Use `type: 'ANNOUNCEMENT'` for the notification until a dedicated `QUIZ_OPEN` enum value is added. This avoids altering the MySQL enum in production and keeps the migration atomic.
