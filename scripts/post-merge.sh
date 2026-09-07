#!/bin/bash
set -euo pipefail

# Roundhouse post-merge hook (configured via [postMerge] in .replit).
#
# This is the project's only every-merge CI surface — there is no
# GitHub Actions workflow. It runs after every task merge to keep the
# workspace ready for the Playwright e2e specs in tests/e2e/ and the
# markdown e2e plans in artifacts/round-house/e2e/.
#
# The hook is split into two phases:
#
#   1. Baseline (always runs): install deps + push the DB schema so
#      the workspace is buildable.
#
#   2. PublicProfileModal CI (path-conditional, task #713): seed the
#      three modal test families' fixtures AND run a discovery /
#      typecheck gate against the matching Playwright specs so any
#      regression in those specs/plans fails the merge with a non-zero
#      exit. The gate only fires when this merge actually touches the
#      modal, the API the modal reads, or the seed scripts that feed
#      the specs — see `MODAL_CI_PATH_RE` below for the exact paths.
#
# Each seed script is idempotent — re-running resets the relevant
# `outward_accounts` / `user_modes` / `user_connections` rows back to
# their declared known-empty state so the next test run starts from a
# deterministic baseline.
#
# The fixture credentials each seed prints are pre-stored under
# [userenv.shared] in .replit (E2E_TEAM_CHIP_*, E2E_PICKED_SKIN_*,
# and the per-client pro-tag pair). Rotate them by re-running the
# matching seed locally and updating .replit if Firebase passwords
# change — see artifacts/round-house/e2e/README.md.

# ---------------------------------------------------------------------
# Phase 1 — baseline
# ---------------------------------------------------------------------
pnpm install --frozen-lockfile
pnpm --filter db push

# ---------------------------------------------------------------------
# Phase 2 — PublicProfileModal CI (task #713)
# ---------------------------------------------------------------------
# Paths whose changes warrant re-seeding + re-validating the modal's
# three test families. Keep this in sync with the path scope spelled
# out in the task brief:
#   - artifacts/round-house              (the modal + screens it lives on)
#   - artifacts/api-server               (the GET /users/:id?outwardAccountId route the modal reads)
#   - scripts/src/seed-picked-skin-banner-fixtures.ts
#   - scripts/src/seed-teammate-chip-fixtures.ts
#   - scripts/src/seed-pro-tag-fixtures.ts
#   - tests/e2e/                         (the Playwright specs themselves)
#   - artifacts/round-house/e2e/         (the markdown test plans)
MODAL_CI_PATH_RE='^(artifacts/round-house(/|$)|artifacts/api-server(/|$)|scripts/src/seed-(picked-skin-banner|teammate-chip|pro-tag)-fixtures\.ts$|tests/e2e/(|.*\.spec\.ts$|README\.md$))'

# Self-check: the trigger regex must match every path the README and
# task brief promise it covers. Catches accidental drift between the
# regex and the documented scope. Keep this list in sync with the
# "When the modal CI gate fires" section of
# artifacts/round-house/e2e/README.md.
EXPECTED_TRIGGER_PATHS=(
  "artifacts/round-house/components/PublicProfileModal.tsx"
  "artifacts/api-server/src/routes/users.ts"
  "scripts/src/seed-picked-skin-banner-fixtures.ts"
  "scripts/src/seed-teammate-chip-fixtures.ts"
  "scripts/src/seed-pro-tag-fixtures.ts"
  "tests/e2e/picked-skin-banner-swap.spec.ts"
  "tests/e2e/README.md"
  "artifacts/round-house/e2e/picked-skin-banner-swap.test-plan.md"
)
for path in "${EXPECTED_TRIGGER_PATHS[@]}"; do
  if ! echo "$path" | grep -Eq "$MODAL_CI_PATH_RE"; then
    echo "[post-merge] FAIL: MODAL_CI_PATH_RE does not match documented trigger path: $path" >&2
    echo "[post-merge] Update MODAL_CI_PATH_RE in scripts/post-merge.sh or update the README." >&2
    exit 1
  fi
done

# Detect changed files in the merge that just landed. `git diff
# HEAD~1 HEAD` is the right shape for fast-forward / squash merges
# the platform produces. If we can't resolve HEAD~1 (e.g. very first
# commit), fall back to running the gate so we don't silently skip.
if changed_files="$(git diff --name-only HEAD~1 HEAD 2>/dev/null)"; then
  :
else
  echo "[post-merge] could not resolve HEAD~1; defaulting to running the modal CI gate"
  changed_files=""
fi

run_modal_ci=0
if [ -z "$changed_files" ]; then
  run_modal_ci=1
elif echo "$changed_files" | grep -Eq "$MODAL_CI_PATH_RE"; then
  run_modal_ci=1
fi

if [ "$run_modal_ci" -eq 0 ]; then
  echo "[post-merge] no changes under PublicProfileModal CI paths; skipping seeds + e2e gate"
  echo "[post-merge] (changed files in this merge:)"
  echo "$changed_files" | sed 's/^/  /'
  exit 0
fi

echo "[post-merge] PublicProfileModal CI paths changed — re-seeding fixtures and running e2e gate"
echo "[post-merge] (matching changed files:)"
echo "$changed_files" | grep -E "$MODAL_CI_PATH_RE" | sed 's/^/  /' || true

# Seed the three picked-skin / public-profile test families that share
# `PublicProfileModal`. Sharing one CI surface keeps every fixture the
# modal's regression suite depends on in lockstep:
#   - teammate-chip-public-profile.test-plan.md  (#558)
#   - picked-skin-banner-swap.test-plan.md       (#699; spec lands with #714)
#   - per-client-pro-tag.test-plan.md
pnpm --filter @workspace/scripts run seed:teammate-chip-fixtures
pnpm --filter @workspace/scripts run seed:picked-skin-banner-fixtures
pnpm --filter @workspace/scripts run seed:pro-tag-fixtures

# Specs that exercise the three modal test families. We run a
# Playwright discovery (`--list`) gate over them rather than a full
# headed browser run so the post-merge stays fast and deterministic
# while still failing non-zero on any regression that breaks spec
# compilation, fixture imports, or test registration. Full headed
# runs continue to happen via the project's testing tool against the
# same specs.
# Specs the gate must always find. If any of these vanish (accidental
# deletion / rename), fail loudly rather than silently passing.
REQUIRED_SPECS=(
  "tests/e2e/teammate-chip-public-profile.spec.ts"
  "tests/e2e/per-client-pro-tag.spec.ts"
  "tests/e2e/pro-per-client-tag.spec.ts"
  "tests/e2e/public-profile-skin-avatar-swap.spec.ts"
)
# Specs allowed to be missing for now. Each entry MUST come with the
# follow-up task that will land it; once the file lands, remove it
# from this list so a future deletion fails the gate.
OPTIONAL_SPECS=(
  "tests/e2e/picked-skin-banner-swap.spec.ts" # follow-up #714
)

missing_required=()
for spec in "${REQUIRED_SPECS[@]}"; do
  if [ ! -f "$spec" ]; then
    missing_required+=("$spec")
  fi
done
if [ "${#missing_required[@]}" -gt 0 ]; then
  echo "[post-merge] FAIL: required PublicProfileModal specs missing:" >&2
  for spec in "${missing_required[@]}"; do echo "  - $spec" >&2; done
  echo "[post-merge] If a spec was intentionally renamed/removed, update REQUIRED_SPECS in scripts/post-merge.sh." >&2
  exit 1
fi

existing_specs=("${REQUIRED_SPECS[@]}")
for spec in "${OPTIONAL_SPECS[@]}"; do
  if [ -f "$spec" ]; then
    existing_specs+=("$spec")
    echo "[post-merge] (optional spec now present, including) $spec — please graduate to REQUIRED_SPECS"
  else
    echo "[post-merge] (optional spec not yet in tree, skipping) $spec"
  fi
done

echo "[post-merge] playwright discovery gate over: ${existing_specs[*]}"
pnpm exec playwright test \
  --config tests/e2e/playwright.config.ts \
  --list \
  "${existing_specs[@]}"

# Typecheck the seed scripts package so the gate catches type
# regressions in the fixtures the modal specs depend on. We
# deliberately do NOT typecheck @workspace/round-house or
# @workspace/api-server here — both currently carry pre-existing
# type errors outside the scope of this gate (#713) and adding
# them now would block every merge on unrelated tech debt. The
# Playwright `--list` step above already compiles the spec files
# themselves and any types they import from the modal/API.
pnpm --filter @workspace/scripts run typecheck

echo "[post-merge] PublicProfileModal CI gate passed"
