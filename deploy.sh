#!/bin/bash
# ─── Halqa Deploy Script ──────────────────────────────────────────────────────
# Run on your Ubuntu server after cloning the repo.
# Usage: bash deploy.sh
set -e

echo "🚀 Halqa Deployment"
echo "==================="

# ── 1. Check .env exists ──────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "❌ .env file not found."
  echo "   Copy .env.production to .env and fill in all values:"
  echo "   cp .env.production .env && nano .env"
  exit 1
fi

# ── 2. Check SSL certs ────────────────────────────────────────────────────────
if [ ! -f "nginx/ssl/fullchain.pem" ] || [ ! -f "nginx/ssl/privkey.pem" ]; then
  echo "⚠️  SSL certificates not found in nginx/ssl/"
  echo "   Option A — Let's Encrypt (recommended):"
  echo "     sudo apt install certbot"
  echo "     sudo certbot certonly --standalone -d yourdomain.com"
  echo "     sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/"
  echo "     sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/"
  echo ""
  echo "   Option B — Skip HTTPS for now (dev/staging only):"
  echo "     Edit nginx/nginx.conf — remove the HTTPS server block"
  echo "     and change port 80 to proxy directly without redirect."
  echo ""
  read -p "Continue without SSL? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    exit 1
  fi
fi

# ── 3. Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "📥 Pulling latest code..."
git pull origin main

# ── 4. Build and start containers ─────────────────────────────────────────────
echo ""
echo "🐳 Building Docker images..."
docker compose build --no-cache

echo ""
echo "▶️  Starting services..."
docker compose up -d

# ── 5. Wait for backend to be healthy ─────────────────────────────────────────
echo ""
echo "⏳ Waiting for backend to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:5000/health > /dev/null 2>&1; then
    echo "✅ Backend is healthy"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Backend did not start in time. Check logs:"
    echo "   docker compose logs backend"
    exit 1
  fi
  sleep 2
done

# ── 6. Seed gifts and coin packages (first deploy only) ───────────────────────
echo ""
read -p "🌱 Run seed data? (first deploy only — skip if already seeded) (y/N): " seed
if [ "$seed" = "y" ] || [ "$seed" = "Y" ]; then
  echo "Seeding base data..."
  docker compose exec backend node src/prisma/seed.js
  echo "Seeding gifts..."
  docker compose exec backend node src/prisma/seed-gifts.js
  echo "✅ Seed complete"
fi

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "✅ Deployment complete!"
echo ""
echo "Services running:"
docker compose ps
echo ""
echo "Useful commands:"
echo "  View logs:        docker compose logs -f"
echo "  Backend logs:     docker compose logs -f backend"
echo "  Restart backend:  docker compose restart backend"
echo "  Stop all:         docker compose down"
echo "  Update & redeploy: bash deploy.sh"
