# Agent Note: Preset restart binding owner

Status: implemented

English | [中文](2026-09-24-preset-restart-binding-owner.zh.md)

## Problem

A blank Agent can outlive the preset provider's Loader fiber. Scope ancestry remains bound, but a replacement service loses the private rebind handle. Retrying a selection then fails with an already-bound scope even though discovery and the selection control work.

## Decision

Retain the scope binding table under the stable Loader entry identity, with weak keys for both the entry and Agent scope. A replacement provider in that entry recovers only its original capabilities. Directly mounted services use their instance identity. Different entries remain separate even when their preset names match.

## Alternatives considered

**Allow arbitrary scope rebinding.** Rejected because scope ancestry must remain writable only through the original binding capability.

**Share one global Agent binding table.** Rejected because another registration owner could gain a rebind capability it never held.

**Refresh the browser after provider restart.** A refresh cannot repair the Host's lost capability and hides interruption handling from acceptance.

## Consequences

This enables explicit selection recovery for a surviving blank session after toggling the same Loader entry. It does not preserve active preset registrations while the provider is absent, transfer ownership to a different entry, or permit recomposing a started turn. The existing per-session composition design remains authoritative for standing mounts and logged selection. Real-Host browser evidence must assert the RPC result and durable selection event, not only the optimistic dropdown value.
