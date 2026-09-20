# Agent Note: Offline PRD diagrams and test evidence

Status: implemented

English | [中文](2026-09-12-prd-offline-diagrams-and-test-evidence.zh.md)

## Problem

PRD readers need visible diagrams in the same offline document they edit and export. A coverage matrix alone does not tell testers which inputs to generate, steps to execute or evidence to collect.

## Decision

The [PRD writing skill](../../../../../qishu/PRD/skills/prd-writer-v3.1/prd-writer/SKILL.md) requires inline Mermaid graphics and separately traceable TC, TD and AC records. Generated fixtures remain synthetic; missing business adapters or decisions block affected business acceptance without preventing local fixture generation.

The [builder](../../../../../qishu/PRD/skills/prd-writer-v3.1/prd-writer/scripts/render_prd.py) verifies a pinned Mermaid asset and embeds it with its license. Markdown remains the export authority; SVG is regenerated from the current snapshot. Rendering discards obsolete revisions, isolates diagram errors and disables document configuration, external resources and interactions. CSP hashes authorize only the bundled executable scripts.

## Alternatives considered

A CDN or adjacent script breaks single-file offline delivery. A separate diagram page separates edits from their graphical result. Storing only generated SVG loses the editable source; treating data generation as business testing overstates the evidence.

## Consequences

The library adds approximately 3.4 MiB per HTML. Upgrades require refreshed asset hashes, licenses and browser regression evidence. The [tests](../../../../../qishu/PRD/skills/prd-writer-v3.1/prd-writer/scripts/test_runtime.py) exercise offline file opening, editing, import/export, competing renders and malformed inputs; [fixture tests](../../../../../qishu/PRD/skills/prd-writer-v3.1/prd-writer/scripts/test_test_data.py) execute the documented recipe and check repeatability and references. These checks do not approve any business requirement or certify every browser or Mermaid grammar.
