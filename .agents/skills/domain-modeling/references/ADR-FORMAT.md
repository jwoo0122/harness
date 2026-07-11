# ADR format

ADRs live under `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, and so on. Scan the directory for the highest existing number and increment it; never reuse a number.

## Minimal template

```md
# {Short title of the decision}

{One to three sentences: what was the context, what did we decide, and why?}
```

The value is recording that a decision was made and why, not filling out mandatory sections.

## Optional sections

Include these only when they add genuine value:

- **Status** frontmatter (`proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`) when a decision may be revisited.
- **Considered Options** when the rejected alternatives are worth remembering.
- **Consequences** when non-obvious downstream effects need to be called out.

## What qualifies

- Architectural shape or integration boundaries.
- Technology choices with meaningful lock-in.
- Ownership and scope boundaries between contexts.
- Deliberate deviations from the obvious path.
- Constraints that are not visible in the code.
- Non-obvious rejected alternatives.

Do not create ADRs for reversible implementation details, obvious choices, or decisions with no meaningful alternative.
