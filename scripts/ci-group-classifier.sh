#!/usr/bin/env bash
# =============================================================================
# HALQA — CI Regression Group Classifier
# =============================================================================
# Usage:
#   bash scripts/ci-group-classifier.sh [BASE_REF] [HEAD_REF]
#
# Outputs a comma-separated list of groups to run, e.g. "G1,G3" or "G1,G2,G3,G4,G5".
#
# Groups:
#   G1 — Feed / Social
#   G2 — Voice Club
#   G3 — School Live Classes
#   G4 — Authentication / Authorization
#   G5 — Shared Realtime
#
# Dependency rules (conservative — overlap selects the union):
#   Shared auth middleware / Prisma / Redis / JWT / schema → ALL
#   Sockets index                                          → G1,G2,G3,G5
#   LiveKit service                                        → G2,G3
#   Social/post/feed/story/community controllers/routes   → G1
#   Voice/PK controllers/routes                           → G2
#   Live-class/LiveKit controllers/routes                 → G3
#   Auth/user/admin/2FA/Google controllers/routes         → G4
#   Frontend social/feed/post/story/community files       → G1
#   Frontend voice files                                  → G2
#   Frontend live-class files                             → G3
#   Frontend auth/login/register/session files            → G4
#   Mobile feed/friend/profile/post/story/social files    → G1
#   Mobile voice/pk files                                 → G2
#   Mobile live-class files                               → G3
#   Mobile auth files                                     → G4
#   Workflow / CI config changes                          → ALL
#   Test files — classified by their own domain pattern   → matching group(s)
#   Unknown / unmatched                                   → ALL (conservative)
#
# If BASE and HEAD produce no diff (e.g. initial push), falls back to ALL.
# =============================================================================
set -euo pipefail

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

# Attempt to get the diff; fall back to ALL on any error
CHANGED="$(git diff --name-only "$BASE" "$HEAD" 2>/dev/null || true)"

if [ -z "$CHANGED" ]; then
  echo "G1,G2,G3,G4,G5"
  exit 0
fi

G1=0; G2=0; G3=0; G4=0; G5=0

# ── classify() ──────────────────────────────────────────────────────────────
# Sets the group flag(s) for a single changed file path.
# Call with: classify "path/to/file"
classify() {
  local f="$1"

  # ── Shared / cross-cutting → ALL ────────────────────────────────────────
  if echo "$f" | grep -qiE \
    'backend/src/middleware/auth\.middleware|backend/src/utils/prisma\.js|backend/src/utils/redis\.js|backend/src/utils/jwt\.js|backend/prisma/schema\.prisma|backend/prisma/migrations/|\.github/workflows/'; then
    G1=1; G2=1; G3=1; G4=1; G5=1; return
  fi

  # ── Shared middleware (non-auth) → G4 ───────────────────────────────────
  if echo "$f" | grep -qiE 'backend/src/middleware/'; then
    G4=1; return
  fi

  # ── Socket.IO index → G1,G2,G3,G5 ──────────────────────────────────────
  if echo "$f" | grep -qiE 'backend/src/sockets/index\.js'; then
    G1=1; G2=1; G3=1; G5=1; return
  fi

  # ── LiveKit service → G2,G3 ─────────────────────────────────────────────
  if echo "$f" | grep -qiE 'backend/src/utils/livekitService|backend/src/utils/livekit'; then
    G2=1; G3=1; return
  fi

  # ── Backend controllers / routes ─────────────────────────────────────────

  # G1 — Social/Feed
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(post|social|story|explore|community|feed|report|follow|friend|dm|groupChat)'; then
    G1=1; return
  fi

  # G2 — Voice Club / PK
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(voice|pk|livekit\.controller)'; then
    G2=1; return
  fi

  # G3 — Live Classes
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(live.class|livekit|live_class)'; then
    G3=1; return
  fi

  # G4 — Auth / Authorization / Economy (auth-adjacent)
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(auth|user|admin|twoFactor|googleAuth|school|wallet|payout|stripe|gift|economy|creator|analytics|notification)'; then
    G4=1; return
  fi

  # ── Frontend files ───────────────────────────────────────────────────────

  # G1 — Social/Feed/Post/Story/Community
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(feed|social|post|story|explore|community|friend|follow|comment|reaction)'; then
    G1=1; return
  fi

  # G2 — Voice
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(voice|pk)'; then
    G2=1; return
  fi

  # G3 — Live Class
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(live.class|live_class|livekit)'; then
    G3=1; return
  fi

  # G4 — Auth
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(auth|login|register|session|twoFactor|2fa)'; then
    G4=1; return
  fi

  # ── Mobile files ─────────────────────────────────────────────────────────

  # G1 — Feed/Friend/Social/Post/Story
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(feed|social|friend|post|story|community|explore|profile|comment|reaction)'; then
    G1=1; return
  fi

  # G2 — Voice/PK
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(voice|pk)'; then
    G2=1; return
  fi

  # G3 — Live Class
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(live.class|live_class|livekit)'; then
    G3=1; return
  fi

  # G4 — Auth
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(auth|login|register|session)'; then
    G4=1; return
  fi

  # ── Backend test files — classify by domain ──────────────────────────────

  # G1 test files
  if echo "$f" | grep -qiE \
    'backend/src/tests/(social|post|feed|comment|reaction|follow|friend|explore|story|report|community.socket|phase3|phase4|phase5|phase6|phase7|task2|task6|bug.005|sprint11)'; then
    G1=1; return
  fi

  # G2 test files
  if echo "$f" | grep -qiE \
    'backend/src/tests/(voice|ph19|ph24c|pk|vc.sync|sprint12|sprint17|sprint18|sprint19)'; then
    G2=1; return
  fi

  # G3 test files
  if echo "$f" | grep -qiE \
    'backend/src/tests/(live.class|livekit|maxspeaker|public.stream|ph24a|sprint14|sprint16)'; then
    G3=1; return
  fi

  # G4 test files
  if echo "$f" | grep -qiE \
    'backend/src/tests/(super.admin|architecture|p0.security|p1.security|p2.security|p3.security|erp.remediation|school.auth|school.membership|platform.admin|phase24j|idempotency|health|rateLimiter|session|privilege|ui.separation|auth\.test|sprint7|sprint8|sprint9|sprint10|graphql|validation|encryption|internal.provisioning|phase2|phase4b|payout|wallet|gift|economy|creator|stripe)'; then
    G4=1; return
  fi

  # G5 test files
  if echo "$f" | grep -qiE \
    'backend/src/tests/(socket.auth.vuln|alerting|cache|circuitBreaker|tracing|db.hardening|production.hardening|apiVersion|errors)'; then
    G5=1; return
  fi

  # ── classifier / scripts changes → ALL ───────────────────────────────────
  if echo "$f" | grep -qiE 'scripts/ci-group-classifier'; then
    G1=1; G2=1; G3=1; G4=1; G5=1; return
  fi

  # ── Unknown / unmatched → ALL (conservative fallback) ────────────────────
  G1=1; G2=1; G3=1; G4=1; G5=1
}

# ── Process every changed file ───────────────────────────────────────────────
while IFS= read -r file; do
  [ -z "$file" ] && continue
  classify "$file"
  # Short-circuit: already selecting all groups
  if [ $G1 -eq 1 ] && [ $G2 -eq 1 ] && [ $G3 -eq 1 ] && [ $G4 -eq 1 ] && [ $G5 -eq 1 ]; then
    break
  fi
done <<< "$CHANGED"

# ── Build output string ───────────────────────────────────────────────────────
# NOTE: 'GROUPS' is a reserved bash/environment variable on both Linux and Windows
# (bash uses it for supplementary group IDs; Windows sets it as an env var).
# Renaming to CI_GROUPS avoids the collision where GROUPS="" silently fails.
CI_GROUPS=""
[ $G1 -eq 1 ] && CI_GROUPS="${CI_GROUPS}G1,"
[ $G2 -eq 1 ] && CI_GROUPS="${CI_GROUPS}G2,"
[ $G3 -eq 1 ] && CI_GROUPS="${CI_GROUPS}G3,"
[ $G4 -eq 1 ] && CI_GROUPS="${CI_GROUPS}G4,"
[ $G5 -eq 1 ] && CI_GROUPS="${CI_GROUPS}G5,"

# Strip trailing comma; if empty fall back to ALL (shouldn't happen but be safe)
CI_GROUPS="${CI_GROUPS%,}"
if [ -z "$CI_GROUPS" ]; then
  CI_GROUPS="G1,G2,G3,G4,G5"
fi

echo "$CI_GROUPS"
