# Agent Note: Qishu workspace scaffolds

Status: implemented

English | [中文](2026-09-17-qs-workspace-scaffolds.zh.md)

## Problem

The Qishu workbench needs seven independent plugins without changing the repository package discovery depth. A scaffold must not activate unfinished UI in the default Web composition.

## Decision

The seven workspace packages live at packages/qs/qs-{shell,login,sessions,composer,transcript,approval,questions}. Each has empty Host and Client apply entries, the shared client TypeScript configuration, and the official clientBundle preset. The client aggregate and generated source aliases include the packages. The [framework map](../../../../../packages/qs/FRAMEWORK.md) is documentation only.

## Alternatives considered

- Nesting seven packages below workbensh requires changing workspace discovery and source-alias generation; it is outside the scaffold scope.
- One package with seven modules does not preserve the user-selected independent package split.
- Mounting placeholders in the default Web profile suggests runtime integration has been completed; composition rows and their resolver dependencies remain deferred.

## Consequences

The packages have no views, slots, configuration, services, or model-facing effects. Their empty entries do not require invariant companions. Runtime dependencies and behavior tests belong to the implementation that introduces those behaviors; structural readiness is checked through type compilation, bundling, and package gates. The development plan remains the authority for unimplemented functionality.

The implementation that fills these packages is [Qishu workbench client plugin family](2026-09-17-qishu-workbench-client-plugins.md).
