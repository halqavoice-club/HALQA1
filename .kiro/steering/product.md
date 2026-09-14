# Product: Halqa Management System

**Halqa** is a full-stack Islamic school management platform with an integrated social and live media layer. It is used by school admins, teachers, students, and guardians across multiple schools (multi-tenant via a SUPER_ADMIN platform tier).

## Core Domains

### School Management (ERP)
Student, teacher, guardian, and class CRUD. Attendance (QR, bulk, calendar), grades, behavior points, assignments, exams, fee management, library, timetables, audit logs, and PDF/Excel export.

### Voice Club (Live Audio Rooms)
TikTok Live-style audio rooms with host/moderator/speaker/audience roles, FIFO speaker queue, open-mic mode, mic-pass, real-time chat, emoji reactions, and persistent rooms. Backed by LiveKit (WebRTC).

### Virtual Gift Economy
17 gifts (common → ultimate rarity), combo animations, send-to-all, diamond earnings for hosts. Coin packages sold via Stripe. Platform takes 50% cut; 1 coin → 0.5 diamonds. Daily spend cap configurable via `GIFT_DAILY_CAP`.

### Live Classes
Interactive video sessions for school use. Separate from Voice Club — different roles, authorization rules, and participation model.

### Social Platform
Feed (posts, stories, reels), communities, DMs, group chat, leaderboard, creator tiers/subscriptions, explore/hashtags.

## User Roles
- **SUPER_ADMIN** — platform admin only. Cannot access individual school operational data unless explicitly given a `SchoolMembership` record.
- **SCHOOL_ADMIN** — manages one school's data.
- **TEACHER** — manages classes and students within their school.
- **STUDENT** — enrolled in one school.
- **GUARDIAN** — linked to one or more students.

## Islamic-Specific Features
Prayer times (Aladhan API), Hijri date display, audio lessons by Quran course/category, and Islamic-oriented school naming and branding.
