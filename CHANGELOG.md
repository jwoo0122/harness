# Changelog

## Unreleased

### Added
- `EMP` as a first-class `/explore` persona alongside `OPT / PRA / SKP`
- flat `agents/` directory with one Markdown prompt body per shipped subagent (`OPT`, `PRA`, `SKP`, `EMP`, `PLN`, `IMP`, `VER`)

### Changed
- the extension now loads canonical explore/execute subagent prompt bodies from `agents/*.md`
- prompt loading and explore/execute prompt builders have been extracted from `extensions/index.ts` into `extensions/agent-prompts.ts`
- bash-policy classification helpers have been extracted from `extensions/index.ts` into `extensions/bash-policy.ts`
- verification registry storage types and file I/O have been extracted from `extensions/index.ts` into `extensions/verification-registry.ts`
- live subagent progress no longer renders in a separate widget; it now stays inside the subagent tool call with one line per subagent
- `/explore`, docs, and prompt templates now reference the four-persona debate shape
- `/explore` and `/execute` are now one-shot protocol runs instead of persistent mode switches; the extension routes skill invocations without changing long-lived agent mode state

## 0.2.0 - 2026-04-18

### Added
- `harness_subagents` as the generic isolated subprocess orchestration tool
- shipped prompt templates in `prompts/debate.md` and `prompts/ac-check.md`
- package `files` manifest for cleaner release contents

### Changed
- clarified the architecture: `/explore` and `/execute` are protocols built on top of a generic subagent runtime
- simplified TUI behavior so the widget appears only while a subagent batch is running
- updated README, INTEGRATION guide, and skill docs to document the generic runtime model
- bumped package version to `0.2.0`

### Compatibility
- `harness_explore_subagents` and `harness_execute_subagents` remain temporarily as compatibility aliases
- new integrations should prefer `harness_subagents`
