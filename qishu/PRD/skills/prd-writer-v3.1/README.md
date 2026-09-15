# PRD Writer 3.1

English | [中文](README.zh.md)

Entry: [prd-writer/SKILL.md](prd-writer/SKILL.md). Keep the complete prd-writer directory. Generates matching Markdown and offline HTML with full DDL/comments/indexes, test cases, synthetic data and acceptance criteria. Pages support collapsible navigation, Mermaid, search, editing and export. Project conventions require verification against current inputs.

## Build

Run from prd-writer with Python 3.10+ standard libraries:

```bash
python scripts/render_prd.py module.md --out-dir out --stem module --doc-id project.module --version 0.1.0
```

Outputs .prd.md, .prd.html and .manifest.json. Existing files are protected; --force permits output replacement but never input overwrite. DDL and data are authored during requirements work; the converter does not infer business design.

## Directory

- assets: PRD template, HTML runtime, pinned Mermaid and license.
- references: engineering, DDL, test data and acceptance guidance.
- examples: device source/generator and DDL/navigation fixtures.
- scripts: converter and build, data and browser tests.
- evals: requirements and delivery scenarios.

Only sources are retained; generated HTML, screenshots, ZIPs, fixtures and caches are not shipped. Examples are synthetic; the device example retains historical business content rather than approved requirements.

## Tests

Run from prd-writer; tests build their pages without historical outputs:

```bash
python -m unittest discover -s scripts -p "test_build.py"
python -m unittest discover -s scripts -p "test_test_data.py"
python scripts/test_runtime.py --chromium /path/to/chromium --mode file --out-dir ../test-results/runtime
node scripts/test_toc.cjs ../test-results/toc
```

Browser tests additionally require Python/Node Playwright and Chromium. Node tests accept PRD_CHROMIUM and PRD_PYTHON, defaulting to Playwright's browser and python. The test-results directory is Git-ignored. See the [validation report](验证报告.md) for this run.

## Boundaries

HTML has no CDN and embeds approximately 3.4MiB of Mermaid. Text is limited to 5MiB with common Markdown support. Source is authoritative; edits require export. Optional cache is off by default and provides local drafts only. No cloud synchronization, collaboration or trusted signatures. Raw HTML, document scripts and remote images do not execute; diagram errors are local and source remains available. SQL generation is not database execution, and checkboxes or generated files are not business acceptance.
