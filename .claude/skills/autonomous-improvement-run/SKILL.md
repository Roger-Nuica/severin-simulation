---
name: autonomous-improvement-run
description: Use when running the guarded improvement pipeline (Scout, Reviewer, Planner, optionally one Coder subtask) on this repository, normally from the claude-autonomous-improvement workflow; proposes five improvements, selects one, plans it and may implement its first subtask.
---

# Skill: Autonomous Improvement Run

Discovers, prioritises and plans one relevant improvement, and only when every safety condition holds, implements the first dependency-ready subtask of that plan. It coordinates four roles in strict sequence. It does not replace `.claude/agents/coder.md` and it never widens scope.

**WHEN TO USE:** A human (or the `claude-autonomous-improvement` workflow) asks for a repository-wide improvement run rather than the implementation of an already chosen plan. For an existing approved plan, use `coder-plan-run` instead.

## Roles

| Stage | Role | Definition |
|---|---|---|
| 1 | Scout | `.claude/agents/improvement-scout.md` |
| 2 | Reviewer | `.claude/agents/improvement-reviewer.md` |
| 3 | Planner | `.claude/agents/improvement-planner.md` |
| 4 | Coder | `.claude/agents/coder.md` |
| 5 | Report | this skill |

Adopt one role at a time. Finish and write the stage's artifact to disk before starting the next stage. A later role must read the earlier artifact from disk, not rely on memory of it. A role must not do another role's work: the Scout does not rank, the Reviewer does not plan, the Planner does not edit source.

## Run modes

| Mode | Stages run | Source edits |
|---|---|---|
| `propose_only` | 1, 2, 5 | none |
| `plan_only` | 1, 2, 3, 5 | none |
| `plan_and_implement_one_subtask` | 1, 2, 3, 4 (conditional), 5 | one subtask, only when allowed (below) |

The run prompt states the effective mode and whether implementation is permitted. If implementation is not permitted, behave as `plan_only` regardless of the requested mode. A workflow step re-checks the result and reverts anything outside the permitted paths; do not rely on that as permission.

## Required reading before Stage 1

1. `CLAUDE.md`, `.claude/rules.md` and the nearest `docs/*.md`.
2. Every `PLAN_*.md` in the repository root, to learn what is already planned, done, blocked or awaiting approval.
3. `package.json` scripts and the `tests/` directory.

Runtime code is the source of truth for implemented behaviour. Report contradictions between `.claude/rules.md` and the code; do not reconcile them silently.

## Stage 1: Scout (discover)

Produce exactly five candidates, each repository-specific and evidenced by file paths and line references or quoted text. Sources: existing plans, TODO/FIXME comments, runtime code, tests and missing tests, documentation drift, lint or build warnings, performance notes in `FINDINGS.md` and `docs/performance.md`, and obvious technical debt. If an optional focus is given, bias towards it without ignoring a clearly more important problem; say so if you do.

Write `docs/auto-improvements/run-<run_id>-<attempt>.md` section "Stage 1: candidates" (format below). Do not rank.

## Stage 2: Reviewer (prioritise)

Read the Stage 1 section from disk. Score each candidate 1 to 5 on every rubric criterion and select exactly one, or select none if no candidate is safe and relevant.

### Selection rubric

| Criterion | Question |
|---|---|
| User impact | Does a player or developer notice the improvement? |
| Correctness and reliability | Does it fix or prevent wrong behaviour, crashes, leaks or lifecycle faults? |
| Security | Does it reduce a real exposure? |
| Maintainability | Does it reduce the cost of future change? |
| Plan fit | Does it advance an existing checked-in plan, or follow its conventions? |
| Implementation risk | How likely is it to break a protected contract? (5 = very low risk) |
| Effort | How large is it? (5 = small) |
| Decision readiness | Is it free of open product decisions, approvals, manual testing and external credentials? (5 = fully ready) |

Rules:
- Do not choose a candidate because it is easy. Effort and risk break ties; they never outweigh impact, correctness or security.
- Prefer a dependency-ready subtask of an existing approved plan over invented work, unless the plan is blocked or the invented work is clearly more important. State the reason when you depart from this.
- Explicitly reject or defer any candidate that needs an unresolved product decision, user approval, manual or visual testing, or external credentials. Say which.
- A candidate that is attractive but gated may still be selected for planning (so that its gates are written down), but the report must then end in `NEEDS_APPROVAL`, not implementation.
- For each of the other four, record one line: rejected or deferred, and why.

Append "Stage 2: review" to the report file.

## Stage 3: Planner (plan)

Skipped in `propose_only`. Read Stage 1 and 2 from disk and the selected candidate's evidence.

- If the selection is a subtask of an existing plan, do not create a duplicate plan. Check that subtask's dependencies, approval gates and acceptance criteria, record the result in the report, and use that plan path.
- Otherwise create `PLAN_auto-improvement-<run_id>-<attempt>.md` in the repository root.

Plan requirements (so the existing workflow parsers can read it):
- Heading per subtask, exactly: `- [ ] **Subtask N: Title**`, with N a positive integer in order.
- Beneath it, indented, `- Depends on: none.` or `- Depends on: 1, 2.`, plus Objective, Likely files, Acceptance criteria, Validation, Risks / edge cases (cite `.claude/rules.md` rule IDs), and Rollback notes where the change is not a pure revert.
- A "Decision and approval gates" section listing every open question with a proposed default, and which subtasks it blocks.
- A "Validation" statement per subtask separating automated checks (`npm run lint`, `npm run build`, `npm test`, a named test file) from manual checks.
- Mark manual, visual, browser, production or security checks as **not performed**. Never write that one was performed unless this run actually performed it. This headless run cannot perform browser or visual checks.
- Label the technically riskiest subtask.
- Subtasks are atomic: one implementable change each, with the first subtask free of unresolved gates if the plan is meant to be executable.

Append "Stage 3: plan" (path and a short summary) to the report file.

## Stage 4: Coder (implement one subtask, conditional)

Run only when ALL of the following hold; otherwise skip and record why:

1. Implementation is permitted for this run.
2. A plan exists and its first incomplete subtask has every dependency complete.
3. That subtask has no unresolved decision, approval, manual-test or credential gate, and its acceptance criteria are automated or inspectable by reading code.
4. The subtask is low risk: it matches none of the never-automatic categories below and none of the safety gates in `.claude/skills/full-autonomous-run/SKILL.md`.
5. It is not the plan's flagged highest-risk subtask when that subtask needs a manual review gate.

Then follow `.claude/agents/coder.md` and `.claude/skills/coder-plan-run/SKILL.md` for that single subtask. Implement exactly one subtask. Run the narrowest focused check, then `npm run lint` and `npm run build`. Mark the subtask `- [x] DONE` in the plan only after its acceptance criteria and those checks pass, and record files changed and result in 3 to 4 bullets. Do not start a second subtask under any circumstance.

If lint or build fails and the cause is not clearly isolated and fixed within the subtask's own scope, un-mark the subtask, report the exact failure, and stop.

### Never automatic

Generate the proposal and plan, but do not implement. Set `NEEDS_APPROVAL` or `BLOCKED`, for:
- manual-only checks as the acceptance criterion, or anything needing a browser, visual or audio judgement;
- production, deployment or hosting changes;
- destructive migrations or data deletion;
- credential, secret or environment-variable changes;
- billing or payment changes;
- authentication or authorisation changes;
- broad architectural rewrites or changes to the lifecycle or `ctx.systems` registration model;
- raising any particle, entity, draw-call or performance cap;
- changing an enemy immunity, accepted-damage or weapon contract, or a protected value in `.claude/rules.md`;
- edits to `.github/`, `.claude/`, `package.json`, `package-lock.json` or any `.env*` file.

## Stage 5: Report

Write both artifacts.

### `STATUS_AUTO_RUN.md` (repository root, overwritten each run)

Begin with these exact `key: value` lines, one per line, no bullets, no bold, because a workflow step parses them:

```
Run mode: <effective mode>
Status: <DONE | STOPPED | BLOCKED | NEEDS_APPROVAL>
Plan path: <PLAN_*.md or none>
Implemented subtask: <number or none>
Report path: docs/auto-improvements/run-<run_id>-<attempt>.md
```

Then, in British English: Selected candidate; Prioritisation rationale; the five candidate titles; Changed files; Commands and checks run, each with its outcome; Decisions and approvals still needed (every one, or "none"). Status meanings: `DONE` means the stages for this mode completed and, if a subtask was implemented, its checks passed; `NEEDS_APPROVAL` means a decision or approval is required before safe work can continue; `BLOCKED` means a failure or conflict prevents progress; `STOPPED` means the run ended early without a failure to report.

### `docs/auto-improvements/run-<run_id>-<attempt>.md` (new file per run, never overwrite another run's)

Sections, in order: Run details (run ID, mode, focus, date); Stage 1 candidates (five, each with title, evidence, why it matters, risk, gates); Stage 2 review (scores table, selection, the four deferrals); Stage 3 plan (path, summary, gates); Stage 4 implementation (subtask or "not run" with reason); Checks (commands, outcomes, "not performed" items); Decisions and approvals needed; Status.

## Stopping conditions

Stop, record the evidence in the report and set the status, when:
- fewer or more than five distinct candidates can be evidenced (report what was found; do not invent filler);
- no candidate is safe and relevant to select;
- a plan subtask or its dependency is ambiguous, missing or contradictory;
- `.claude/rules.md` contradicts runtime code on a system the work would modify;
- any fixed safety gate in `.claude/skills/full-autonomous-run/SKILL.md` applies;
- lint or build fails without an isolated cause;
- an unexpected edit outside the permitted paths would be needed.

## Honesty rules

- Do not claim a browser, visual, audio, production, security or manual check you did not perform.
- Report command outcomes exactly, including failures and warnings.
- Do not run `git commit`, `git push`, `gh` or any network command. The workflow commits and opens the pull request.
- Use British English in documentation and reports.
