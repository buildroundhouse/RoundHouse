# Dual-context screenshot helper

A small, reusable protocol for any e2e plan in this directory that
drives **two or more** Playwright browser contexts at once
(e.g. `privacy-toggle-end-to-end.test-plan.md`, where the toggler and
the chat counterpart are signed in side by side).

The goal is triage speed: when a multi-context plan flakes, a reviewer
should be able to scan a sibling `*.results.md`, see one screenshot
per context per labeled step, and instantly tell **which side**
rendered the wrong thing — without re-running the plan locally.

This file is a **convention spec**, not executable code; the project's
Playwright-driven UI testing subagent reads it the same way it reads
the plans. A plan opts in by linking to this helper from its own
"Screenshot capture" section (see the privacy-toggle plan for the
canonical example).

## Storage layout

All screenshots produced by an opted-in plan live under:

```
artifacts/round-house/e2e/screenshots/<plan-slug>/
```

`<plan-slug>` is the test-plan file's basename without the
`.test-plan.md` suffix. For
`privacy-toggle-end-to-end.test-plan.md` that is
`privacy-toggle-end-to-end`, but the file-name prefix used **inside**
each PNG drops the trailing `-end-to-end` so file names stay short
and match the task's requested convention
(`privacy-toggle-stepB-friend.png`).

The `screenshots/<plan-slug>/` directory is recreated empty at the
start of every run so a re-run never mixes evidence from a previous
run.

## File-name convention

```
<short-plan-slug>-step<sectionLabel>-<contextName>.png
```

- `<short-plan-slug>` — the human-friendly prefix declared by the
  plan in its "Screenshot capture" section
  (e.g. `privacy-toggle`).
- `<sectionLabel>` — the **section letter** the plan assigns to the
  step group (e.g. `A`, `B`, `C`...). Plans that opt in MUST tag
  every section with a single uppercase letter so the helper has a
  stable label to use; the privacy-toggle plan already does this
  (sections A–F).
  - When more than one screenshot is captured inside the same
    section (e.g. baseline + post-action), append a 1-based ordinal
    suffix: `stepC1`, `stepC2`. The plan owns ordering by listing
    capture points in the order it wants them filed.
- `<contextName>` — the short identifier the plan assigns to each
  browser context in its fixtures table. The privacy-toggle plan
  uses `standard` (the toggler) and `friend` (the chat counterpart).
  Plans MUST declare these short names alongside the env-var
  fixtures table so the file name is predictable from reading the
  plan alone.

Examples for the privacy-toggle plan:

```
privacy-toggle-stepA-standard.png   # baseline FullProfileModal
privacy-toggle-stepA-friend.png     # baseline inbox row + chat thread
privacy-toggle-stepB-standard.png   # toggle ON, save returned 200
privacy-toggle-stepB-friend.png     # friend's view at the same wall-clock moment
privacy-toggle-stepC-standard.png   # toggled-on FullProfileModal
privacy-toggle-stepD-friend.png     # toggled-on chat header + team-up-note caption
privacy-toggle-stepE-friend.png     # inbox row title is the negative guard
privacy-toggle-stepF1-standard.png  # toggle OFF, save returned 200
privacy-toggle-stepF2-standard.png  # FullProfileModal restored
privacy-toggle-stepF2-friend.png    # chat header + team-up-note caption restored
```

## When to capture

The runner should snapshot **both** contexts (one PNG per open
context, named per the convention above):

1. **On every `[Verify]` failure.** Capture every open context at
   the wall-clock moment the failing assertion is raised, before
   tearing the contexts down or running the always-run cleanup. This
   is the primary triage payload — a reviewer opening the sibling
   `*.results.md` should see at least one PNG per context for the
   failing section, which together pin down whether the regression
   is on the producer side (the toggler), the consumer side (the
   counterpart), or in transit (the API payload they both consume).
2. **At the end of each section that touches a UI surface that
   another context will read next**, even if the plan is passing.
   For the privacy-toggle plan this means the end of section B
   (the toggler just saved) and section F1 (the toggler just saved
   the rollback) — the friend's section D / F2 verifications depend
   on the friend's UI re-fetching from the API the toggler just
   wrote, and a paired snapshot proves both sides agree.
3. **At the end of the run regardless of pass/fail**, capture the
   "final state" of every open context. This makes the sibling
   `*.results.md` useful as a record even on green runs ("here's
   what `Standard E2E F.` looks like in the chat header on the
   friend's side after section D"), and removes the need to re-run
   the plan just to grab a passing-state visual.

The helper deliberately does NOT prescribe a snapshot-per-individual-
step. That would balloon the screenshot count without proportional
triage value; the failing-step + section-boundary + final-state
combination is enough to localize any regression this plan catches.

## How to capture (Playwright specifics)

The runner already drives Playwright contexts directly. For each
open context `ctx` at a capture point:

1. Pick the context's most relevant page (the one most recently
   navigated by the plan; if the context only has one page, use
   that).
2. Wait for any in-flight network request to settle so the screenshot
   reflects the rendered state, not a transient skeleton.
3. Take a full-page PNG (`page.screenshot({ path, fullPage: true })`)
   into the path computed by the convention above.
4. Append a row to the run's results-file table with the relative
   path so reviewers can click straight through (see "Results file
   shape" below).

If a screenshot fails to write (disk error, context already closed,
etc.), the helper records a `(missing)` row in the results file
instead of swallowing the failure silently — the absence is itself
useful triage signal.

## Results file shape

Each opted-in plan ships a sibling `<plan-slug>.results.md` that
follows the layout of `my-team-tab-message.results.md` (header,
summary table, browser-driven evidence per case, repo-changes
table, follow-ups), with one extra section near the top:

```markdown
## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/<plan-slug>/`

| Section | Standard context | Friend context | Notes |
| --- | --- | --- | --- |
| A baseline | ![](./screenshots/<plan-slug>/<short>-stepA-standard.png) | ![](./screenshots/<plan-slug>/<short>-stepA-friend.png) | Baseline strings before the toggle. |
| ... | ... | ... | ... |
```

Renderers that strip image embeds still resolve the link text to a
clickable path, so this works in both rich and plain markdown
viewers. Plans that drive contexts with names other than
`standard` / `friend` should rename the columns to match.

## Adding more contexts later

If a future plan opens a third context (say a company-admin observer),
add a third short name to its fixtures table and a third column to
its results-file screenshot table. The file-name convention scales
by appending the new context name; nothing about steps 1 / 2 / 3 of
"When to capture" changes.

## Single-context variant

A slim variant for plans that drive **only one** Playwright context
but still benefit from per-section visual evidence
(e.g. `logs-tab.test-plan.md`, `reminders.test-plan.md`,
`personal-profile-editor.test-plan.md`). Most single-context plans do
NOT need this — they assert text / accessible-name / URL whose failure
mode is already clear from the Playwright trace, and a screenshot adds
little triage value over re-running locally. Use the variant only
when:

- the plan has multiple discrete UI states a reviewer would want to
  see at a glance ("did the tab bar regress to a floating capture
  FAB?", "did the `Reminded again` pill actually render?", "did the
  editor open with raw vs overlay values?"), AND
- the cost of one PNG per state is small relative to the run length.

The dual-context helper above (with its `<contextName>` suffix and
paired results table) deliberately does not apply: there is no second
context to disambiguate against, so the paired layout would be empty
columns and noise.

### Storage and naming

Same `screenshots/<plan-slug>/` directory as the dual-context flow,
recreated empty per run. File names drop the `-<contextName>` suffix
because there is only one context:

```
<short-plan-slug>-<sectionLabel>.png
```

`<sectionLabel>` is a short kebab-case slug the plan declares in its
"Screenshot capture (single-context)" section (e.g. `tab-bar`,
`populated`, `reminded-again`). Plans whose sections are already
lettered MAY prefix the slug with the section letter so the file name
preserves their existing ordering — the personal-profile-editor plan
does this with `A-reads-raw`, `B-edited`, `C-after-reload`,
`D-cross-account`, `E-error`. A bare single letter (`A.png`) is also
fine if the plan has nothing more descriptive to say; the only hard
requirement is that the runner can derive every label from reading
the plan's Screenshot capture table top-to-bottom.

On a `[Verify]` failure, prefix the slug with `fail-` so failure
evidence sorts above the green-run captures in the directory listing
(`<short-plan-slug>-fail-<sectionLabel>.png`). Use the section label
of the next planned capture point — i.e. the label of the section the
failing `[Verify]` belongs to. If the failure happens before any
labeled capture point in the plan (e.g. during sign-in or fixture
setup, when no `<sectionLabel>` has been entered yet), use the
literal label `setup` (`<short-plan-slug>-fail-setup.png`) so the
file name is still derivable from the plan + helper alone.

### When to capture

1. **At the end of every section the plan lists as a capture point.**
   The plan owns the list — it should pick states a reviewer would
   want to see (empty state, populated list, error message, composer
   open, etc.), not every individual step.
2. **On every `[Verify]` failure**, capture the single open context
   at the moment the assertion fails, before tearing the context down
   or running cleanup. Use the `fail-` prefix above.
3. The dual-context rule of "snapshot at section boundaries that
   another context will read next" does NOT apply (there is no second
   context to read it).
4. The dual-context rule of "final-state regardless of pass/fail"
   does NOT apply either; the per-section captures from rule 1
   already cover the final visible state.

### Results file shape

Single-context opt-ins do NOT require a sibling `*.results.md`
template — these plans have historically not shipped one and the
audit below does not change that. If a particular run is captured
into a results file (e.g. because it caught a regression worth
recording), add a "Per-step screenshots" section with **one** column
instead of two:

```markdown
## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/<plan-slug>/`

| Section | Screenshot | Notes |
| --- | --- | --- |
| tab-bar | ![](./screenshots/<plan-slug>/<short>-tab-bar.png) | Five-tab bottom bar with Logs in the middle. |
| ... | ... | ... |
```

## Audit: single-context plans (April 2026)

This audit is recorded here so the next reviewer doesn't have to
re-run the same exercise. Eleven single-context plans were reviewed
against the "discrete visual states worth a PNG" bar above. They fall
into two buckets:

### Opted in to the slim variant

| Plan | Why a per-section PNG helps |
| --- | --- |
| `logs-tab.test-plan.md` | Five-tab bar shape (the regression this plan is *for* — center FAB returning), picker sheets, and composer pre-assignment are visual states the trace text alone can't convey at a glance. |
| `reminders.test-plan.md` | UPCOMING vs COMPLETED sections, snooze-driven re-sort, and the `Reminded again` pill are discrete visual artifacts that fail in subtly-different ways (pill missing vs pill leaking into every row). |
| `personal-profile-editor.test-plan.md` | Already lettered A–E. One PNG per section proves at a glance that the editor read raw vs overlay values, and that the `Invalid email address` error rendered without mutating the row. |

Each of those plans carries its own
"Screenshot capture (single-context)" section listing the section
labels it ships and what each PNG covers; the runner reads those
section blocks the same way it reads the dual-context "Screenshot
capture" section in `privacy-toggle-end-to-end.test-plan.md`.

### Explicitly opted out (existing blockquote stays)

These plans assert text / accessible-name / URL whose failure mode is
already obvious from the Playwright trace; a per-section PNG would
roughly double the artifact storage with no proportional triage win:

- `avatar-start-over.test-plan.md` — onboarding picker → intake →
  start-over confirm. Failure modes are URL/dialog assertions and a
  re-tappable tile; the trace text already pins them down.
- `cadence-toggle.test-plan.md` — flip a radio group, watch the row
  re-sort between two named sub-buckets. The list-position assertion
  is text-driven.
- `finder-operator-skin-connect.test-plan.md` — search row → modal
  with company chip. The chip is asserted by text content, and the
  modal hero is already covered by the picked-skin avatar/banner
  plans next door.
- `ignore-team-up-request.test-plan.md` — three-button row +
  auto-dismissing banner. The banner copy is asserted by text and
  the row's persistence is asserted by accessible name.
- `picked-skin-avatar-swap.test-plan.md` /
  `picked-skin-banner-swap.test-plan.md` — assert path-token
  substrings inside the rendered `<img src>`. The synthetic
  `/objects/uploads/picked-skin-e2e-*` tokens never resolve to real
  bytes, so a PNG would just show a broken-image placeholder.
- `privacy-preview-hint.test-plan.md` — a hint either renders below
  the name or it doesn't; the assertion is on accessible name and
  the deep-link target.
- `reminders-side-tab.test-plan.md` — pure navigation: tap the
  `Open reminders` side-tab, land on `/reminders`. The reminders
  screen visuals themselves are covered by `reminders.test-plan.md`
  (which IS opted in).

If a future regression on one of these plans turns out to be hard to
triage from the trace alone, revisit this audit and consider
promoting the offending plan into the opted-in bucket.
