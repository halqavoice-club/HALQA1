# Design Document: Halqa Steering Enhancement

## Overview

This feature extends the Kiro steering system from 3 files to 8 by adding 5 focused, domain-specific files. The 3 existing files (`tech.md`, `structure.md`, `product.md`) load automatically for every task and cover the tech stack, project layout, and product overview. The 5 new files load only when relevant — 4 via `fileMatch` patterns and 1 on manual demand — delivering the right context at the right time without bloating the default context window.

All 5 files are already implemented at `.kiro/steering/`.

---

## Steering File Architecture

### Inclusion Modes

Kiro steering files support two inclusion modes, declared in YAML front-matter between `---` delimiters:

**`inclusion: auto`** — Loaded for every task, regardless of what files are open. Used by the 3 existing files because their content (tech stack, structure, product) is broadly relevant.

**`inclusion: fileMatch`** — Loaded only when the active editor file matches the `fileMatchPattern` glob(s). Used by 4 of the 5 new files. This avoids injecting security invariants into a payment flow task, or injecting payment rules into a realtime task.

**`inclusion: manual`** — Never loaded automatically. The user explicitly requests the file by name (e.g., `#constitution`). Used by `constitution.md` because it is large and broad — loading it on every task would consume unnecessary context for routine work.

### Front-Matter Format

Every steering file begins with a YAML front-matter block using `---` delimiters:

```markdown
---
inclusion: fileMatch
fileMatchPattern: "**/*stripe*,**/*wallet*,**/*gift*"
description: Brief description of what this file covers
---
```

Required fields:
- `inclusion` — one of `auto`, `fileMatch`, or `manual`
- `description` — single-line summary shown in Kiro's steering UI
- `fileMatchPattern` — required when `inclusion: fileMatch`; comma-separated glob patterns

---

## The 8-File Steering System

### Existing Files (auto inclusion — always loaded)

| File | Owns |
|------|------|
| `tech.md` | Tech stack table, SDK versions, common commands, environment files, build configuration |
| `structure.md` | Directory trees (backend/frontend/mobile), naming conventions, Key Architecture Rules 1–7 |
| `product.md` | Core domains, user roles, Islamic-specific features, product overview |

### New Files

| File | Inclusion | Trigger | Owns |
|------|-----------|---------|------|
| `security.md` | `fileMatch` | middleware, auth, admin, routes, security-related files | 16 production invariants (concise checklist form), SUPER_ADMIN boundary rules, change-control checklist, correct vs prohibited patterns, regression test reference |
| `realtime.md` | `fileMatch` | sockets, livekit, voice, live-class files and hooks | Socket.IO auth pattern, 14-room taxonomy, rate limit table, LiveKit token structures for Voice Club and Live Class, reconnect policy, event naming conventions |
| `payments.md` | `fileMatch` | stripe, wallet, gift, payout, transaction files | Coin/diamond economy model, conversion rates, INV-013 five financial integrity rules, Stripe webhook flow, gift idempotency pattern, `WalletTransaction` type enum, refund rules |
| `testing.md` | `fileMatch` | `*.test.js`, `*.test.ts`, `*.spec.ts`, `*.pbt.test.ts`, `tests/` | Test categories (unit/integration/PBT), file naming convention, `describe`/`test` naming, mock helpers (`asUser`, `tok`), source-level verification pattern, PBT configuration |
| `constitution.md` | `manual` | Explicit `#constitution` invocation | All 45 sections of platform rules inline: 16 invariants in full detail, violation register (39 violations), 14-step change-control process, school isolation rules, infrastructure dependency table, SQL injection prevention rules, documentation phase index |

---

## Content Ownership Model

The 8-file system follows strict ownership: each rule lives in exactly one file. Cross-references use the target file's name rather than restating the content.

### Ownership Map

```
tech.md                 → SDK/package versions, commands, environment config
structure.md            → Directory layout, Key Architecture Rules 1–7, naming conventions
product.md              → Domain descriptions, user role definitions, product identity
security.md             → INV-001–INV-016 (concise), SUPER_ADMIN boundary, change checklist
realtime.md             → Socket.IO patterns, LiveKit token grants, room taxonomy, rate limits
payments.md             → Economy model, financial integrity rules, Stripe/gift flows
testing.md              → Test conventions, mock patterns, PBT config, baseline rule
constitution.md         → All of the above in consolidated form + violation history + change control
```

### Non-Duplication Rules

1. `tech.md` owns all SDK/package version strings. New files reference it by name when versions are relevant (e.g., `realtime.md` says "See `tech.md` for Socket.IO version").

2. `structure.md` owns Key Architecture Rules 1–7, including the Socket.IO transport order rule (Rule 4). `realtime.md` references `structure.md` Rule 4 rather than restating the polling-first requirement.

3. `product.md` owns user role definitions. `security.md` references `product.md` for role descriptions rather than redefining SUPER_ADMIN, TEACHER, etc.

4. `security.md` provides the 16 invariants in concise one-sentence checklist form. `constitution.md` provides them in full inline detail. The two representations are complementary: `security.md` is the fast-check reference; `constitution.md` is the authoritative inline source.

5. `constitution.md` references `tech.md`, `structure.md`, and `product.md` by name for tech stack, project structure, and product overview — it does not reproduce their full sections.

---

## fileMatch Pattern Design

Each `fileMatchPattern` is a comma-separated list of glob strings. Kiro matches against the path of the currently active editor file.

| File | `fileMatchPattern` | Rationale |
|------|--------------------|-----------|
| `security.md` | `**/{middleware,auth*,admin*,routes}/**,**/*security*,**/*invariant*,**/*permission*,**/*auth*` | Covers auth middleware, role guards, admin controllers, route files, and any file named with security/auth/permission concepts |
| `realtime.md` | `**/{sockets,hooks}/**,**/*socket*,**/*livekit*,**/*voice*,**/*live-class*,**/*live_class*,**/*useLiveKit*,**/*useLiveKitAudio*` | Covers the Socket.IO handler, LiveKit token endpoints, voice/live-class controllers, and frontend hooks for audio |
| `payments.md` | `**/*stripe*,**/*wallet*,**/*gift*,**/*payout*,**/*coins*,**/*payment*,**/*transaction*` | Covers all financial domain files by filename keyword |
| `testing.md` | `**/*.test.js,**/*.test.ts,**/*.spec.ts,**/*.pbt.test.ts,**/tests/**` | Covers all test files and the tests directory |

`constitution.md` uses `inclusion: manual` — no `fileMatchPattern` needed. It is loaded on demand when the developer explicitly invokes it (e.g., for feature design sessions or architecture reviews).

---

## How New Files Complement the Existing Three

The 3 existing files establish baseline context for every task. The 5 new files add depth for specific domains without replacing the baseline.

**Example — editing `voice.controller.js`:**
- Auto-loaded: `tech.md` (stack), `structure.md` (file layout), `product.md` (Voice Club description)
- fileMatch-loaded: `realtime.md` (Socket.IO patterns, LiveKit grants, rate limits)
- Not loaded: `security.md`, `payments.md`, `testing.md` (not relevant to a controller edit)

**Example — editing `auth.middleware.js`:**
- Auto-loaded: `tech.md`, `structure.md`, `product.md`
- fileMatch-loaded: `security.md` (16 invariants, SUPER_ADMIN boundary)
- Not loaded: `realtime.md`, `payments.md`, `testing.md`

**Example — editing `idempotency.test.js`:**
- Auto-loaded: `tech.md`, `structure.md`, `product.md`
- fileMatch-loaded: `testing.md` (test conventions, mock helpers, PBT config)
- Not loaded: `security.md`, `realtime.md`, `payments.md`

**Example — architecture review session:**
- Auto-loaded: `tech.md`, `structure.md`, `product.md`
- Manually loaded: `constitution.md` (all 45 sections, full invariants, violation history)

---

## Cross-Reference Strategy

Files reference each other by name in a `> See X.md for Y` note at the top of the relevant section. No content is restated.

### Cross-Reference Map (implemented)

| File | References | Topic delegated |
|------|-----------|----------------|
| `realtime.md` | `structure.md` Key Architecture Rule 4 | Socket.IO transport order (polling first) |
| `realtime.md` | `security.md` INV-009 | SUPER_ADMIN socket room boundaries |
| `payments.md` | `tech.md` | Stripe SDK version |
| `payments.md` | `security.md` INV-013 | SUPER_ADMIN financial mutation rules |
| `testing.md` | `tech.md` Common Commands | Test runner commands |
| `security.md` | `structure.md` | Project structure, Key Architecture Rules |
| `security.md` | `product.md` | User role definitions |
| `constitution.md` | `tech.md`, `structure.md`, `product.md` | Tech stack, project structure, product overview |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: All new steering files have valid Kiro front-matter

*For any* file in the set `{security.md, realtime.md, payments.md, testing.md, constitution.md}`, the file SHALL begin with a `---` front-matter block that contains an `inclusion` field and a `description` field.

**Validates: Requirements 6.6**

### Property 2: fileMatch files do not duplicate tech stack ownership

*For any* of the four fileMatch steering files (`security.md`, `realtime.md`, `payments.md`, `testing.md`), the file SHALL NOT contain a standalone tech-stack table row claiming SDK package versions or version numbers that are already the property of `tech.md`.

**Validates: Requirements 6.1, 1.7, 2.12, 3.12, 4.10**

### Property 3: Cross-references use file names, not content restatement

*For any* topic that is owned by one steering file but referenced in another, the referencing file SHALL contain the owner file's name (e.g., `tech.md`, `structure.md`) in the reference text, rather than reproducing the owned content verbatim.

**Validates: Requirements 6.4, 2.12, 3.12, 4.10**

### Property 4: New files do not reproduce structure.md structural content

*For any* of the five new steering files, the file SHALL NOT contain a reproduction of the root layout directory tree, backend/frontend/mobile directory trees, or the numbered Key Architecture Rules 1–7 that are owned by `structure.md`.

**Validates: Requirements 6.2**

### Property 5: constitution.md invariant form is more detailed than security.md invariant form

*For any* invariant ID in INV-001 through INV-016, the `constitution.md` representation of that invariant SHALL contain more text (fuller explanation) than the corresponding one-sentence entry in `security.md`'s invariant table.

**Validates: Requirements 6.5, 5.4**
