# HALQA — Restore Guide

Complete instructions for restoring HALQA on a new machine or after disaster recovery.

---

## Prerequisites (Install First)

| Software | Version | Download |
|---|---|---|
| Git for Windows | 2.x | https://git-scm.com/download/win |
| Node.js | 20.x LTS | https://nodejs.org |
| XAMPP (MySQL) | 8.x | https://apachefriends.org |
| Redis | 7.x | https://redis.io/download (or Docker) |
| Docker Desktop | Latest | https://docker.com/products/docker-desktop (optional) |

---

## Step 1 — Clone the Repository

```powershell
# Create project folder
mkdir "C:\Users\Public\class management"
cd "C:\Users\Public\class management"

# Clone (HTTPS — enter GitHub credentials when prompted)
git clone https://github.com/YOUR-USERNAME/halqa.git "nurul yaqin class ms"

# Or SSH (if SSH key is configured)
git clone git@github.com:YOUR-USERNAME/halqa.git "nurul yaqin class ms"

cd "nurul yaqin class ms"
```

---

## Step 2 — Restore Environment Files

**Never commit `.env` files — restore them from your secure backup.**

```powershell
# Backend
copy C:\path\to\backup\backend.env backend\.env

# Frontend
copy C:\path\to\backup\frontend.env.local frontend\.env.local

# Mobile
copy C:\path\to\backup\mobile.env mobile\.env
```

Alternatively, copy `.env.example` files and fill in values:

```powershell
copy backend\.env.example backend\.env
# Edit backend\.env with your actual credentials:
# - DATABASE_URL
# - JWT_SECRET, JWT_REFRESH_SECRET
# - REDIS_URL
# - LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
# - STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
# - SMTP_HOST, SMTP_USER, SMTP_PASS (email)
# - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (storage)
```

---

## Step 3 — Install Node.js Dependencies

```powershell
# Backend
cd backend
npm install
cd ..

# Frontend
cd frontend
npm install
cd ..

# Mobile
cd mobile
npm install
cd ..
```

---

## Step 4 — Start MySQL (XAMPP)

1. Open XAMPP Control Panel
2. Start **MySQL** service
3. Verify running on port 3306

Or with Docker:
```powershell
docker run -d `
  --name halqa-mysql `
  -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=your_password `
  -e MYSQL_DATABASE=halqa_db `
  mysql:8.0
```

---

## Step 5 — Restore MySQL Database

From your SQL backup file:

```powershell
# XAMPP
C:\xampp\mysql\bin\mysql.exe -u root -p halqa_db < "C:\path\to\backup\halqa_db_YYYY-MM-DD.sql"

# Or MySQL in PATH
mysql -u root -p halqa_db < "C:\path\to\backup\halqa_db_YYYY-MM-DD.sql"
```

If no SQL backup is available (fresh install):

```powershell
cd backend
npm run prisma:migrate     # runs all migrations
npm run seed               # seeds initial data
```

---

## Step 6 — Run Prisma Migrations

Always run after restoring database to ensure schema is up to date:

```powershell
cd backend
npx prisma generate        # regenerates Prisma client
npx prisma migrate deploy  # applies any new migrations
```

---

## Step 7 — Start Redis

```powershell
# Docker (recommended)
docker run -d --name halqa-redis -p 6379:6379 redis:7-alpine

# Or Windows Redis (if installed)
redis-server
```

---

## Step 8 — Start the Application

Open **three separate terminals**:

**Terminal 1 — Backend:**
```powershell
cd "C:\Users\Public\class management\nurul yaqin class ms\backend"
npm run dev
# Backend runs on http://localhost:5000
```

**Terminal 2 — Frontend:**
```powershell
cd "C:\Users\Public\class management\nurul yaqin class ms\frontend"
npm run dev
# Frontend runs on http://localhost:3000
```

**Terminal 3 — Mobile (optional):**
```powershell
cd "C:\Users\Public\class management\nurul yaqin class ms\mobile"
npx expo start
# Scan QR code with Expo Go app
```

---

## Step 9 — Verify Application

```powershell
# Backend health check
curl http://localhost:5000/health

# Expected response:
# {"status":"ok","timestamp":"...","uptime":...}
```

Browser checks:
- [ ] http://localhost:3000 — frontend loads
- [ ] http://localhost:3000/login — login page works
- [ ] http://localhost:5000/api/v1/health — backend responds
- [ ] Admin dashboard accessible after login

---

## Step 10 — Restore Git Hooks

```powershell
cd "C:\Users\Public\class management\nurul yaqin class ms"
copy scripts\git-hooks\pre-commit .git\hooks\pre-commit
copy scripts\git-hooks\pre-push .git\hooks\pre-push
```

---

## Disaster Recovery Checklist

```
□ Git cloned from GitHub                    ✓ Source code
□ backend\.env restored                     ✓ Backend secrets
□ frontend\.env.local restored              ✓ Frontend config
□ mobile\.env restored                      ✓ Mobile config
□ npm install (backend + frontend + mobile) ✓ Dependencies
□ MySQL running                             ✓ Database server
□ Database restored from SQL backup         ✓ Data
□ npx prisma migrate deploy                 ✓ Schema up to date
□ Redis running                             ✓ Cache/queues
□ Backend starts (port 5000)                ✓ API
□ Frontend starts (port 3000)               ✓ Web app
□ Health check passes                       ✓ System healthy
□ Login works                               ✓ Auth functional
□ Git hooks installed                       ✓ Commit guards
```

---

## Common Issues

### "Cannot connect to database"
- Ensure MySQL is running in XAMPP
- Check `DATABASE_URL` in `backend/.env`
- Try: `C:\xampp\mysql\bin\mysql.exe -u root -e "SHOW DATABASES;"`

### "Prisma client not generated"
```powershell
cd backend && npx prisma generate
```

### "Redis connection refused"
```powershell
docker start halqa-redis
# or restart Redis service
```

### "Port 5000 already in use"
```powershell
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### "node_modules missing"
```powershell
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install
```

### "JWT errors on login"
- Check `JWT_SECRET` and `JWT_REFRESH_SECRET` in `backend/.env`
- Must be at least 32 characters each

---

*Last updated: August 2026*
