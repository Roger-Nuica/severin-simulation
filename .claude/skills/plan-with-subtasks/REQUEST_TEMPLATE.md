# Task Brief for Planning

Complete the sections that matter to this task, then attach this file when invoking `plan-with-subtasks`. Paste the complete GDD or task description under **Task details**; do not rely on chat history that is not attached.

## Task name
[Short, distinctive name used for `PLAN_<task-name>.md`]

## Task details
[Paste the full feature brief, GDD, bug report, or requested behavior here. Include the original wording for all important requirements.]

## Goal
[What should be true when the task is complete?]

## Scope and non-goals
- In scope: [features/systems that may change]
- Out of scope: [systems or behavior that must remain untouched]

## Gameplay and numeric contracts
[List exact durations, ranges, cooldowns, costs, target interactions, damage/immunity rules, and caps. Write `Not specified in brief` where the Lead must investigate rather than guess.]

## Integrations and dependencies
[Related systems, modes, weapons, disasters, UI, audio, lifecycle, or other tasks that this feature affects.]

## Acceptance criteria
- [Observable criterion; include expected values or states]
- [Observable criterion]

## Performance and lifecycle expectations
[Target FPS/load, simultaneous entity/effect counts, pooling, reset/dispose expectations. Write `Not specified in brief` if none were given.]

## Validation requested
[Tests, lint/build, manual visual checks, browser/device scenarios, or specific performance checks.]

## Known decisions or unresolved questions
- Confirmed decisions: [decisions already approved]
- Open questions: [decisions the Lead must clarify before implementation]

## Planning instruction
Use `.claude/agents/lead.md` and `.claude/rules.md`. Inspect the relevant runtime code and `.claude/skills/` before writing the plan. Create ordered, atomic subtasks with dependencies, acceptance criteria, and rule citations in risks. Identify the riskiest technical subtask and required manual review gate. Do not implement code.
