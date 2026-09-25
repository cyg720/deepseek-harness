# Agent Note: container desktop detection

Status: implemented

English | [中文](2026-09-24-container-desktop-detection.zh.md)

## Problem

Docker on WSL shares a Microsoft kernel release with its host. Kernel identity does not establish that the container can translate paths with wslpath or launch Windows applications. Treating that container as WSL advertises an unavailable desktop and selects the wrong opener.

## Decision

The native-command path opener excludes containers before interpreting WSL environment or kernel markers. It reuses is-inside-container for Docker and Podman detection. A container can still announce a Linux display; it then uses Linux commands. Platform tests supply the container fact along with kernel and environment facts so their simulated WSL cases do not depend on the test runner's host.

## Alternatives considered

Removing the kernel fallback would weaken real WSL support when environment markers are absent. Changing only the assertions would preserve the incorrect Host UI entry and Windows command dispatch. Neither addresses the distinction between a shared kernel and desktop access.

## Consequences

The detector remains a desktop availability heuristic, not path authorization or a sandbox. Callers still authorize each file, and command failures still propagate. Deliberately exposing Windows interoperability inside a container is outside this detection policy. The existing produced-file and Open In plugin notes retain their separate UI and ownership decisions; no active note is superseded by this host-detection rule.
