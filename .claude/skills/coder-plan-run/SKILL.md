---
name: coder-plan-run
description: Use when the user asks to run the Coder agent on an existing approved plan, implementing its subtasks sequentially while preserving repository safety gates.
---

# Skill: Coder Plan Run

Runs the repository's Coder agent against one approved, implementation-ready plan, one dependency-ready subtask at a time. It coordinates execution; it does not replace the Coder role or authorize scope changes.

**SAVES:** Replaces repeated instructions for invoking Coder and processing plan subtasks in dependency order.

**WHEN TO USE:** When the user names a plan such as `PLAN_katana.md` and asks to implement its subtasks using `.claude/agents/coder.md`.

## Fixed process

### 1. Select and verify the plan

- Use the exact plan path named by the user. Do not guess between multiple plans.
- Confirm it exists and contains approved, numbered subtasks with `- [ ]` / `- [x]` status, dependencies, and risks/edge cases.
- A task brief or GDD without an implementation checklist is not an approved Coder plan. Stop and ask for a Lead-created/decomposed plan; do not let Coder invent the plan.
- Do not reimplement completed subtasks. Select the earliest incomplete subtask whose dependencies are complete.

### 2. Prepare a subtask for the Coder

Before invoking the Coder agent:

1. Read the exact subtask, its dependency status, acceptance criteria, and risks from the plan.
2. Read `.claude/rules.md` and cite applicable rule IDs when briefing Coder.
3. Check `.claude/skills/` for an applicable `SKILL.md`; include its path and require Coder to follow its documented project pattern.
4. Verify protected numeric values in the runtime implementation. Treat runtime code as the source of truth; if it conflicts with `.claude/rules.md` on the system being changed, stop and report the exact conflict before implementation.
5. Brief the agent defined in `.claude/agents/coder.md` to implement exactly this one subtask, preserve scope, run the narrowest relevant check, and update the plan with completion status and files changed.

Apply the batching, rules-citation, and reporting-length rules defined in `.claude/skills/full-autonomous-run/SKILL.md` (Phase 2) when dispatching each subtask here. Batching never applies to the plan's flagged highest-risk subtask or to any subtask matching the fixed safety gates — those are always dispatched individually and always trigger the mandatory stop.

Do not dispatch independent subtasks concurrently. Run them in plan order, respecting dependencies and keeping each Coder assignment to one subtask.

### 3. Confirm the subtask result

After Coder returns:

- Check the reported files and outcome against the assigned subtask and plan acceptance criteria.
- Confirm the plan marks only the completed subtask `[x] DONE` and records changed files/result.
- If the result fails its focused check, return the same subtask to Coder for correction; do not advance to dependent work.
- Advance to the next dependency-ready incomplete subtask only after the current one is complete.

## Fixed safety guards

Apply the safety rules in `.claude/skills/full-autonomous-run/SKILL.md` to every Coder run. They are fixed and cannot be weakened for a specific plan. In particular, stop and wait for the user's decision if:

- the feature would rewrite an existing enemy immunity, damage-acceptance, weapon, or gameplay contract instead of integrating with it;
- implementation requires raising particle, entity, or performance caps;
- `.claude/rules.md` conflicts with runtime code for a system being modified;
- an explicit performance target appears unrealistic for the current architecture;
- a required dependency, acceptance criterion, or approved subtask is ambiguous or missing;
- a build or lint failure has no clearly isolated cause.

### Mandatory stop after the highest-risk subtask

Use the highest-risk subtask identified by Lead. After Coder completes that subtask, stop before implementing dependent subtasks and request the user's visual/manual review. This is mandatory for a new rendering, physics, or algorithmic technique without an existing project analogue. Continue only after the user explicitly confirms.

## Verification and wrap-up

This skill runs Coder implementation, not an independent Verifier phase. Do not claim independent verification unless the user explicitly requests the Verifier or invokes the full pipeline. Require the Coder to run a focused check after each subtask; report which checks ran and which plan items remain.

At completion or any safety stop, summarize completed and pending subtasks, files changed, checks performed, warnings, and the exact user decision needed to continue.

## How to invoke

> Use the `coder-plan-run` skill for `PLAN_katana.md`: implement the approved subtasks in order with the Coder agent.
