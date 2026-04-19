# Subagent Definitions

Canonical subagent prompt bodies loaded by the harness extension at runtime.

The directory is intentionally flat:
- explore personas: `OPT.md`, `PRA.md`, `SKP.md`, `EMP.md`
- execute roles: `PLN.md`, `IMP.md`, `VER.md`

Skills already know which persona or role to load, so nested folders are unnecessary.
The extension keeps orchestration, tool policy, and sequencing in code.
These Markdown files hold the per-subagent behavioral prompt so personas and roles can evolve without packing every instruction into `SKILL.md`.
