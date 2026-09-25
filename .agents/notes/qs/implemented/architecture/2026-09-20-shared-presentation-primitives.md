# Agent Note: Shared presentation primitives

Status: implemented

English | [中文](2026-09-20-shared-presentation-primitives.zh.md)

## Problem

Alternate UI presentations need the official execution state without importing private component implementations or duplicating Session, feedback, navigation and trigger controllers.

## Decision

Official owners expose shared presentation injections and preview identities. The workbench keeps interaction rendering in a fixed session seat and dispatches transcript rows from live slot registrations. Paging reports request-scoped outcomes from the official executor; connection changes reject old settlement. Visible input consumers acquire exclusive source policies and reject late command adjudication after release.

## Alternatives considered

- Copying official stores creates divergent drafts, navigation and resource retention.
- Moving request execution into QS components loses authoritative errors and makes view disposal own accepted operations.
- A fixed transcript-kind whitelist prevents independent extension plugins from contributing rows.

## Consequences

These primitives are implemented, but they do not certify the complete second-priority composition. New rightbar, feedback, preview and directory presentations still need their corresponding actual plugin consumers and lifecycle acceptance. Trigger sources remain disabled until a visible consumer acquires a lease. Official and QS input mounts acquire and release their own policies; synchronous and asynchronous source results cannot cross a lease change.

The existing [workbench family decision](2026-09-17-qishu-workbench-client-plugins.md) remains active: its plugin correspondence, appearance isolation and official-switching rationale are not superseded. This note owns the added shared-state decisions only.
