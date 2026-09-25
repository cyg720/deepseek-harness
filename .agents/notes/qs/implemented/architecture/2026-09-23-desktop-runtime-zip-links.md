# Agent Note: Desktop runtime ZIP links

Status: implemented

English | [中文](2026-09-23-desktop-runtime-zip-links.zh.md)

## Problem

The Windows Desktop build extracts Node distributions with extract-zip. Its symlink advisories cover targets outside the extraction directory and a later regular entry writing through an earlier symlink with the same name. Comparing an archive hash with a cached manifest does not authenticate both files against a local attacker who can replace them.

## Decision

The Qishu extraction adapter rejects Unix symlink entries in onEntry before extract-zip creates them. The caller owns a fresh, exclusive empty output directory. Node ZIP distributions have no required symlink capability; unsupported link entries fail preparation rather than silently disappearing.

## Alternatives considered

**Accept links after checking parent directories.** This does not prevent the final-component duplicate-name attack.

**Treat the dependency audit as fixed.** The call-site mitigation leaves the installed dependency and its advisories unchanged. A maintained upstream fix can replace the adapter after equivalent regression coverage verifies the shipped version.

## Consequences

The policy covers this Node ZIP preparation call site, not arbitrary archives, tar extraction, archive authenticity, or resource-exhaustion limits. Real ZIP fixtures cover regular content, escaping links and duplicate names without requiring the host to permit symlink creation.
