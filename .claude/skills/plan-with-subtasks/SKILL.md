---
name: plan-with-subtasks
description: Use when the user attaches a feature brief, GDD, or task details and wants the Lead subagent to create an implementation-ready plan with ordered subtasks, dependencies, risks, and acceptance criteria.
---

# Skill: Plan with Subtasks

Turn the user's attached task details into a repository-grounded implementation plan by delegating planning to the existing Lead subagent. This skill creates a plan only; it does not implement production code or start the Coder.

**SAVES:** Replaces repeated instructions for decomposing a feature brief into safe, ordered, dependency-aware subtasks.

**WHEN TO USE:** When the user provides a GDD, feature brief, or detailed task and asks for a plan, implementation breakdown, or ordered subtasks.

**SOURCE:** `.claude/agents/lead.md`; `.claude/rules.md`; `.claude/skills/`; `GAME_DESIGN.md`; runtime code under `src/app/tornado/engine/`; the user's attached task details.

## Input

- Use the user's attached brief as the task source. The user may fill in and attach `REQUEST_TEMPLATE.md` from this skill directory, or provide their own equivalent brief.
- Do not replace missing task requirements with guesses. If the brief leaves a safety-critical behavior, numeric value, acceptance criterion, or integration unclear, the Lead must ask focused clarifying questions and wait before finalizing the plan.
- Use the exact plan path/name supplied by the user if present. Otherwise ask Lead to create `PLAN_<task-slug>.md` in the repository root.

## Fixed process

1. Read `.claude/agents/lead.md`, `.claude/rules.md`, and the attached task details.
2. Delegate the planning work to the repository's `lead` subagent. Instruct it to inspect the relevant runtime owners, docs, and skills before writing the plan. Do not impersonate the Lead or write implementation code.
3. Require a plan containing:
   - Goal and scope, including non-goals when the brief states them.
   - Clarifications needed; use `None` only after checking the brief and relevant sources.
   - Numbered, atomic subtasks with explicit dependencies and likely files.
   - Acceptance criteria traceable to the original brief.
   - Risks/edge cases citing the relevant `.claude/rules.md` rule IDs and applicable skill paths.
   - A named highest-risk technical subtask and the manual review gate required by `.claude/skills/full-autonomous-run/SKILL.md` when a new rendering, physics, algorithmic, or similarly stateful technique is involved.
   - A validation approach appropriate to the task (focused checks, lint/build, and manual visual review if applicable).
4. Ask Lead to verify numeric contracts against the runtime code. Treat runtime code as the source of truth for implemented behavior; report any conflict with `.claude/rules.md` or `GAME_DESIGN.md` rather than silently changing gameplay or choosing an undocumented design value.
5. Check the generated plan for dependency order, scope boundaries, rule citations, and coverage of every acceptance criterion. If it omits any of these, return the plan to Lead for revision; do not pass it to Coder yet.
6. Return the plan path and a concise planning summary to the user. Do not launch Coder or Verifier unless the user separately requests the corresponding workflow.

## Safety gates

- Planning must not modify runtime code.
- Do not approve a plan that silently changes existing damage acceptance, enemy immunity, weapon behavior, protected numeric contracts, or global performance caps.
- If a proposed task requires raising particle/entity/performance caps, flag the required change and its evidence for user approval; do not treat the increase as an ordinary subtask.
- If source code and documentation conflict on a system in scope, record the exact code/docs evidence and block the plan on the user's decision where the intended behavior is ambiguous.
- Keep subtasks small enough for the Coder agent in `.claude/agents/coder.md` to implement individually. Reuse an applicable skill from `.claude/skills/` rather than planning a replacement subsystem without evidence.
- Follow the fixed gates in `.claude/skills/full-autonomous-run/SKILL.md` for any plan intended for autonomous execution.

## Text de invocare

Attach the completed request template or your own task brief, then write:

> Use the `plan-with-subtasks` skill for the attached brief. Call the Lead subagent as defined in `.claude/agents/lead.md` and create a plan with atomic subtasks, explicit dependencies, acceptance criteria and risks that reference the relevant rules. Do not implement code.
