# Agent Note: Session control recovery ownership

Status: implemented

English | [中文](2026-09-23-session-control-recovery.zh.md)

## Problem

The Qishu job list requires a visible failure state and retry, but Session directory readiness does not prove control-baseline arrival. A terminal RemoteSnapshotStream failure ends its consumer; restarting its aborted physical stream cannot revive it.

## Decision

The Session Controller owns one SessionControlOwner, exposes a read-only status through ISessions.control and keeps the existing frame sink. Carrier interruption remains the Gateway's automatic retry. Terminal retry waits for disposal before replacing the stream, coalesces concurrent requests and ignores callbacks from the previous instance. Plugin disposal prevents replacement and waits for in-flight disposal. Raw errors remain diagnostic output rather than state visible to the UI.

The baseline counter identifies accepted baselines, not Connection identities. It does not by itself provide the scoped event stream required for completion notifications. Domain snapshots retain their existing publication schedule.

The [background-job display decision](../../../implemented/feature/2026-08-08-web-background-job-display.md) still owns wire fields and read-only task presentation; the [transport decision](../../../implemented/architecture/2026-08-18-session-history-and-event-transport.md) still owns carrier recovery and baseline rules. Both remain active: this note adds terminal consumer replacement, not a new transport or task registry.

The independent qs-ui-jobs counterpart reads this status through the conversation header action slot. It distinguishes an empty ready baseline from pending or failed loading, retains stale rows with a warning and exposes terminal retry. It offers no job mutation or result location without a public association.

## Validation

Controlled disposal tests cover concurrent retries, stale callbacks and unload races. A real Client assembly test creates a duplicate-baseline protocol failure and observes a new baseline after retry. No task cancellation or result API is introduced.

## Consequences

Features observe control readiness without opening another stream. Terminal recovery may wait for asynchronous disposal and can reject if disposal fails. Jobs presentation and scoped completion notifications remain separate consumers.

## Alternatives considered

**Restart the terminated stream.** This cannot revive its closed consumer.

**Open another stream inside the view.** This duplicates authority and teardown.

**Reuse Session directory readiness.** This confuses two independently arriving data sources.
