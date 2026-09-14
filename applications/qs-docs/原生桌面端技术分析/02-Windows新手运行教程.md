---
description: "从 Windows 工具安装、依赖准备到启动 DeepSeek Harness 桌面窗口的逐步操作教程。"
---

# 02 Windows 新手运行教程

## 摘要

本篇的目标是在你的 Windows 电脑上运行当前仓库的桌面程序。先完成原版运行，再做品牌和业务修改。环境安装、生成程序、启动窗口和调用模型是不同步骤：源码编译成功不代表窗口已经打开，窗口打开也不代表模型密钥已经配置。

## 目录

- [1. 准备电脑与工具](#环境)
- [2. 打开项目与终端](#终端)
- [3. 安装项目依赖](#依赖)
- [4. 第一次运行](#运行)
- [5. 配置模型与验证聊天](#模型)
- [6. 修改后的日常操作](#日常)
- [7. 调试和记录错误](#调试)
- [8. 完成标准](#完成)

<a id="环境"></a>
## 1. 准备电脑与工具

### 步骤 1：确认使用 Windows x64

打开“设置 → 系统 → 系统信息/关于”，查看系统类型。本文主路径是基于 x64 的处理器和 64 位 Windows。后面的打包脚本明确要求 Windows x64，不要在 WSL 中执行 Windows 打包命令，也不要把 Windows ARM64 当成已验证目标。

本报告不设置未经测量的硬件最低配置。构建涉及数百个工作区包和本地编译依赖，应准备足够的磁盘空间，并避免在云盘同步目录或很深的路径下构建。你现有的 `D:\code\CYG\Github\deepseek-harness` 可以继续使用。

### 步骤 2：安装或检查 Node.js

Node.js 是在电脑上运行 JavaScript 的工具。打开 [Node.js 官方下载页](https://nodejs.org/en/download)，选择 Node 24 系列、Windows x64 安装程序，完成安装后重新打开 PowerShell。不要为了本教程追随网页上的最新主版本。

检查：

```powershell
node --version
npm --version
```

成功条件：两个命令都输出版本号，不出现“无法识别”。当前仓库声明的 Node 范围是 `^22.19.0 || >=24.0.0`；本次检查到的开发 Node 是 `v24.18.0`。打包后的 Host 使用脚本另行准备的 Node 24.17.0，与你电脑安装的开发 Node 不是同一个文件。

如果安装后仍找不到命令，先关闭所有终端再新开一个；再用 `Get-Command node` 查看 Windows 能否找到可执行文件。不要通过随意删改 PATH 来修复。

如果 `npm --version` 提示 `npm.ps1` 没有数字签名，改用 `npm.cmd --version`。本机确实遇到了这一情况，使用 `npm.cmd` 可输出 `11.16.0`；后面的全局 pnpm 安装命令也可对应使用 `npm.cmd install --global pnpm@11.7.0`。

### 步骤 3：安装匹配版本的 pnpm

pnpm 负责下载和组织仓库依赖。当前根目录 `package.json` 固定为 `pnpm@11.7.0`，使用这个版本，忽略“可以升级到新主版本”的提示。

已有 pnpm 时先检查：

```powershell
pnpm --version
```

没有 pnpm 时，以下是需由操作者执行的环境安装步骤，本次没有重新安装全局工具：

```powershell
npm install --global pnpm@11.7.0
pnpm --version
```

成功条件：输出 `11.7.0`。官方安装参考为 [pnpm 安装文档](https://pnpm.io/installation)，具体版本以仓库固定值为准。不要在这个项目根目录用 `npm install` 替代 `pnpm install`，以免产生另一套锁文件和依赖组织方式。

如果 PowerShell 提示 `pnpm.ps1` 被执行策略阻止，可以先尝试 `pnpm.cmd --version`。这是调用同一工具的 Windows 命令入口，不要求关闭系统脚本安全策略。

### 步骤 4：检查 Git，安装编辑器

Git 用来管理源码；构建还会读取 Git 提交信息。执行：

```powershell
git --version
```

你已经有这个仓库，不需要重复克隆。编辑器可以使用 VS Code，也可以用现有代码编辑器。VS Code 与下面的 Visual Studio Build Tools 是两个不同工具：前者编辑代码，后者编译原生依赖。

### 步骤 5：为完整 Windows 打包准备 Python 和 C++ 工具链

依赖可能需要编译原生 Node 模块。准备 Python 3 和 Visual Studio Build Tools，并在安装器中选择“使用 C++ 的桌面开发”，包含 MSVC x64/x86 编译工具和 Windows SDK。此步骤由操作者完成，不是 pnpm 自动安装完整系统开发环境。[Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)、[node-gyp Windows 前置条件](https://github.com/nodejs/node-gyp#on-windows)。

检查 Python：

```powershell
python --version
```

如果电脑上只有 `py`，执行 `py -3 --version`。当原生构建找不到 Python 时，明确指定实际路径，例如：

```powershell
$env:PYTHON = 'C:\Python311\python.exe'
```

这里的路径是示例，必须换成你电脑上存在的 `python.exe`。本次发现 Python 3.11.15；编译工具是否足够仍需以完整打包结果为准。不要仅凭 Python 有版本号就判断原生构建环境完整。

<a id="终端"></a>
## 2. 打开项目与终端

### 步骤 6：在编辑器中打开整个仓库

选择“文件 → 打开文件夹”，打开：

```text
D:\code\CYG\Github\deepseek-harness
```

不要只打开 `apps/desktop`。这两个桌面目录引用整个仓库的工作区依赖，根目录才包含统一脚本和 pnpm 锁文件。

### 步骤 7：切换到正确的工作目录

在编辑器的“终端 → 新建终端”中选择 PowerShell，执行：

```powershell
Set-Location 'D:\code\CYG\Github\deepseek-harness'
Get-Location
Test-Path .\package.json
Test-Path .\pnpm-lock.yaml
Test-Path .\apps\desktop\package.json
Test-Path .\apps\desktop-host\package.json
```

成功条件：路径显示仓库根目录，后面四项均为 `True`。后续命令默认都在这里执行。单独关闭终端不会保存本次用 `$env:` 设置的环境变量。

<a id="依赖"></a>
## 3. 安装项目依赖

### 步骤 8：按仓库锁文件安装

```powershell
pnpm install --frozen-lockfile
```

`--frozen-lockfile` 的意思是按照已提交的依赖版本安装，不自行改写锁文件。本次实际执行成功。首次下载通常比本次已有依赖的情况慢；不要把本次秒级完成当成第一次安装耗时。

成功条件：最后没有错误退出，输出安装完成或 `Already up to date`。Windows 下关于 macOS/Linux 原生工作区包的“不支持当前平台”警告，可以与最终命令成功同时出现；应看最终退出结果，而不是看到任何 warning 就判定失败。

若提示锁文件与清单不一致，先确认当前源码和锁文件来自同一版本，再按仓库变更意图处理。不要直接删除锁文件来“解决”问题。

### 步骤 9：理解首次 Electron 下载

当前安装的 Electron 44 包会在解析可执行文件路径时检查二进制是否存在；缺失时打印 `Downloading Electron binary...` 并调用自身安装脚本。因此 pnpm 依赖安装完成后，第一次启动仍可能需要下载 Electron。

如果停在这里，先检查下载日志和网络，不要把它误认为 TypeScript 卡住，也不要重复启动多个下载进程。本机本次遇到的具体结果见第 06 篇。

<a id="运行"></a>
## 4. 第一次运行

### 步骤 10：使用官方桌面开发入口

```powershell
pnpm run dev:desktop
```

这条命令会完成：构建 Harness 后端与客户端 → 构建 Web 入口 → 构建 Electron 壳 → 生成开发项目链接 → 启动 Electron。

你不需要先运行 `pnpm dsh web`，也不需要先启动一个 3080 端口的服务。不要直接运行 `node apps/desktop/src/main.ts` 或 `node apps/desktop-host/src/index.ts`；前者需要 Electron 运行环境，后者需要父进程设置的专用管道和 Profile。

首次构建会输出大量包名和警告。让它完成，重点看最后的错误或窗口。开发模式默认会打开 Renderer DevTools；这是调试面板，不是另一个后台服务。

### 步骤 11：区分三种成功程度

| 看到的结果 | 说明 | 下一步 |
|---|---|---|
| `Build complete` 或客户端构建记录 | 编译产物已生成 | 继续等待项目准备和 Electron 启动 |
| 桌面窗口显示启动页 | Electron 与壳页面已加载 | 等待 Host ready，或阅读错误 |
| 显示完整聊天界面，可操作侧栏和新建会话 | Host、资源和主要前端路径可用 | 配置模型并做聊天验证 |

本机的源码构建与窗口结果分别记录在第 06 篇，不能把其中某一步的成功扩大为全部成功。

### 步骤 12：不需要调试面板时

在启动前执行：

```powershell
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
pnpm run dev:desktop
```

这只关闭自动弹出的面板，不代表关闭全部开发调试端口。正式版也不要依赖开发环境变量作为配置方式。

<a id="模型"></a>
## 5. 配置模型与验证聊天

### 步骤 13：先用开发数据目录

默认开发 home 是：

```text
D:\code\CYG\Github\deepseek-harness\apps\desktop\.desktop-build\development\home
```

它与通常的 `C:\Users\你的用户名\.dsh` 不同。因此你在普通 CLI 中保存过密钥，也不代表开发桌面版自动拥有同一份密钥。

如需自己指定一个独立目录，可以在启动终端中设置：

```powershell
$env:DSH_HOME = 'D:\dsh-desktop-dev-data'
```

成功启动后，日志会打印实际 `DSH_HOME`。若已设置这个变量，后面的 `.env` 应放在你指定的目录，而不是默认 home。

### 步骤 14：把模型密钥放到 Harness home 的 `.env`

使用默认 home 时，先创建目录，再用编辑器创建 `.env`：

```powershell
New-Item -ItemType Directory -Force -Path '.\apps\desktop\.desktop-build\development\home'
notepad '.\apps\desktop\.desktop-build\development\home\.env'
```

文件内容示例：

```dotenv
DEEPSEEK_API_KEY=替换为你自己的实际密钥
```

保存时确认文件名是 `.env`，不是 `.env.txt`。不要把真实密钥放进 `DSH_CLIENT_*` 变量、前端源码、截图或报告；这些客户端构建变量可以进入分发给用户的 JavaScript。

Host 会按继承环境、启动目录 `.env`、Harness home `.env` 的优先关系加载环境。桌面 Host 的启动目录是它的 Profile/开发 project，不能假定仓库根目录的 `.env` 总会被它读取。把密钥放进当前 Harness home 更明确。[环境加载实现](/D:/code/CYG/Github/deepseek-harness/packages/boot/app-boot/src/index.ts)。

### 步骤 15：重启后进行最小聊天测试

关闭应用，从同一终端重新启动；已有构建产物时可以使用：

```powershell
pnpm run start:desktop
```

在界面中新建会话，输入一句不涉及文件修改的话，例如“请用一句话介绍你能做什么”。观察是否出现逐步输出及最终回复。此测试会调用你配置的模型服务；本报告不预先承诺服务可用或免收费。

首次验证仅需：页面能显示、新会话能创建、模型能回复、关闭后重新打开能看到自己的历史。之后再测试终端、文件和插件。

<a id="日常"></a>
## 6. 修改后的日常操作

### 步骤 16：分清 `dev`、`start` 和 `build`

| 命令 | 用途 | 是否自动构建 |
|---|---|---|
| `pnpm run dev:desktop` | 第一次启动或修改源码后的稳妥入口 | 构建后启动 |
| `pnpm run start:desktop` | 已有匹配产物时快速重新打开 | 不构建；仍会重建开发项目链接 |
| `pnpm run build` | 构建仓库后端、客户端和 Web 产物 | 构建，不启动窗口 |
| `pnpm run build:desktop` | 只请求桌面壳包构建 | 不能替代全部 Web/Host 构建 |
| `pnpm run package:desktop:win:x64:unsigned` | 制作 Windows 测试安装包 | 自己执行完整发布准备 |

`start:desktop` 不会自动检测并补齐过时的所有产物。修改源代码后窗口没有变化，先完整退出，再运行 `dev:desktop`，不要在 `lib` 里直接改生成文件。

### 步骤 17：只改 Electron 壳时的较短路径

已经成功构建整个仓库，并且修改只涉及桌面壳时，可以执行：

```powershell
pnpm run build:desktop
pnpm run start:desktop
```

如果改了 Host、聊天 UI、插件包或它们的依赖，使用 `dev:desktop` 更清楚。它不是开发热更新服务器，不能期待保存所有源码后窗口立即变化。

### 步骤 18：正确停止应用

Windows 可通过应用菜单退出，或关闭最后一个窗口。等待终端返回命令提示符。应用正常退出会停止它管理的 Host。必要时再对你刚启动的终端按 `Ctrl+C`。

不要为了关这个应用而结束电脑上所有 `node.exe`，那可能终止编辑器和其他项目。若进程残留，按第 05 篇先核对进程路径和父子关系。

<a id="调试"></a>
## 7. 调试和记录错误

### 步骤 19：知道三个调试端口分别看什么

| 默认端口 | 观察对象 | 环境变量 |
|---|---|---|
| 9229 | Electron 主进程 | `DSH_DESKTOP_MAIN_INSPECT_PORT` |
| 9222 | Chromium Renderer | `DSH_DESKTOP_RENDERER_DEBUG_PORT` |
| 9230 | Node Host | `DSH_DESKTOP_HOST_INSPECT_PORT` |

这些不是聊天 Web 服务地址。端口被别的程序占用时，可在当前终端设置不同值，再启动：

```powershell
$env:DSH_DESKTOP_MAIN_INSPECT_PORT = '19229'
$env:DSH_DESKTOP_RENDERER_DEBUG_PORT = '19222'
$env:DSH_DESKTOP_HOST_INSPECT_PORT = '19230'
pnpm run start:desktop
```

端口必须是 1 到 65535 的整数。不要把开发调试端口暴露到公网。

### 步骤 20：保留日志

遇到问题时，可以把下一次启动输出保存到文件：

```powershell
pnpm run dev:desktop *> desktop-dev.log
```

另开一个 PowerShell 窗口，在仓库根目录查看：

```powershell
Get-Content .\desktop-dev.log -Tail 60
```

日志重定向后，原终端可能很安静，但命令仍在运行。不要误以为它没有执行。分享日志前检查是否含本地路径、业务内容和敏感配置。本报告保存的日志不包含主动打印的模型密钥。

<a id="完成"></a>
## 8. 完成标准

在进入产品定制之前，你应能独立完成以下事项：打开根目录终端、检查版本、安装锁定依赖、启动桌面窗口、找到真实数据目录、重启并恢复会话、根据日志分辨编译失败与 Host 失败。

下一步是 [04-安装包与发布教程](04-安装包与发布教程.md) 的未签名安装包。开发窗口正常运行后，不必先加入组织权限和智能体中心，便可以验证一条完整的桌面交付路径。

## Dev Note

全局工具安装、输入真实密钥和手工点击验收由操作者完成。第 06 篇逐项标明本次实际执行的命令，不能将上述环境准备步骤视为已经在电脑上全部执行。
