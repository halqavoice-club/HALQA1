# Product: Halqa Platform

**Halqa** is a general-purpose, multi-purpose digital platform. HALQA is a place where people connect, talk, learn, create, teach, share, build communities, participate in live experiences, and earn.

HALQA is not Islamic-only and not school-only. School Management and Education are specialized domains within the platform — not the global product identity. Islamic education, Islamic communities, and Islamic-oriented school features are supported use cases. Users do not need school membership to use HALQA's general platform capabilities (social, voice, live, messaging, communities, creator tools).

The platform is multi-tenant. School-scoped features (ERP, Live Classes, attendance, grades) are used by school admins, teachers, students, and guardians across multiple schools, governed by a SUPER_ADMIN platform tier.

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
