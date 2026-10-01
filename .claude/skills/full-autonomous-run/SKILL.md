---
name: full-autonomous-run
description: Use when the user provides a complete feature brief or GDD and requests an autonomous end-to-end run through planning, implementation, and verification with fixed safety gates.
---

# Skill: Full Autonomous Feature Pipeline

Orchestrate a new or complex feature from planning through implementation and verification without requiring manual intervention between ordinary steps, while enforcing the same fixed safety gates on every run.

**SAVES:** Removes the need to restate the Lead/Coder/Verifier orchestration instructions for each new task; invoke this skill once with the complete task attached.

**CÂND SE FOLOSEȘTE:** When the user provides a complete task, GDD, or brief and asks for an autonomous run from planning to verification without manual intermediate steps.

## Proces fix (nu se modifică între task-uri)

### Faza 1: Planificare

1. Use the role and process defined in `.claude/agents/lead.md`.
2. Read `.claude/rules.md` and the relevant gameplay/design context before planning. Treat the runtime code as the source of truth for implemented numeric behaviour; report contradictions with `.claude/rules.md` and stop if they affect the planned change.
3. Create `PLAN_<nume-task>.md` with atomic, numbered subtasks, explicit dependencies, likely files, acceptance criteria, and risks/edge cases. Cite the applicable rules in each subtask's risks.
4. Identify and label the technically riskiest subtask before implementation. This is the manual verification gate described below.

### Faza 2: Implementare

1. Use the role and limits defined in `.claude/agents/coder.md`.
2. Implement the plan's subtasks in dependency order. Before writing new code, inspect `.claude/skills/` for an applicable `SKILL.md` and reuse its project pattern.
3. Keep existing enemy immunities, weapon contracts, lifecycle behaviour, and performance caps intact. Do not increase particle, entity, or performance budgets without explicit user approval.
4. Mark each completed plan subtask with `[x] DONE`, recording the files changed and result.
5. After the designated highest-risk subtask, stop and request the user's visual/manual review. Do not implement dependent subtasks until the user confirms continuation.
6. At the end of Phase 2, run lint and build. If either fails and the cause is not clearly isolated, stop and report the failure; do not proceed to Phase 3 with an unexplained broken build.

### Faza 3: Verificare

Această fază rulează DOAR dacă userul specifică explicit "cu verificare" 
sau "run full" la invocarea skill-ului. Dacă userul invocă skill-ul fără 
această mențiune, Faza 3 este SĂRITĂ, iar skill-ul se consideră complet 
după Faza 2, cu mențiunea explicită în rezumatul final: 
"Faza 3 (Verificare) a fost omisă la cererea userului — rezultatele 
NU au fost validate independent."

1. Use the independent validation role defined in `.claude/agents/verifier.md`; do not rely only on the Coder's self-report.
2. Check every original task acceptance criterion point by point, including manual visual criteria where applicable.
3. Run the repository checks: `npm run lint` and `npm run build`. Report command results and any pre-existing or unrelated failure distinctly.
4. Create `VERIFICATION_<nume-task>.md` with a result for each criterion, using `✅` for pass and `❌` for fail or unverified. Include test/build evidence and remaining risks.

## Reguli de siguranță fixe

These gates apply to every task run with this skill and must not be weakened or skipped for an individual task.

Stop immediately, report the evidence, and wait for the user's decision if:

- The change would alter another existing system's enemy immunity, accepted damage, weapon behaviour, or gameplay contract. The new feature must integrate with those contracts rather than rewrite them.
- The implementation cannot fit within the existing particle, entity, or performance caps without increasing them. State the required increase and its impact; do not change a cap without approval.
- `.claude/rules.md` contradicts the runtime code on a system this task would modify. The runtime code is the implemented source of truth, but do not silently reconcile the documentation or change gameplay while executing this feature; report the exact conflict and wait.
- An explicit performance requirement in the original task (for example, a target FPS with a stated number of simultaneous entities) appears unrealistic for the existing architecture. Do not force an implementation; provide evidence and alternatives.
- Lint or build fails at the end of Phase 2 and the cause is not clearly isolated. Do not begin Phase 3 with an unexplained broken build.
- A required clarification, dependency, acceptance criterion, or source-of-truth decision is missing or contradictory enough to make safe implementation impossible.

### Oprire obligatorie pentru verificare manuală

After the highest-risk technical subtask identified by Lead is complete, stop before implementing dependent work. Summarise what was implemented and request a visual/manual check from the user. This gate is mandatory when the subtask introduces a rendering, physics, or algorithmic technique that does not already exist in the codebase. Continue only after explicit user confirmation.

## Rezumat la final sau la oprire

Report:

- which phases and subtasks are complete;
- files created or modified;
- lint/build and verification results available so far;
- safety warnings, unresolved contradictions, and the exact confirmation needed to continue.

## Cum se invocă acest skill

Attach the complete task (GDD or brief) and write:

> Folosește skill-ul `full-autonomous-run` pentru acest task: [task]
