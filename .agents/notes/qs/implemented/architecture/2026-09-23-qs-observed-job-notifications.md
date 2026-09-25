# Agent Note: Observed Qishu job notifications

Status: implemented

English | [中文](2026-09-23-qs-observed-job-notifications.zh.md)

## Problem

A control-stream readiness notification and its separately batched jobs list can describe different baselines. Comparing them immediately can turn recovered terminal jobs into new completion notices. Toasts also need a smaller retention policy than the authoritative job registry.

## Decision

ClientSessions synchronously projects an accepted control baseline before its owner publishes readiness. Incremental domain notifications keep their batching. Qishu consumes the shared sources without another RPC stream and reports only observed running or stopping jobs that become terminal. Initial terminal observations, changed baselines and connection generations are silent.

The existing jobs presentation plugin owns the observer and lifecycle; the shell owns text-only toast display and a validated notificationCapacity. The default retains at most 256 job identities and 256 visited session identities. This is a storage bound, not a measured latency target. Records outside the current accessible directory are removed. Eviction may suppress a later notification because prior activity is unknown; it never invents completion. The job list remains authoritative.

Logout, plugin disposal and hidden workbench views suppress notification delivery. No persistent read marker or system push is introduced. Notifications name the session and terminal state, not arbitrary job labels or result bodies. A restored or newly mounted observer starts silently.

## Alternatives considered

**Per-view effects** duplicate notifications when multiple views mount.

**Uncoordinated snapshot reads** confuse replay and live transitions when readiness and the old list lack a shared publication guarantee.

**Historical replay or unbounded retention** makes notification behavior depend on historical data rather than observed changes.

## Consequences

Recovery cannot manufacture a completion notice, and retained notification identities have a deployment-controlled bound. An evicted or unobserved live state cannot justify a later notice; users inspect the authoritative job list for those results. Baseline projection does synchronous list work before readiness, while incremental updates retain batching.

## Verification

The accepted-baseline regression fails without synchronous projection. Controlled source tests cover reconnect publication, session and attempt identity, bounded eviction, logout and queued teardown. Plugin lifecycle tests cover remount and localized output. A real Host/browser test observes all three terminal outcomes and verifies that refresh does not replay them.
