# PRD Writer v3.0 · 双格式交互技能包

[English](README.md) | 中文

本包包含 PRD 撰写技能、十二章模板、离线 HTML 工作台、标准库构建器、测试脚本与一份合成 PRD 演示。
用户项目是 up-sl-back；没有读取真实仓库，没有把演示需求写成已批准结论。

## 先用哪个文件

**只需要技能说明：** 使用 `prd-writer/SKILL.md`。单独提供的《PRD撰写技能.md》与该入口内容相同。

**需要稳定生成双格式文档：** 保留整个 `prd-writer/` 目录，将其放在所用智能体宿主支持的技能目录。
入口文件使用 `SKILL.md`，技能名及目录名是 `prd-writer`。宿主的具体加载路径和权限遵循其配置，不由本包猜测。

**先体验交互：** 用允许本地 HTML 的浏览器打开 `prd-writer/examples/device-demo.prd.html`。
这是合成演示，不是用户项目已批准的设备模块 PRD。配对正文是 `device-demo.prd.md`。
无需启动服务器或安装 npm 依赖。公司浏览器策略可能禁止本地 HTML 或脚本，需遵循组织政策。

## 使用流程

让智能体先依据 `SKILL.md` 分析需求、核对资料与待决策项，完成 Markdown。
然后在技能目录执行：

```bash
python scripts/render_prd.py module.md --out-dir out --stem device --doc-id up-sl-back.device --version 0.1.0
```

构建器需要 Python 3.10+，仅使用标准库，生成：

```text
out/
├── device.prd.md
├── device.prd.html
└── device.manifest.json
```

前两份是正式文档格式；manifest 是模型一致性及文件哈希记录，不是业务验收证据。
默认不覆盖已有文件。确实需要重新生成同名输出时显式添加 `--force`；即便如此，也不会覆盖输入源文件。
构建器仅转换已完成的需求正文，不会自动决定权限、接口、数据库或业务目标。

可向智能体发出这样的任务：

> 使用 prd-writer 技能，为〔模块名称〕创建标准版 PRD。先核验我提供的项目约定，标注关键未决策事项。最终生成内容一致的 Markdown 和可离线编辑的单文件 HTML，交付两份实际文件并说明验证范围。

增量修改示例：

> 使用 prd-writer 修订这份 PRD，只变更〔具体规则〕。保留无关内容及 US/BR/AC/API/TC 编号，列明受影响的验收和待重验项，并重新生成 MD 与离线 HTML。

## HTML 的交互方式

页面提供章节目录、全文查找、明暗主题、章节编辑、完整 Markdown 编辑与预览、任务勾选、评审批注、导入、打印样式与导出。
章节编辑是 Markdown 文本编辑，不是 Word 式富文本或表格单元格编辑器。较复杂 Markdown 通过完整源码编辑保留。

批注会追加到正文的“文档评审记录”，两种格式都能看见。填写人身份未经验证，不代表真实签署。
任务勾选会回写正文，但不代表程序执行、测试通过或业务验收。

推荐完成修改后点击 **导出双格式包**：一次冻结当前快照，生成包含 MD 和 HTML 的 ZIP。
也可以分别导出 MD、HTML 或工作区 JSON。页面会提示“已发起导出”，请确认浏览器实际下载完成。
HTML 导出的是包含最新正文和运行代码的新文件，不会静默覆写最初打开的文件。

快捷键：`Ctrl+S`（macOS 使用 `Cmd+S`）发起双格式导出；章节/批注弹窗中先应用或取消修改；`Esc` 取消弹窗或收起移动目录。

## 离线、缓存与数据安全

HTML 不请求 CDN、远程字体、在线图标或后端接口；渲染器不执行 Markdown 内的原始 HTML，也不自动加载文档图片。
原始 Markdown 是唯一正文来源；受控注释保存文档 ID、版本、修订号和更新时间。
默认最大正文为 5 MiB；不宣称大文档性能已完成专项验收。

本机草稿默认关闭。开启前会提示以明文保存到当前浏览器，共享设备/敏感内容应谨慎使用。
缓存失败仍可以编辑和导出。缓存恢复有基线检查；检测到竞争更新会暂停自动覆盖，但没有多人锁或自动合并。
浏览器缓存不是原文件保存，更不是云端备份，`file://` 持久化应按实际浏览器验证。

此版没有云端保存、多人实时协作、在线 AI、登录权限或可信电子签名。文件持有人可以修改整个文档。
“在线互动”指浏览器页面内互动；把 HTML 放到静态站点也不会因此自动获得上述服务端能力。

## Markdown 范围与图表

轻量渲染器支持常用标题、段落、引用、列表、任务列表、表格、围栏代码、行内代码、基础强调及安全链接。
不承诺完整 CommonMark/GFM 语义；深层嵌套、复杂链接和扩展语法可能采用简化展示，但原始源码随导出保留。
不执行原始 HTML，不自动加载图片。Mermaid 显示源码；PRD 同时应提供可读的状态转移表。
当前包没有集成 Mermaid 图形引擎，不能称图表已经完成图形渲染。

## 已执行与未执行的验证

参阅根目录 `验证报告.md` 与 `validation/`。
实际运行了标准库构建器测试及 Chromium 中的交互回归；详细测试名称、版本、方法与限制均有记录。
当前执行环境的浏览器策略阻断了本地 `file://` 和本地 HTTP 导航；浏览器交互采用将生成字节注入空白页面的方式测试。
因此，**原生本地文件双击启动未完成测试**，不能将内容注入测试冒充该项通过。
成功缓存恢复及竞争检测使用显式存储桩，未验证真实 `file://` 持久化。
未进行其他浏览器、真实移动设备、辅助阅读器、真实业务代码/数据库或业务验收测试。

生成器测试不需要浏览器：

```bash
python scripts/test_build.py
```

浏览器测试需要自行配置 Playwright 和获准运行的 Chromium，测试依赖不是 HTML 运行依赖：

```bash
python scripts/test_runtime.py --chromium /path/to/chromium --mode file --out-dir test-results
```

受限制环境可使用 `--mode content` 检查已生成页面的交互，报告会明确它不验证 `file://` 启动。
不要为了运行测试修改组织的安全策略。

## 目录

```text
prd-writer/
├── SKILL.md
├── assets/
│   ├── prd-template.md
│   └── offline-shell.html
├── references/
│   ├── project-profile.md
│   ├── engineering-rules.md
│   └── sources.md
├── scripts/
│   ├── render_prd.py
│   ├── test_build.py
│   └── test_runtime.py
├── evals/cases.yaml
└── examples/
    ├── device-demo-source.md
    ├── device-demo.prd.md
    ├── device-demo.prd.html
    └── device-demo.manifest.json
```

`assets/offline-shell.html` 是构建模板，带占位符，不能直接当作已生成 PRD 使用。
