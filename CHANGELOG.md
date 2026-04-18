# Changelog

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
