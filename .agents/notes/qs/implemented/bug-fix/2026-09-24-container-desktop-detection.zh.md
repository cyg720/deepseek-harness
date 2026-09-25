# Agent Note: 容器桌面检测

Status: implemented

[English](2026-09-24-container-desktop-detection.md) | 中文

## Problem

WSL 上的 Docker 与宿主共享 Microsoft 内核版本。内核身份不能证明容器可以用 wslpath 转换路径或启动 Windows 应用。把该容器识别为 WSL 会提供不可用的桌面入口，并选择错误的打开命令。

## Decision

native-command 路径打开器先排除容器，再解释 WSL 环境或内核标记。Docker 与 Podman 检测复用 is-inside-container。容器仍可声明 Linux 显示服务，此时使用 Linux 命令。平台测试同时提供容器、内核和环境事实，避免模拟的 WSL 场景依赖测试运行器所在宿主。

## Alternatives considered

删除内核回退会削弱缺少环境标记时的真实 WSL 支持。只修改断言会保留错误的 Host UI 入口和 Windows 命令分派。两者都不能区分共享内核与桌面访问能力。

## Consequences

检测结果仍只是桌面可用性的估计，不是路径授权或沙箱。调用方仍须逐文件授权，命令错误仍然向上传递。主动向容器开放 Windows 互操作不属于本检测策略的支持范围。已有可交付文件与 Open In 插件笔记继续保留各自的 UI 和所有权决策；本宿主检测规则不取代任何活跃笔记。
