# Requirements Document

## Introduction

The Practice Quiz feature allows a teacher to create a multiple-choice or short-answer quiz scoped to a specific class in the Halqa Management System. Students take the quiz through the web or mobile app, and the teacher views a real-time dashboard showing submission progress and scores as students complete the quiz. Results are persisted for later review and can optionally be recorded as a grade entry.

## Glossary

- **Quiz**: A timed or untimed set of questions created by a teacher for a specific class.
- **Question**: A single item in a quiz, consisting of a prompt and either multiple-choice options or a short-answer field.
- **Option**: One of the selectable answers in a multiple-choice question.
- **Attempt**: A student's single instance of starting and submitting a quiz.
- **Submission**: The final, locked set of answers recorded when a student completes an Attempt.
- **Auto-score**: Automatic calculation of a score for multiple-choice questions by comparing student answers against correct answers defined by the teacher.
- **Quiz_Service**: The backend service responsible for creating, managing, and scoring quizzes.
- **Realtime_Hub**: The Socket.IO layer responsible for broadcasting submission events to the teacher's dashboard.
- **Teacher_Dashboard**: The web UI page where a teacher monitors live quiz progress.
- **Student_Quiz_View**: The web and mobile UI where a student reads questions and submits answers.
- **Class**: An existing school class entity as defined in the Halqa data model, identified by a `classId`.
- **Enrollment**: An active link between a Student and a Class (isActive = true in the `enrollments` table).

---

## Requirements

### Requirement 1: Quiz Creation by Teacher

**User Story:** As a teacher, I want to create a practice quiz for one of my classes, so that I can assess student understanding outside of formal exams.

#### Acceptance Criteria

1. WHEN a teacher submits a valid quiz creation request, THE Quiz_Service SHALL create a new quiz record linked to the specified class and the requesting teacher.
2. THE Quiz_Service SHALL reject quiz creation if the requesting user does not have an active TeacherClass record linking them to the specified class.
3. THE Quiz_Service SHALL require the quiz to contain at least one question before it can be published.
4. WHEN a teacher sets a question type to multiple-choice, THE Quiz_Service SHALL require at least two options and exactly one option marked as correct.
5. WHEN a teacher sets a question type to short-answer, THE Quiz_Service SHALL store an optional model answer for manual reference.
6. THE Quiz_Service SHALL allow the teacher to specify an optional time limit in minutes (between 1 and 180) for the quiz.
7. THE Quiz_Service SHALL allow the teacher to specify an optional scheduled open time and close time for the quiz.
8. WHEN a teacher publishes a quiz, THE Quiz_Service SHALL set the quiz status to OPEN and notify all enrolled active students in the class via the existing notification system.

---

### Requirement 2: Student Quiz Access and Attempt

**User Story:** As a student, I want to take a practice quiz assigned to my class, so that I can practice and demonstrate my understanding.

#### Acceptance Criteria

1. WHEN a student requests to start a quiz, THE Quiz_Service SHALL verify the student has an active Enrollment in the quiz's class before creating an Attempt.
2. WHEN a student starts a quiz, THE Quiz_Service SHALL create exactly one Attempt record with status IN_PROGRESS and record the start time.
3. WHILE an Attempt is IN_PROGRESS and a time limit is set, THE Quiz_Service SHALL reject any answer submission received after the elapsed time exceeds the configured time limit.
4. WHEN a student submits a quiz, THE Quiz_Service SHALL set the Attempt status to SUBMITTED, record the submission time, and lock the attempt from further modification.
5. IF a student attempts to start a quiz that already has a SUBMITTED Attempt for that student, THEN THE Quiz_Service SHALL reject the request with a clear error indicating the quiz has already been completed.
6. IF a student attempts to start a quiz whose status is not OPEN, THEN THE Quiz_Service SHALL reject the request with a clear error indicating the quiz is not available.
7. WHEN a student submits a quiz containing only multiple-choice questions, THE Quiz_Service SHALL immediately calculate and store an auto-score as a percentage of correct answers.

---

### Requirement 3: Real-Time Teacher Dashboard

**User Story:** As a teacher, I want to see students' submission progress and scores in real time, so that I can monitor engagement and identify struggling students immediately.

#### Acceptance Criteria

1. WHEN a student's Attempt status changes to SUBMITTED, THE Realtime_Hub SHALL emit a `quiz:submission` event to the teacher's room channel containing the student's identity, submission time, and auto-score (if available).
2. WHEN a teacher opens the Teacher_Dashboard for a quiz, THE Quiz_Service SHALL return the current submission count, the total enrolled student count, each submitted student's name and score, and the list of students who have not yet submitted.
3. WHILE a quiz is OPEN, THE Teacher_Dashboard SHALL display a live count of submitted vs. total enrolled students, updating without a page refresh.
4. WHEN a teacher joins the quiz monitoring channel, THE Realtime_Hub SHALL send the current snapshot of all existing Submissions to the teacher.

---

### Requirement 4: Quiz Lifecycle Management

**User Story:** As a teacher, I want to control when a quiz opens and closes, so that I can manage quiz availability around class schedules.

#### Acceptance Criteria

1. WHEN a teacher closes a quiz, THE Quiz_Service SHALL set the quiz status to CLOSED and reject any new Attempts from that point.
2. IF a scheduled close time is set and that time is reached, THEN THE Quiz_Service SHALL automatically set the quiz status to CLOSED.
3. WHEN a quiz is CLOSED, THE Quiz_Service SHALL finalize auto-scores for all SUBMITTED multiple-choice Attempts that have not yet been scored.
4. THE Quiz_Service SHALL allow a teacher to reopen a CLOSED quiz by setting its status back to OPEN, provided the teacher is the creator of the quiz.
5. THE Quiz_Service SHALL allow a teacher to delete a quiz they created, which SHALL cascade-delete all associated Questions, Options, and Attempts.

---

### Requirement 5: Results and Grade Recording

**User Story:** As a teacher, I want to view quiz results and optionally record them as grades, so that practice quiz performance can contribute to the student's overall record.

#### Acceptance Criteria

1. WHEN a teacher requests quiz results, THE Quiz_Service SHALL return all Attempts for the quiz including each student's score, submission time, and time taken.
2. THE Quiz_Service SHALL allow a teacher to export quiz results for the class as a structured data set (JSON response suitable for CSV generation on the client).
3. WHERE a teacher chooses to record quiz results as grades, THE Quiz_Service SHALL create a Grade record for each SUBMITTED Attempt using the auto-score, linked to the existing class and student records.
4. IF a Grade record for the same quiz and student already exists, THEN THE Quiz_Service SHALL update the existing record rather than creating a duplicate.
5. THE Quiz_Service SHALL allow a teacher to provide written feedback on an individual student's Attempt, stored as a text field on the Attempt record.

---

### Requirement 6: Access Control and Multi-Tenancy

**User Story:** As a school administrator, I want quiz data to be strictly scoped to the relevant school and class, so that data from different schools is never mixed.

#### Acceptance Criteria

1. THE Quiz_Service SHALL scope all quiz read and write operations to the `schoolId` derived from the authenticated user's active school membership.
2. WHEN a user requests a quiz that belongs to a different school, THE Quiz_Service SHALL return a 403 error and SHALL NOT expose any quiz data.
3. THE Quiz_Service SHALL allow a SCHOOL_ADMIN to read and close any quiz within their school.
4. THE Quiz_Service SHALL allow a SCHOOL_ADMIN to delete any quiz within their school.
5. THE Quiz_Service SHALL prevent a student from reading another student's Attempt answers or score before the quiz is CLOSED.

---

### Requirement 7: Mobile Student Experience

**User Story:** As a student using the mobile app, I want to take a practice quiz on my phone with the same functionality as the web, so that I can participate from anywhere.

#### Acceptance Criteria

1. WHEN a student opens the mobile app and navigates to their class, THE Student_Quiz_View SHALL display all OPEN quizzes available for that class.
2. WHEN a student submits a quiz on mobile, THE Quiz_Service SHALL process the submission identically to a web submission, applying the same validation rules.
3. IF the mobile app loses network connectivity during an active Attempt, THEN THE Student_Quiz_View SHALL preserve the student's in-progress answers locally until connectivity is restored.
4. WHEN network connectivity is restored during an active Attempt, THE Student_Quiz_View SHALL allow the student to resume and submit the quiz provided the time limit has not expired.
