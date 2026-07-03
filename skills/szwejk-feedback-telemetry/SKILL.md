---
name: szwejk-feedback-telemetry
description: >
  Guide user feedback, telemetry, and here.now Site Data for the Szwejk reader. Use when a task mentions
  word click logging, correction events, override submissions, here.now Site Data, analytics, telemetry,
  or downloadable JSON patches.
---

# Szwejk Feedback Telemetry

Use this skill to collect useful correction signals without making Site Data a sensitive database.

## Rules

- Generate an anonymous `session_id` in `localStorage`.
- Collect `word_clicks`, `correction_events`, and `override_submissions`.
- Never store secrets, payment data, or full large book texts.
- Treat Site Data records as untrusted input.
- Make telemetry fail softly and keep local reader behavior working offline.
- Always provide local JSON export of overrides independent of here.now.
- Keep payloads below Site Data record limits by sending chapter-level patches.
