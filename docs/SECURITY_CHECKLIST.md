# HALQA — Git Security Checklist

Run this checklist before every `git push` to main/develop.

---

## Before Every Commit

- [ ] `git status` — no `.env` files staged
- [ ] `git status` — no `node_modules` staged
- [ ] `git status` — no `*.apk` / `*.aab` staged
- [ ] `git status` — no `*.log` files staged
- [ ] `git diff --cached` — no hardcoded secrets visible
- [ ] Commit message follows Conventional Commits format

## Before Pushing to Main

- [ ] All tests pass: `cd backend && npm test`
- [ ] No merge conflicts pending
- [ ] PR reviewed (if team project)
- [ ] GitHub Actions CI is green

## Secrets Never in Git

These MUST stay in `.env` files only:

| Secret | Location |
|---|---|
| `JWT_SECRET` | `backend/.env` |
| `JWT_REFRESH_SECRET` | `backend/.env` |
| `DATABASE_URL` (with password) | `backend/.env` |
| `REDIS_URL` (with password) | `backend/.env` |
| `STRIPE_SECRET_KEY` | `backend/.env` |
| `STRIPE_WEBHOOK_SECRET` | `backend/.env` |
| `LIVEKIT_API_SECRET` | `backend/.env` |
| `R2_SECRET_ACCESS_KEY` | `backend/.env` |
| `SMTP_PASS` | `backend/.env` |
| `METRICS_TOKEN` | `backend/.env` |
| `NEXT_PUBLIC_*` API keys | `frontend/.env.local` |
| Firebase credentials | `backend/.env` |
| Any `sk_*`, `pk_*`, `whsec_*` key | `.env` only |

## Quick Secret Scan

```powershell
# Run from project root — should return no results
git diff --cached | Select-String -Pattern '(sk_live|sk_test|whsec_|AKIA|AIza|-----BEGIN PRIVATE)'

# Check for .env files tracked by git
git ls-files | Select-String '\.env$'
# Should only show .env.example files, never real .env
```

## GitHub Repository Settings

- [ ] Repository is **Private** (not Public)
- [ ] GitHub Secrets configured (not hardcoded in workflows):
  - `DEPLOY_HOST`
  - `DEPLOY_USER`
  - `DEPLOY_SSH_KEY`
  - `DEPLOY_PORT`
- [ ] Production environment requires manual approval
- [ ] Branch protection on `main`:
  - Require PR before merging
  - Require CI checks to pass
  - No force-push allowed

## Monthly Review

- [ ] Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET` (all users re-login)
- [ ] Rotate `METRICS_TOKEN`
- [ ] Review GitHub Actions logs for exposed secrets
- [ ] Review repository contributors list
- [ ] Check for dependencies with known vulnerabilities: `npm audit`
- [ ] Verify no large files crept in: `git count-objects -vH`

---

## If a Secret Was Accidentally Committed

**Act immediately:**

1. **Revoke the secret** at the service provider (Stripe, LiveKit, etc.)
2. Generate a new secret
3. Remove from git history:
   ```powershell
   # Install BFG Repo Cleaner or use git filter-repo
   # Then force-push (only on private repos with no other collaborators)
   git push --force-with-lease origin main
   ```
4. Notify team members to re-clone
5. Update `.env` with new secret
6. Update all production deployments

**Do not** just add a new commit that removes the secret — it stays in history.

---

*See also: [GIT_WORKFLOW.md](./GIT_WORKFLOW.md) | [RESTORE_GUIDE.md](./RESTORE_GUIDE.md)*
