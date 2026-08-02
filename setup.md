# Halqa Management System — Setup Guide

## Prerequisites
- Node.js 18+
- MySQL 8+ running locally or cloud
- Redis (optional — system works without it)

---

## Step 1: Backend Setup

```bash
cd backend

# 1. Install dependencies
npm install

# 2. Configure environment (already created with defaults)
# Edit .env — update DATABASE_URL with your MySQL credentials

# 3. Generate Prisma client
npx prisma generate

# 4. Run database migrations
npx prisma migrate dev --name init

# 5. Seed demo data
node src/prisma/seed.js

# 6. Start development server
npm run dev
# API runs at http://localhost:5000
# Swagger docs at http://localhost:5000/api-docs
```

---

## Step 2: Frontend Setup

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Start development server
npm run dev
# App runs at http://localhost:3000
```

---

## Step 3: Login

Open http://localhost:3000/login

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@halqa.com | Admin@2024 |
| School Admin | admin@halqa-academy.com | Admin@2024 |
| Teacher | teacher@halqa-academy.com | Teacher@2024 |
| Student | student1@halqa.com | Student@2024 |
| Guardian | parent@halqa.com | Guardian@2024 |

---

## Docker (All-in-one)

```bash
# Start everything with Docker Compose
docker-compose up -d

# Run migrations inside container
docker exec halqa-backend npx prisma migrate deploy
docker exec halqa-backend node src/prisma/seed.js
```

---

## Environment Variables (Backend)

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | MySQL connection string | ✅ |
| JWT_SECRET | JWT signing secret (32+ chars) | ✅ |
| JWT_REFRESH_SECRET | Refresh token secret | ✅ |
| REDIS_URL | Redis connection (optional) | ❌ |
| SMTP_HOST | Email server host | ❌ |
| SMTP_USER | Email username | ❌ |
| SMTP_PASS | Email password | ❌ |
| CLIENT_URL | Frontend URL for CORS | ✅ |

---

## API Endpoints Summary

### Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET  /api/v1/auth/me`

### Core Modules
- `/api/v1/students` — CRUD
- `/api/v1/teachers` — CRUD
- `/api/v1/guardians` — CRUD
- `/api/v1/classes` — CRUD
- `/api/v1/attendance` — Mark, bulk, QR, analytics
- `/api/v1/behavior` — Log, history, summary
- `/api/v1/grades` — Create, bulk, export
- `/api/v1/messages` — Send, inbox, real-time
- `/api/v1/notifications` — List, mark read
- `/api/v1/calendar` — Events CRUD
- `/api/v1/reports` — Attendance/grades/behavior + Excel export
- `/api/v1/dashboard` — Role-specific dashboards
- `/api/v1/audit` — Audit logs (admin only)
