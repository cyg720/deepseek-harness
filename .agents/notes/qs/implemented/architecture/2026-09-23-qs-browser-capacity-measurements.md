# Agent Note: Qishu browser capacity measurements

Status: implemented

English | [中文](2026-09-23-qs-browser-capacity-measurements.zh.md)

## Problem

Durable event counts, loaded reading nodes and browser DOM nodes measure different costs. A fast projection or a passing UI test does not establish browser latency or retained memory for long histories.

## Decision

The long-history Qishu browser inventory reuses the official synthetic Session generator and Web scaffold with built Client assets. The generator accepts a turn count while retaining its original default. Each sample creates a private scaffold and browser, measures observable actions across rendering opportunities, and reports all samples with actual event counts and machine metadata.

The inventory records heap and DOM metrics after explicit GC, including an immediate post-sign-out checkpoint. This checkpoint can include deferred cleanup and does not prove a steady-state leak or complete release. The source-resolved test Host is not published-Host startup evidence. Measurements remain threshold-free until calibrated on the intended runner.

The tool-payload inventory constructs one completed two-step Session through official event and stream builders. It varies argument and result bytes independently from history length, verifies all rendered content, and measures first expansion, nested argument expansion, draft input and reopening. Each action records browser long tasks through its final rendering opportunity. Six fresh worlds per size retain the first sample separately and use five samples for exploratory medians, not percentile gates.

## Alternatives considered

**Copy the fixture generator.** Rejected because independent event constructors can drift from the official legal history.

**Count all durable events as loaded DOM.** Rejected because paging intentionally limits the visible history and therefore the measured work.

**Treat deferred formatting as removed cost.** Rejected because opening a lazy detail still performs parsing, formatting and browser text layout. Closed-card tests cannot establish the activation budget.

## Consequences

Thirty samples support local exploratory comparisons, not a p95 acceptance claim. Streaming, fully loaded histories, file limits and steady-state teardown need separate evidence. Existing performance workflow decisions retain ownership of calibration and regression policy; this note only defines the Qishu inventory's evidence limits.
