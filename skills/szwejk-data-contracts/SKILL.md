---
name: szwejk-data-contracts
description: >
  Work with structured Szwejk reader data contracts and artifacts. Use when a task mentions JSON artifacts,
  alignment artifacts, hybridization plans, notes/glossary plans, reader overrides, schemas, validation,
  fixtures, or generation of small representative data samples.
---

# Szwejk Data Contracts

Use this skill to keep reader code coupled to explicit data contracts instead of guessed artifact shapes.

## Rules

- Inspect the actual data shape before coding against it.
- Check artifact size before assuming the full book can be loaded into memory.
- Prefer small fixtures before using full artifacts in tests or examples.
- Define TypeScript types and runtime validators for imported artifacts.
- Preserve stable IDs exactly.
- Keep the PL source axis canonical for spans, locations, and progress.
- Do not use PDFs as the source of truth.
