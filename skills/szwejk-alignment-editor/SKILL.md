---
name: szwejk-alignment-editor
description: >
  Guide clickable token alignment and correction editing in the Szwejk reader. Use when a task mentions
  clicked tokens, candidate spans, PL/CZ counterpart bubbles, expanding or shrinking candidates,
  accepting or rejecting replacements, or override patches.
---

# Szwejk Alignment Editor

Use this skill to keep token interaction and correction behavior reversible and data-safe.

## Rules

- Select the smallest alignment candidate containing a clicked token.
- Make parent and child candidate navigation explicit in the UI state.
- Create override patches for editor actions; never mutate the base plan.
- Show counterpart text from the other language when available.
- Expose ambiguous candidate relations in debug mode.
