FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Ensure upload and log directories exist
RUN mkdir -p uploads/avatars uploads/audio uploads/logos logs

# Create a non-root user and give it ownership of the app directory
# Running as root inside a container is a security risk — if the container
# is compromised, the attacker has root access to the host via volume mounts.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 5000

# Run migrations then start server
# prisma migrate deploy is idempotent — safe to run on every restart
CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]
