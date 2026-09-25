# Agent Note: scope adapter replacement

Status: implemented

English | [中文](2026-09-24-scope-adapter-replacement.zh.md)

## Problem

A connection plugin replacement removes and reinstalls its dependent Session adapter. Treating the intervening absence as a boot error throws outside the Slot entry boundaries and destroys the React application even after the transport recovers.

## Decision

The mounted scope provider retains its roster subscription while an installed adapter is absent, but unmounts the adapter-owned binding subtree and its subscriptions. A replacement supplies a fresh binding. An initially absent adapter remains an assembly error, so suspension does not conceal missing boot configuration.

This keeps recovery within the renderer's existing [ownership layer](../../../implemented/architecture/2026-08-20-client-session-conversation-ownership.md), without retaining stale Session sources or teaching the connection transport about React. That decision remains authoritative; no active record is superseded. The removed subtree loses component-local state: preserving that state by borrowing a disposed adapter would retain invalid owners.

Inspection manifest publication has a separate asynchronous owner: the providing plugin. Its disposal closes the registry, drops queued publications, aborts local query controllers, and suppresses failures arriving after disposal. Active failures remain visible. Retrying an old registry against a new connection could publish a withdrawn capability directory, so the replacement owns a new registry instead.

## Alternatives considered

A page reload restores the application but discards the document and cannot preserve the HMR lifecycle. Keeping the old adapter renders through a disposed owner. Ignoring every missing adapter conceals invalid initial composition. Catching every publication error also hides failures of an active registry. Each is rejected in favor of explicit owner disposal and a recoverable, already-mounted scope.

## Consequences

Regression coverage must prove initial absence rejects, teardown detaches old subscriptions, old source updates cannot reach the restored tree, and a later installation renders again. A real browser must exercise the production HMR path with one document, an old WebSocket closing and a new one opening, then verify restored business interactions. Merely refreshing the page cannot establish this behavior.
