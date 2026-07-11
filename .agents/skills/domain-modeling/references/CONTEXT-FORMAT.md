# CONTEXT.md format

## Structure

```md
# {Context Name}

{One or two sentences describing what this context covers and why it exists.}

## Language

**Order**:
{A one or two sentence definition of the term.}
_Avoid_: Purchase, transaction

**Invoice**:
{A one or two sentence definition of the term.}
_Avoid_: Bill, payment request
```

## Rules

- Be opinionated. Choose one canonical term and list synonyms that should not be used under `_Avoid_`.
- Keep definitions tight: one or two sentences maximum. Define what a concept **is**, not what it does internally.
- Include only terms specific to the project's domain. General programming concepts do not belong in the glossary.
- Group terms under subheadings when natural clusters emerge.
- Update the relevant glossary immediately when a term is resolved; do not batch glossary changes at the end of the session.

## Single and multi-context repositories

Most repositories have one root `CONTEXT.md`. If the root contains `CONTEXT-MAP.md`, read it to find the context-specific glossary and understand relationships between contexts.

A context map may look like:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to generate an invoice
```

When multiple contexts exist, infer which one the topic belongs to. If it is unclear, ask before writing to a glossary.
