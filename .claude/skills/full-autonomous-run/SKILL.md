---
name: full-autonomous-run
description: Use when the user provides a complete feature brief or GDD and requests an autonomous end-to-end run through planning, implementation, and verification with fixed safety gates.
---

# Skill: Full Autonomous Feature Pipeline

Orchestrate a new or complex feature from planning through implementation and verification without requiring manual intervention between ordinary steps, while enforcing the same fixed safety gates on every run.

**SAVES:** Removes the need to restate the Lead/Coder/Verifier orchestration instructions for each new task; invoke this skill once with the complete task attached.

**WHEN TO USE:** When the user provides a complete task, GDD, or brief and asks for an autonomous run from planning to verification without manual intermediate steps.

## Fixed process (does not change between tasks)

### Phase 1: Planning

1. Use the role and process defined in `.claude/agents/lead.md`.
2. Read `.claude/rules.md` and the relevant gameplay/design context before planning. Treat the runtime code as the source of truth for implemented numeric behaviour; report contradictions with `.claude/rules.md` and stop if they affect the planned change.
3. Create `PLAN_<nume-task>.md` with atomic, numbered subtasks, explicit dependencies, likely files, acceptance criteria, and risks/edge cases. Cite the applicable rules in each subtask's risks.
4. Identify and label the technically riskiest subtask before implementation. This is the manual verification gate described below.

### Phase 2: Implementation

1. Use the role and limits defined in `.claude/agents/coder.md`.
2. Read `.claude/rules.md` in full the first time a subtask is prepared in this run. For every subsequent subtask in the same run, cite only the specific rule IDs relevant to that subtask instead of re-reading the whole file — unless the subtask touches a system not yet covered by rules already reviewed in this run, in which case re-check the full file for that system.
2a. Classify each dependency-ready subtask as **low-risk** or **requires separate agent** before dispatching. A subtask is low-risk only if ALL of the following hold: it involves no new design decision or implementation choice (e.g., renaming, file moves, mechanical refactors, trivial wiring, simple test additions); it does not touch any system covered by the fixed safety gates below (immunities, weapon/damage contracts, performance/particle/entity caps); and it has no branching outcome that could affect later subtasks. Consecutive low-risk subtasks may be implemented within a single Coder agent invocation, provided each one is still completed, checked, and marked in the plan individually, in dependency order. Any subtask carrying real risk, a design choice, or a new technique without an existing project analogue must still be dispatched as its own separate agent call — never batched.
3. Keep existing enemy immunities, weapon contracts, lifecycle behaviour, and performance caps intact. Do not increase particle, entity, or performance budgets without explicit user approval.
4. Implement the plan's subtasks in dependency order. Before writing new code, inspect `.claude/skills/` for an applicable `SKILL.md` and reuse its project pattern.
5. Mark each completed plan subtask with `[x] DONE`, recording the files changed and result. Keep the per-subtask completion note to 3-4 bullet points maximum: files changed, what was implemented, checks run and their result, and any open concern. Do not restate the subtask description or produce long explanatory paragraphs per subtask. The final end-of-run summary required at the end of this skill may remain fuller, since it is produced only once per run.
6. After the designated highest-risk subtask, stop and request the user's visual/manual review. Do not implement dependent subtasks until the user confirms continuation.
7. At the end of Phase 2, run lint and build. If either fails and the cause is not clearly isolated, stop and report the failure; do not proceed to Phase 3 with an unexplained broken build.

### Phase 3: Verification

This phase runs ONLY if the user explicitly says "with verification"
or "run full" when invoking the skill. If the user invokes the skill without
that mention, Phase 3 is SKIPPED and the skill is considered complete
after Phase 2, with an explicit note in the final summary:
"Phase 3 (Verification) was skipped at the user's request — the results
have NOT been independently validated."

1. Use the independent validation role defined in `.claude/agents/verifier.md`; do not rely only on the Coder's self-report.
2. Check every original task acceptance criterion point by point, including manual visual criteria where applicable.
3. Run the repository checks: `npm run lint` and `npm run build`. Report command results and any pre-existing or unrelated failure distinctly.
4. Create `VERIFICATION_<nume-task>.md` with a result for each criterion, using `✅` for pass and `❌` for fail or unverified. Include test/build evidence and remaining risks.

## Fixed safety rules

These gates apply to every task run with this skill and must not be weakened or skipped for an individual task.

Stop immediately, report the evidence, and wait for the user's decision if:

- The change would alter another existing system's enemy immunity, accepted damage, weapon behaviour, or gameplay contract. The new feature must integrate with those contracts rather than rewrite them.
- The implementation cannot fit within the existing particle, entity, or performance caps without increasing them. State the required increase and its impact; do not change a cap without approval.
- `.claude/rules.md` contradicts the runtime code on a system this task would modify. The runtime code is the implemented source of truth, but do not silently reconcile the documentation or change gameplay while executing this feature; report the exact conflict and wait.
- An explicit performance requirement in the original task (for example, a target FPS with a stated number of simultaneous entities) appears unrealistic for the existing architecture. Do not force an implementation; provide evidence and alternatives.
- Lint or build fails at the end of Phase 2 and the cause is not clearly isolated. Do not begin Phase 3 with an unexplained broken build.
- A required clarification, dependency, acceptance criterion, or source-of-truth decision is missing or contradictory enough to make safe implementation impossible.

### Mandatory stop for manual verification

After the highest-risk technical subtask identified by Lead is complete, stop before implementing dependent work. Summarise what was implemented and request a visual/manual check from the user. This gate is mandatory when the subtask introduces a rendering, physics, or algorithmic technique that does not already exist in the codebase. Continue only after explicit user confirmation.

Low-risk and batched subtasks may proceed continuously without pausing for confirmation after each one. This does not weaken or delay the mandatory stop defined above: the stop for the plan's flagged highest-risk subtask, or any subtask matching the fixed safety gates, always applies in full, regardless of batching or auto mode.

## Summary at the end or on stopping

Report:

- which phases and subtasks are complete;
- files created or modified;
- lint/build and verification results available so far;
- safety warnings, unresolved contradictions, and the exact confirmation needed to continue.

## How to invoke this skill

Attach the complete task (GDD or brief) and write:

> Use the `full-autonomous-run` skill for this task: [task]
