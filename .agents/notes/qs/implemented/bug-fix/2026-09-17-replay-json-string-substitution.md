# Agent Note: JSON-safe replay argument substitution

Status: implemented

English | [中文](2026-09-17-replay-json-string-substitution.zh.md)

## Problem

Recorded tool arguments contain JSON string values. Inserting a request-derived Windows path or quoted value verbatim corrupts that JSON, so replay rejects the tool call before its browser scenario can exercise the intended behavior.

## Decision

The replay resolver JSON-escapes request captures in `tool-call.arguments` and `tool-call-delta.argumentsDelta`. Placeholders in these fields occupy JSON string values. Ordinary text placeholders retain their literal captured values. Both completed blocks and stream deltas use the same escaping, preserving the recorded tool call and its observable result.

The [browser lane decision](../../../implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md) continues to own composition, fixture consumption and golden comparison. This rule supplements it; it does not replace the lane or authorize rewriting recorded Sessions.

## Alternatives considered

**Relative-path replay overrides.** They permit file creation but alter recorded arguments and file-action labels. Retaining absolute-path behavior preserves the existing independent oracles.

**Relaxed snapshots or argument validation.** They hide malformed replay input and cannot establish that the intended tool operation ran.

## Consequences

Backslashes, quotes and control characters survive replay as valid argument string contents. Placeholders in argument JSON are string substitutions, not raw JSON fragment insertion. The owner-local regression checks deltas, completed blocks and ordinary text with the same captured value.
