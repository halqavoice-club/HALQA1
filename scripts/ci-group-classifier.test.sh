#!/usr/bin/env bash
# =============================================================================
# HALQA — CI Group Classifier Tests
# =============================================================================
# Self-contained: no real git repo needed.
# Embeds the same classify() logic as ci-group-classifier.sh and calls it
# directly with test file paths. Each scenario asserts expected group flags.
#
# Run:
#   bash scripts/ci-group-classifier.test.sh
#
# Exit code: 0 = all tests pass, 1 = one or more failures.
# =============================================================================
set -euo pipefail

PASS=0
FAIL=0

# ── Embedded classify logic (must stay in sync with ci-group-classifier.sh) ──
# Returns groups for a single file via global G1-G5 flags.
# Call reset_groups before each test; call classify with the file path(s).

reset_groups() { G1=0; G2=0; G3=0; G4=0; G5=0; }

classify() {
  local f="$1"

  if echo "$f" | grep -qiE \
    'backend/src/middleware/auth\.middleware|backend/src/utils/prisma\.js|backend/src/utils/redis\.js|backend/src/utils/jwt\.js|backend/prisma/schema\.prisma|backend/prisma/migrations/|\.github/workflows/'; then
    G1=1; G2=1; G3=1; G4=1; G5=1; return
  fi
  if echo "$f" | grep -qiE 'backend/src/middleware/'; then
    G4=1; return
  fi
  if echo "$f" | grep -qiE 'backend/src/sockets/index\.js'; then
    G1=1; G2=1; G3=1; G5=1; return
  fi
  if echo "$f" | grep -qiE 'backend/src/utils/livekitService|backend/src/utils/livekit'; then
    G2=1; G3=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(post|social|story|explore|community|feed|report|follow|friend|dm|groupChat)'; then
    G1=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(voice|pk|livekit\.controller)'; then
    G2=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(live.class|livekit|live_class)'; then
    G3=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/(controllers|routes)/(auth|user|admin|twoFactor|googleAuth|school|wallet|payout|stripe|gift|economy|creator|analytics|notification)'; then
    G4=1; return
  fi
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(feed|social|post|story|explore|community|friend|follow|comment|reaction)'; then
    G1=1; return
  fi
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(voice|pk)'; then
    G2=1; return
  fi
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(live.class|live_class|livekit)'; then
    G3=1; return
  fi
  if echo "$f" | grep -qiE \
    'frontend/src/(app|components|hooks|store|lib).*(auth|login|register|session|twoFactor|2fa)'; then
    G4=1; return
  fi
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(feed|social|friend|post|story|community|explore|profile|comment|reaction)'; then
    G1=1; return
  fi
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(voice|pk)'; then
    G2=1; return
  fi
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(live.class|live_class|livekit)'; then
    G3=1; return
  fi
  if echo "$f" | grep -qiE \
    'mobile/(app|src).*(auth|login|register|session)'; then
    G4=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/tests/(social|post|feed|comment|reaction|follow|friend|explore|story|report|community.socket|phase3|phase4|phase5|phase6|phase7|task2|task6|bug.005|sprint11)'; then
    G1=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/tests/(voice|ph19|ph24c|pk|vc.sync|sprint12|sprint17|sprint18|sprint19)'; then
    G2=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/tests/(live.class|livekit|maxspeaker|public.stream|ph24a|sprint14|sprint16)'; then
    G3=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/tests/(super.admin|architecture|p0.security|p1.security|p2.security|p3.security|erp.remediation|school.auth|school.membership|platform.admin|phase24j|idempotency|health|rateLimiter|session|privilege|ui.separation|auth\.test|sprint7|sprint8|sprint9|sprint10|graphql|validation|encryption|internal.provisioning|phase2|phase4b|payout|wallet|gift|economy|creator|stripe)'; then
    G4=1; return
  fi
  if echo "$f" | grep -qiE \
    'backend/src/tests/(socket.auth.vuln|alerting|cache|circuitBreaker|tracing|db.hardening|production.hardening|apiVersion|errors)'; then
    G5=1; return
  fi
  if echo "$f" | grep -qiE 'scripts/ci-group-classifier'; then
    G1=1; G2=1; G3=1; G4=1; G5=1; return
  fi
  # Conservative fallback
  G1=1; G2=1; G3=1; G4=1; G5=1
}

# ── Test helpers ──────────────────────────────────────────────────────────────
assert_groups() {
  # assert_groups "test name" "expected_csv" G1 G2 G3 G4 G5
  local name="$1" expected="$2"
  local actual_g1="$3" actual_g2="$4" actual_g3="$5" actual_g4="$6" actual_g5="$7"
  local actual=""
  [ "$actual_g1" -eq 1 ] && actual="${actual}G1,"
  [ "$actual_g2" -eq 1 ] && actual="${actual}G2,"
  [ "$actual_g3" -eq 1 ] && actual="${actual}G3,"
  [ "$actual_g4" -eq 1 ] && actual="${actual}G4,"
  [ "$actual_g5" -eq 1 ] && actual="${actual}G5,"
  actual="${actual%,}"

  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  # assert_contains "test name" "required_group" G1 G2 G3 G4 G5
  local name="$1" required="$2"
  local g1="$3" g2="$4" g3="$5" g4="$6" g5="$7"
  local ok=0
  case "$required" in
    G1) [ "$g1" -eq 1 ] && ok=1 ;;
    G2) [ "$g2" -eq 1 ] && ok=1 ;;
    G3) [ "$g3" -eq 1 ] && ok=1 ;;
    G4) [ "$g4" -eq 1 ] && ok=1 ;;
    G5) [ "$g5" -eq 1 ] && ok=1 ;;
  esac
  if [ "$ok" -eq 1 ]; then
    echo "  PASS: $name (contains $required)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected $required)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local name="$1" absent="$2"
  local g1="$3" g2="$4" g3="$5" g4="$6" g5="$7"
  local present=0
  case "$absent" in
    G1) [ "$g1" -eq 1 ] && present=1 ;;
    G2) [ "$g2" -eq 1 ] && present=1 ;;
    G3) [ "$g3" -eq 1 ] && present=1 ;;
    G4) [ "$g4" -eq 1 ] && present=1 ;;
    G5) [ "$g5" -eq 1 ] && present=1 ;;
  esac
  if [ "$present" -eq 0 ]; then
    echo "  PASS: $name (does not contain $absent)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (unexpected $absent was selected)"
    FAIL=$((FAIL + 1))
  fi
}

# =============================================================================
# TEST SUITE
# =============================================================================

echo ""
echo "=== HALQA CI Group Classifier Tests ==="
echo ""

# ── T01: Feed-only backend controller → G1 only ──────────────────────────────
echo "T01: Feed-only backend change"
reset_groups
classify "backend/src/controllers/post.controller.js"
assert_contains "T01a" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T01b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T01c (not G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T01d (not G4)" "G4" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T01e (not G5)" "G5" $G1 $G2 $G3 $G4 $G5

# ── T02: Voice-only backend controller → G2 only ────────────────────────────
echo "T02: Voice Club backend change"
reset_groups
classify "backend/src/controllers/voice.controller.js"
assert_contains "T02a" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T02b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T02c (not G3)" "G3" $G1 $G2 $G3 $G4 $G5

# ── T03: Live-class controller → G3 only ─────────────────────────────────────
echo "T03: Live Class backend change"
reset_groups
classify "backend/src/controllers/live-class.controller.js"
assert_contains "T03a" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T03b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T03c (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T04: Auth middleware (shared) → ALL ──────────────────────────────────────
echo "T04: Shared auth middleware → ALL"
reset_groups
classify "backend/src/middleware/auth.middleware.js"
assert_groups "T04" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T05: Prisma schema (shared) → ALL ────────────────────────────────────────
echo "T05: Prisma schema change → ALL"
reset_groups
classify "backend/prisma/schema.prisma"
assert_groups "T05" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T06: Migration directory (shared) → ALL ──────────────────────────────────
echo "T06: New migration → ALL"
reset_groups
classify "backend/prisma/migrations/20261011_add_post_report/migration.sql"
assert_groups "T06" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T07: Socket.IO index → G1,G2,G3,G5 (not G4) ────────────────────────────
echo "T07: Socket.IO index → G1,G2,G3,G5"
reset_groups
classify "backend/src/sockets/index.js"
assert_groups "T07" "G1,G2,G3,G5" $G1 $G2 $G3 $G4 $G5

# ── T08: LiveKit service → G2,G3 only ────────────────────────────────────────
echo "T08: LiveKit service → G2,G3"
reset_groups
classify "backend/src/utils/livekitService.js"
assert_groups "T08" "G2,G3" $G1 $G2 $G3 $G4 $G5

# ── T09: Multi-domain change → G1+G2 ─────────────────────────────────────────
echo "T09: Multi-domain (post + voice) → G1,G2"
reset_groups
classify "backend/src/controllers/post.controller.js"
classify "backend/src/controllers/voice.controller.js"
assert_contains "T09a (G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_contains "T09b (G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T09c (not G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T09d (not G5)" "G5" $G1 $G2 $G3 $G4 $G5

# ── T10: Workflow change → ALL ────────────────────────────────────────────────
echo "T10: CI workflow change → ALL"
reset_groups
classify ".github/workflows/ci.yml"
assert_groups "T10" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T11: Unknown/docs file → ALL (conservative) ──────────────────────────────
echo "T11: Unknown file → ALL (conservative)"
reset_groups
classify "docs/README.md"
assert_groups "T11" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T12: Frontend social component → G1 ─────────────────────────────────────
echo "T12: Frontend social component → G1"
reset_groups
classify "frontend/src/components/feed/PostCard.tsx"
assert_contains "T12a (G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T12b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T13: Frontend voice component → G2 ──────────────────────────────────────
echo "T13: Frontend voice component → G2"
reset_groups
classify "frontend/src/components/voice/VoiceRoomView.tsx"
assert_contains "T13a (G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T13b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T14: Frontend live-class component → G3 ──────────────────────────────────
echo "T14: Frontend live-class component → G3"
reset_groups
classify "frontend/src/components/live-class/LiveClassRoomImpl.tsx"
assert_contains "T14a (G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T14b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T15: Mobile friend screen → G1 ───────────────────────────────────────────
echo "T15: Mobile friend screen → G1"
reset_groups
classify "mobile/app/(tabs)/friend.tsx"
assert_contains "T15a (G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T15b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T16: Mobile voice screen → G2 ────────────────────────────────────────────
echo "T16: Mobile voice/pk screen → G2"
reset_groups
classify "mobile/app/pk/index.tsx"
assert_contains "T16a (G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T16b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T17: Mobile live-class screen → G3 ───────────────────────────────────────
echo "T17: Mobile live-class screen → G3"
reset_groups
classify "mobile/app/(tabs)/live-class.tsx"
assert_contains "T17a (G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T17b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T18: G1 test file → G1 ───────────────────────────────────────────────────
echo "T18: G1 test file (social-friends) → G1"
reset_groups
classify "backend/src/tests/social-friends.test.js"
assert_contains "T18a (G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T18b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T19: G2 test file → G2 ───────────────────────────────────────────────────
echo "T19: G2 test file (voice-one-room-rule) → G2"
reset_groups
classify "backend/src/tests/voice-one-room-rule.test.js"
assert_contains "T19a (G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T19b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T20: G3 test file → G3 ───────────────────────────────────────────────────
echo "T20: G3 test file (live-class-p0-security) → G3"
reset_groups
classify "backend/src/tests/live-class-p0-security.test.js"
assert_contains "T20a (G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T20b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T21: G4 test file → G4 ───────────────────────────────────────────────────
echo "T21: G4 test file (super-admin-scope) → G4"
reset_groups
classify "backend/src/tests/super-admin-scope.test.js"
assert_contains "T21a (G4)" "G4" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T21b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T21c (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T22: G5 test file → G5 ───────────────────────────────────────────────────
echo "T22: G5 test file (socket-auth-vuln) → G5"
reset_groups
classify "backend/src/tests/socket-auth-vuln-live-006.test.js"
assert_contains "T22a (G5)" "G5" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T22b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5

# ── T23: G4 test file (idempotency) → G4 ────────────────────────────────────
echo "T23: G4 test file (idempotency) → G4"
reset_groups
classify "backend/src/tests/idempotency.test.js"
assert_contains "T23a (G4)" "G4" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T23b (not G2)" "G2" $G1 $G2 $G3 $G4 $G5

# ── T24: G4 test file (erp-remediation) → G4 ────────────────────────────────
echo "T24: G4 test file (erp-remediation) → G4"
reset_groups
classify "backend/src/tests/erp-remediation.test.js"
assert_contains "T24a (G4)" "G4" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T24b (not G3)" "G3" $G1 $G2 $G3 $G4 $G5

# ── T25: Classifier script itself → ALL ──────────────────────────────────────
echo "T25: Classifier script change → ALL"
reset_groups
classify "scripts/ci-group-classifier.sh"
assert_groups "T25" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T26: Non-auth middleware → G4 only ───────────────────────────────────────
echo "T26: Non-auth middleware → G4 only"
reset_groups
classify "backend/src/middleware/idempotency.js"
assert_contains "T26a (G4)" "G4" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T26b (not G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T26c (not G5)" "G5" $G1 $G2 $G3 $G4 $G5

# ── T27: Social + live-class change → G1+G3 ─────────────────────────────────
echo "T27: Multi-domain (post + live-class) → G1,G3"
reset_groups
classify "backend/src/controllers/post.controller.js"
classify "backend/src/controllers/live-class.controller.js"
assert_contains "T27a (G1)" "G1" $G1 $G2 $G3 $G4 $G5
assert_contains "T27b (G3)" "G3" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T27c (not G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T27d (not G5)" "G5" $G1 $G2 $G3 $G4 $G5

# ── T28: PK routes → G2 ──────────────────────────────────────────────────────
echo "T28: PK routes → G2"
reset_groups
classify "backend/src/routes/pk.routes.js"
assert_contains "T28a (G2)" "G2" $G1 $G2 $G3 $G4 $G5
assert_not_contains "T28b (not G3)" "G3" $G1 $G2 $G3 $G4 $G5

# ── T29: Redis utility (shared) → ALL ────────────────────────────────────────
echo "T29: Redis utility (shared) → ALL"
reset_groups
classify "backend/src/utils/redis.js"
assert_groups "T29" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# ── T30: Prisma migrations path → ALL ────────────────────────────────────────
echo "T30: Any migration file → ALL"
reset_groups
classify "backend/prisma/migrations/20261003_add_sessions_and_webhooks/migration.sql"
assert_groups "T30" "G1,G2,G3,G4,G5" $G1 $G2 $G3 $G4 $G5

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
