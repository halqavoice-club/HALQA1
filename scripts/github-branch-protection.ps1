# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — GitHub Branch Protection Setup
# Applies branch protection rules to main and develop via GitHub API.
#
# Usage:
#   .\scripts\github-branch-protection.ps1 -Token "ghp_yourtoken"
#
# What it sets up:
#   main    — require PR + 1 review + all CI checks pass + no force push
#   develop — require CI checks pass + no force push
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,

    [string]$Owner = "halqavoice-club",
    [string]$Repo  = "HALQA1"
)

$Headers = @{
    Authorization = "Bearer $Token"
    Accept        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

function Write-OK([string]$m)   { Write-Host "  ✅ $m" -ForegroundColor Green }
function Write-ERR([string]$m)  { Write-Host "  ❌ $m" -ForegroundColor Red }
function Write-Step([string]$m) { Write-Host "`n[$m]" -ForegroundColor Cyan }

Write-Host "`n[HALQA Branch Protection Setup]" -ForegroundColor Cyan
Write-Host "  Repo: $Owner/$Repo`n"

# ── Verify token works ─────────────────────────────────────────────────────
Write-Step "Verifying GitHub token"
try {
    $user = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $Headers
    Write-OK "Authenticated as: $($user.login)"
} catch {
    Write-ERR "Token invalid or expired: $_"
    exit 1
}

# ── Helper: apply branch protection ───────────────────────────────────────
function Set-BranchProtection {
    param([string]$Branch, [hashtable]$Rules)

    $uri = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"
    $body = $Rules | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method Put -Uri $uri -Headers $Headers -Body $body -ContentType "application/json" | Out-Null
        Write-OK "$Branch — protection applied"
    } catch {
        $msg = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
        Write-ERR "$Branch — failed: $($msg.message ?? $_)"
    }
}

# ── Protect main ──────────────────────────────────────────────────────────
Write-Step "Protecting 'main' branch"
Set-BranchProtection -Branch "main" -Rules @{
    required_status_checks = @{
        strict   = $true
        contexts = @(
            "Backend — Unit Tests",
            "Backend — Lint & Schema",
            "Frontend — TypeScript & Lint",
            "Mobile — TypeScript & Lint",
            "Backend — Integration Tests"
        )
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
        required_approving_review_count = 1
        dismiss_stale_reviews           = $true
        require_code_owner_reviews      = $false
    }
    restrictions              = $null
    allow_force_pushes        = $false
    allow_deletions           = $false
    block_creations           = $false
    required_linear_history   = $false
    required_conversation_resolution = $true
}

# ── Protect develop ───────────────────────────────────────────────────────
Write-Step "Protecting 'develop' branch"
Set-BranchProtection -Branch "develop" -Rules @{
    required_status_checks = @{
        strict   = $false
        contexts = @(
            "Backend — Unit Tests",
            "Backend — Lint & Schema",
            "Frontend — TypeScript & Lint"
        )
    }
    enforce_admins                = $false
    required_pull_request_reviews = $null
    restrictions                  = $null
    allow_force_pushes            = $false
    allow_deletions               = $false
}

# ── Verify protection was applied ─────────────────────────────────────────
Write-Step "Verifying protection rules"
foreach ($branch in @("main", "develop")) {
    try {
        $protection = Invoke-RestMethod `
            -Uri "https://api.github.com/repos/$Owner/$Repo/branches/$branch/protection" `
            -Headers $Headers
        Write-OK "$branch — protected (force push: $($protection.allow_force_pushes.enabled))"
    } catch {
        Write-ERR "$branch — could not verify: $_"
    }
}

Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  Branch Protection Applied
═══════════════════════════════════════════════════════════════════════════════

  main branch:
    ✅ Requires PR with 1 reviewer approval
    ✅ All CI checks must pass before merge
    ✅ No force push allowed
    ✅ No deletion allowed
    ✅ Stale reviews dismissed on new commits

  develop branch:
    ✅ CI checks must pass
    ✅ No force push allowed

  View on GitHub:
    https://github.com/$Owner/$Repo/settings/branches
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
