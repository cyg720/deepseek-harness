# Agent Note: concurrent observation reuse

Status: implemented

English | [中文](2026-09-24-concurrent-observation-reuse.zh.md)

## Problem

Concurrent cold Session observations can all miss the prepared cache before awaiting persistence. Preparing every returned log repeats projection restoration for the same revision, even after another reader has published a reusable entry.

## Decision

The observation reader checks the existing cache again after its read handle closes, cancellation is checked, and live attachment is excluded. It reuses only the same persistence instance and revision. Cordis traced wrappers are compared by their original service identity; actual I/O still uses the traced receiver. Each observation still owns its lease. This clarifies the concurrent cold-read portion of the [observation architecture](../../../implemented/architecture/2026-08-25-session-observations-and-projection-owned-client-state.md); that note remains authoritative for immutable cuts, projections, and promotion.

## Alternatives considered

Sharing in-flight disk work would also require independent waiter cancellation and service-disposal ownership. The measured repeated projection work can be removed without adding those states. Disk reads remain independent; this decision does not promise singleflight I/O. Changing token estimates or truncating history would alter behavior instead of removing duplicate preparation.

## Consequences

Same-revision concurrent reads share prepared content while changed revisions stay separate. Existing cancellation, corruption, live-preference, lease, and eviction behavior remains required. A controlled overlapping-read regression must reject duplicate preparation, and the real browser workload must verify that fewer restorations improve opening latency. CPU-profile runs are diagnostic evidence and do not enter timing medians.
