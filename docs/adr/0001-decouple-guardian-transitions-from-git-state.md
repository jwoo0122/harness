# Decouple Guardian transitions from Git state

## Status

Accepted

## Context

Guardian currently treats a user-created commit or Git state as an advancement prerequisite, which blocks otherwise evidenced workflows and prevents autonomous agent operation.

## Decision

Guardian transitions will evaluate approval, verification, and other non-Git evidence only. hrn may use Git autonomously when useful, but no commit, HEAD state, clean working tree, or Git repository availability may be required to advance the workflow.

## Consequences

Workflows can progress with uncommitted changes or outside Git repositories. Existing non-Git evidence gates remain mandatory. Git operations must be optional workflow actions rather than Guardian prerequisites.
