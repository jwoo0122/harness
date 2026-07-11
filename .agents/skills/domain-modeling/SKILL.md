---
name: domain-modeling
description: Build and sharpen a project's ubiquitous language while designing. Use when a project term is fuzzy or overloaded, or when a durable architectural decision should be recorded.
---

# Domain modeling

This is the active discipline for maintaining a shared project language. It is not a request to merely read `CONTEXT.md`; it changes the model when a term or decision becomes clear.

## File structure

Most repositories use one context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-boundary.md
│       └── 0002-storage-choice.md
└── src/
```

If `CONTEXT-MAP.md` exists at the repository root, use it to locate the relevant context:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
└── src/
    ├── ordering/CONTEXT.md
    └── billing/CONTEXT.md
```

Create `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/`, and `docs/adr/` lazily. Do not create empty documentation scaffolding before there is a term or decision worth recording.

## During a session

### Challenge the glossary

Read the applicable glossary before using domain terms. If the user's wording conflicts with it, surface the conflict immediately: “The glossary defines ‘cancellation’ as X, but this example sounds like Y — which meaning should be canonical?”

### Sharpen fuzzy language

When a term is vague or overloaded, propose a precise canonical term and list rejected synonyms under `_Avoid_`. Ask the user to choose before updating the glossary.

### Test concrete scenarios

Use specific happy-path, boundary, and failure scenarios to expose missing relationships and unclear ownership. When the user describes behavior, compare it with the code and tests; report contradictions instead of silently reconciling them.

### Update the glossary inline

Write a resolved term to the relevant `CONTEXT.md` immediately. Keep definitions concise and implementation-free. A glossary is not a specification, scratchpad, or ADR repository.

### Offer ADRs sparingly

Offer an ADR only when all of these are true:

1. The decision is hard to reverse and changing it later has meaningful cost.
2. A future reader would be surprised without the context.
3. There were genuine alternatives and a reasoned trade-off.

If any condition is missing, record the term in the glossary or the confirmed plan instead. Use [ADR-FORMAT.md](references/ADR-FORMAT.md) for a qualifying decision and [CONTEXT-FORMAT.md](references/CONTEXT-FORMAT.md) for glossary entries.
