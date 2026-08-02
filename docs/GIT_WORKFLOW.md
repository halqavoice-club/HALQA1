# HALQA — Git Workflow & Best Practices

---

## Branch Strategy

```
main          ← production-ready only. Never commit directly.
  │
  └─ develop  ← integration branch. All features merge here.
       │
       ├─ feature/add-gift-history    ← one branch per feature
       ├─ feature/fix-live-moderator
       │
       └─ hotfix/fix-payment-crash    ← urgent production fix
```

### When to use each branch

| Branch | Branch from | Merge to | Purpose |
|---|---|---|---|
| `main` | — | — | Live production. Deploy-ready only. |
| `develop` | `main` | `main` (via PR) | Integration. Merge features here. |
| `feature/*` | `develop` | `develop` | New feature or non-urgent fix. |
| `hotfix/*` | `main` | `main` + `develop` | Critical production bug. |
| `release/*` | `develop` | `main` + `develop` | Release stabilization, final testing. |

---

## Daily Workflow

```powershell
# See what changed
git status

# See a visual history
git lg          # alias for: git log --oneline --graph --decorate --all

# Pull latest changes before starting work
git pull origin develop

# Create a feature branch
git checkout -b feature/your-feature-name develop

# Make changes... then stage and commit
git add .
git commit -m "feat(module): describe what you did"

# Push branch to GitHub
git push -u origin feature/your-feature-name

# When done, open a Pull Request on GitHub to merge into develop
```

---

## Commit Message Format (Conventional Commits)

```
type(scope): description

type    — one of: feat, fix, docs, style, refactor, perf, test, chore, ci
scope   — what you changed: auth, live, wallet, gift, api, mobile, frontend
description — present tense, lowercase, max 100 chars
```

### Examples

```bash
feat(auth): add refresh token rotation
fix(live): resolve moderator mute bug in voice club
feat(wallet): add gift transaction history
refactor(api): optimize room queries with pagination
docs: update deployment guide
chore(deps): upgrade Prisma to 5.10
perf(voice): reduce LiveKit token generation latency
test(auth): add unit tests for JWT expiry
ci: add Docker build test to CI pipeline
hotfix(payments): fix Stripe webhook signature validation
```

### Never use

```bash
# Too vague
git commit -m "update"
git commit -m "changes"
git commit -m "fix"
git commit -m "WIP"
git commit -m "asdf"
```

---

## Session-End Backup Command

```powershell
# Quick one-liner at end of every work session
.\scripts\quick-backup.bat

# With a meaningful commit message
.\scripts\backup-daily.ps1 -Message "feat(live): improve speaker layout"
```

---

## Connecting a New GitHub Repository

```powershell
# First-time setup
git remote add origin git@github.com:YOUR-USERNAME/halqa.git
git branch -M main
git push -u origin main
git push -u origin develop

# Verify remote is correct
git remote -v

# If remote URL needs updating
git remote set-url origin git@github.com:YOUR-USERNAME/halqa.git
```

---

## Health Check Commands

```powershell
# Is git initialized?
git status

# Is remote connected?
git remote -v

# What's the current branch?
git branch --show-current

# Is .gitignore working? (should NOT list node_modules, .env, dist)
git check-ignore -v node_modules backend/.env frontend/.next

# Is there anything large accidentally staged?
git diff --cached --stat

# Check repository size
git count-objects -vH

# Are there any secrets in staged files?
git diff --cached | grep -iE "(sk_live|sk_test|AIza|AKIA|-----BEGIN)"

# Has anything been pushed?
git log origin/main..HEAD --oneline

# What would be pushed?
git diff origin/main..HEAD --stat
```

---

## Repository Health Checklist

Run these periodically:

```powershell
# 1. Git initialized
git status

# 2. Remote connected
git remote get-url origin

# 3. Default branch is main
git branch --show-current

# 4. .gitignore working
git ls-files --others --exclude-standard | findstr node_modules
# Should return nothing

# 5. No .env files tracked
git ls-files | findstr ".env"
# Should return nothing (or only .env.example files)

# 6. No large binaries
git ls-files | findstr ".apk"
# Should return nothing

# 7. Latest changes pushed
git log origin/main..HEAD --oneline
# Should return nothing if everything is pushed

# 8. Repo not too large
git count-objects -vH
```

---

## Git Aliases Reference

These are installed by `git-setup.ps1`:

| Alias | Full command | Use |
|---|---|---|
| `git st` | `git status` | See changed files |
| `git co` | `git checkout` | Switch branch |
| `git br` | `git branch` | List branches |
| `git lg` | `git log --oneline --graph --decorate --all` | Visual history |
| `git last` | `git log -1 HEAD --stat` | Last commit detail |
| `git undo` | `git reset HEAD~1 --mixed` | Undo last commit (keeps files) |
| `git save` | `git add -A && git commit -m 'WIP'` | Quick save |
| `git aliases` | Lists all aliases | Reference |

---

## Safety Rules

**NEVER do these:**

```bash
# Rewrite pushed history
git push --force origin main

# Delete main or develop
git branch -D main
git push origin --delete main

# Amend pushed commits
git commit --amend && git push --force

# Reset to a previous commit on main
git reset --hard HEAD~3 && git push --force

# Commit secrets
git add backend/.env
git commit -m "add env"

# Commit node_modules
git add backend/node_modules
```

**Always do instead:**

```bash
# Fix a mistake: add a new commit on top
git revert <commit-hash>

# Wrong branch: stash and switch
git stash
git checkout correct-branch
git stash pop

# Forgot to add a file: add it in a new commit
git add forgotten-file.js
git commit -m "fix: add missing file"

# Need to update last unpushed commit
git add .
git commit --amend --no-edit   # only safe if NOT pushed yet
```

---

## Troubleshooting

### "refused to merge unrelated histories"
```powershell
git pull origin main --allow-unrelated-histories
```

### "Your branch is ahead of origin/main by N commits"
```powershell
git push origin main
```

### "Your branch is behind origin/main"
```powershell
git pull origin main
```

### "CONFLICT — both modified file.js"
```powershell
# Edit the conflicting files to resolve conflicts
# Then:
git add .
git commit -m "fix: resolve merge conflict in file.js"
```

### "Pre-commit hook blocked my commit"
```powershell
# Check what was blocked
git status

# If you accidentally staged .env
git reset HEAD backend/.env

# If you need to skip hooks in an emergency (use sparingly)
git commit --no-verify -m "emergency: ..."
```

### "Large file accidentally committed"
```powershell
# Remove from tracking (does not delete the file)
git rm --cached path/to/large-file.apk
echo "*.apk" >> .gitignore
git add .gitignore
git commit -m "chore: remove APK from tracking"
```

---

*See also: [RESTORE_GUIDE.md](./RESTORE_GUIDE.md)*
