# Persist the requirements question backlog explicitly

## Status

Accepted

## Context

Harness must prevent planning while unresolved questions remain and continuously provide remaining questions to the agent. Inferring this state from conversation would be non-deterministic and not reliably enforceable. The current Guardian can intercept tools but cannot intercept arbitrary natural-language assistant output, so it cannot technically block an unregistered question emitted as plain text.

## Decision

Store the question backlog as explicit, persistent workflow state. Require it for refinement-to-planning transition checks, expose it in agent context, and use runtime guidance plus the backlog-update tool to direct agents to ask only registered questions. Existing v2 intake or refinement workflows without the field initialize it on their first backlog update; existing planning and later workflows remain valid without migration.

## Consequences

The state schema and transition APIs gain maintenance overhead, while planning gates and remaining-question context become deterministic and testable. Registered-question compliance is prompt- and tool-level rather than a hard runtime boundary for arbitrary assistant text.
