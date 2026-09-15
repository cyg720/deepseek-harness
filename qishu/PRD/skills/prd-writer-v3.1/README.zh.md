# PRD Writer 3.1

[English](README.md) | 中文

入口：[prd-writer/SKILL.md](prd-writer/SKILL.md)。保留整个prd-writer目录。生成同快照Markdown和离线HTML，包含完整DDL/注释/索引、测试用例、合成数据及验收点；页面支持多级折叠目录、Mermaid、搜索、编辑和导出。项目技术约定须从实际资料核验。

## 构建

从prd-writer目录执行，Python 3.10+标准库即可：

```bash
python scripts/render_prd.py module.md --out-dir out --stem module --doc-id project.module --version 0.1.0
```

输出.prd.md、.prd.html和.manifest.json。默认不覆盖文件；--force只允许覆盖输出，不能覆盖输入。DDL和数据由需求编制流程交付，转换器不推断业务设计。

## 目录

- assets：起草模板、HTML界面、固定版本Mermaid和许可证。
- references：工程、DDL、测试数据与验收规范。
- examples：设备需求源文件/生成器，以及DDL和目录测试样例。
- scripts：构建器与构建、数据、浏览器测试。
- evals：需求和交付场景。

仅保留源文件，生成HTML、截图、ZIP、夹具和缓存不随包保存。示例是合成材料；设备示例保留历史业务正文，不代表已批准需求。

## 测试

从prd-writer目录运行；页面由测试自动构建，无需旧验证产物：

```bash
python -m unittest discover -s scripts -p "test_build.py"
python -m unittest discover -s scripts -p "test_test_data.py"
python scripts/test_runtime.py --chromium /path/to/chromium --mode file --out-dir ../test-results/runtime
node scripts/test_toc.cjs ../test-results/toc
```

浏览器测试另需Python/Node Playwright及Chromium。Node测试通过PRD_CHROMIUM指定浏览器，通过PRD_PYTHON指定Python；默认使用Playwright默认浏览器和python。输出目录test-results被Git忽略。本次运行情况见[验证报告](验证报告.md)。

## 边界

HTML无CDN，内嵌约3.4MiB Mermaid；正文上限5MiB，支持常用Markdown子集。源码是唯一正文来源，修改后必须导出；缓存默认关闭，只是本机草稿。没有云同步、多人协作或可信签名。原始HTML、文档脚本、远程图片不执行；图形保留源码，错误局部显示。生成SQL不表示执行过数据库，勾选和文件生成不等于业务验收。
