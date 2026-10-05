FROM node:20 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env vars — must be ARG so they are available during `npm run build`.
# NEXT_PUBLIC_* vars are inlined by the Next.js compiler at build time; setting them
# only at runtime (via Docker -e or Compose environment:) has NO effect on the built
# bundle. They MUST be present when `next build` runs.
# Defaults here match next.config.js fallbacks so the image still builds if args are
# omitted (e.g. local `docker build` without --build-arg).
ARG NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
ARG NEXT_PUBLIC_LIVEKIT_URL=

# Expose the ARGs as env vars so Next.js compiler picks them up
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
# Disable next-pwa during Docker builds — next-pwa 5.x is incompatible with
# output: 'standalone' inside Docker (CopyPlugin path resolution fails).
ENV DISABLE_PWA=true

RUN npm run build

FROM node:20 AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create a non-root user — same security reason as backend Dockerfile
# Debian-based image uses addgroup/adduser (not BusyBox -S flag used in Alpine)
RUN groupadd appgroup && useradd -g appgroup appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000
CMD ["node", "server.js"]
