# PRD Writer v3.0 · Interactive dual-format skill package

English | [中文](README.zh.md)

This package includes a PRD writing skill, a twelve-chapter template, an offline HTML workbench, a standard-library builder, test scripts, and a synthetic PRD demonstration.
The user's project is up-sl-back; no real repository was read, and demonstration requirements are not presented as approved decisions.

## Which file to use first

**For skill instructions only:** use `prd-writer/SKILL.md`. The separately supplied “PRD撰写技能.md” has the same content as this entry point.

**For repeatable dual-format generation:** keep the entire `prd-writer/` directory and place it in a skill directory supported by your agent host.
The entry file is `SKILL.md`; the skill name and directory name are `prd-writer`. The host's configuration determines its actual loading paths and permissions; this package does not infer them.

**To try the interactions first:** open `prd-writer/examples/device-demo.prd.html` in a browser that permits local HTML.
This is a synthetic demonstration, not an approved device-module PRD for the user's project. Its paired text is `device-demo.prd.md`.
No server or npm dependencies are required. Corporate browser policies may prohibit local HTML or scripts; follow your organization's policies.

## Workflow

Ask the agent to analyze the requirements, verify the supplied references and open decisions, and complete the Markdown according to `SKILL.md`.
Then run this command from the skill directory:

```bash
python scripts/render_prd.py module.md --out-dir out --stem device --doc-id up-sl-back.device --version 0.1.0
```

The builder requires Python 3.10+, uses only the standard library, and generates:

```text
out/
├── device.prd.md
├── device.prd.html
└── device.manifest.json
```

The first two files are the document formats; the manifest records model consistency and file hashes, not business acceptance evidence.
Existing files are not overwritten by default. Add `--force` explicitly when regenerating outputs with the same names; even then, the input source file is protected from overwriting.
The builder converts completed requirements text; it does not decide permissions, interfaces, databases, or business goals.

Example request to an agent:

> Use the prd-writer skill to create a standard PRD for [module name]. First verify the project conventions I provide and mark key unresolved decisions. Deliver actual Markdown and offline-editable single-file HTML documents with identical content, and describe the validation scope.

Example incremental revision:

> Use prd-writer to revise this PRD, changing only [specific rules]. Preserve unrelated content and US/BR/AC/API/TC identifiers, list affected acceptance criteria and checks to rerun, and regenerate the MD and offline HTML.

## HTML interactions

The page provides a chapter directory, full-text search, light and dark themes, chapter editing, full Markdown editing and preview, task checkboxes, review comments, import, print styles, and export.
Chapter editing edits Markdown text; it is not a Word-style rich-text or table-cell editor. More complex Markdown remains available through full-source editing.

Comments are appended to the document's review log and appear in both formats. The entered author identity is unverified and does not constitute a real signature.
Task checkboxes update the text but do not indicate that code ran, tests passed, or business acceptance occurred.

After editing, use **Export dual-format package**: it freezes one current snapshot and creates a ZIP containing MD and HTML.
You can also export MD, HTML, or workspace JSON separately. The page reports that export has started; confirm that the browser actually finishes the download.
An HTML export is a new file containing the latest text and runtime code; it does not silently overwrite the originally opened file.

Shortcuts: `Ctrl+S` (`Cmd+S` on macOS) starts dual-format export; apply or cancel changes in chapter/comment dialogs first. `Esc` cancels a dialog or closes the mobile directory.

## Offline use, caching, and data safety

The HTML requests no CDN assets, remote fonts, online icons, or backend interfaces; the renderer neither executes raw HTML in Markdown nor automatically loads document images.
Raw Markdown is the sole text source; controlled comments store the document ID, version, revision, and update time.
The default maximum text size is 5 MiB; no dedicated large-document performance acceptance is claimed.

Local drafts are disabled by default. Enabling them displays a warning that plaintext will be saved in the current browser; consider shared devices and sensitive content carefully.
Editing and export remain available if caching fails. Cache recovery checks the baseline; competing updates suspend automatic overwriting, but there is no multi-user lock or automatic merge.
Browser caching neither saves the original file nor provides cloud backup; validate `file://` persistence in the actual browser.

This version provides no cloud saving, real-time collaboration, online AI, login permissions, or trusted electronic signatures. Anyone holding the file can modify the entire document.
“Online interaction” refers to interactions within the browser page; placing the HTML on a static site does not add these server capabilities.

## Markdown scope and diagrams

The lightweight renderer supports common headings, paragraphs, quotes, lists, task lists, tables, fenced code, inline code, basic emphasis, and safe links.
It does not promise complete CommonMark/GFM semantics; deep nesting, complex links, and extensions may render in simplified form, while exports preserve the original source.
It executes no raw HTML and loads no images automatically. Mermaid is shown as source text; the PRD should also provide a readable state-transition table.
The package includes no Mermaid graphics engine and cannot claim that diagrams have been rendered graphically.

## Completed and unperformed validation

See `验证报告.md` at the package root and `validation/`.
Standard-library builder tests and Chromium interaction regressions were run; the detailed test names, versions, methods, and limitations are recorded there.
The test environment's browser policy blocked local `file://` and local HTTP navigation; interactions were tested by injecting the generated bytes into a blank page.
Therefore, **opening a native local file by double-clicking was not tested**; content injection must not be presented as passing that check.
Successful cache recovery and conflict detection used explicit storage stubs; real `file://` persistence was not validated.
Other browsers, real mobile devices, assistive readers, real business code/databases, and business acceptance were not tested.

Builder tests need no browser:

```bash
python scripts/test_build.py
```

Browser tests require separately configured Playwright and an approved Chromium installation; these test dependencies are not HTML runtime dependencies:

```bash
python scripts/test_runtime.py --chromium /path/to/chromium --mode file --out-dir test-results
```

Restricted environments can use `--mode content` to check generated-page interactions; the report explicitly states that this does not validate `file://` startup.
Do not change your organization's security policies to run the tests.

## Directory

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

`assets/offline-shell.html` is a builder template with placeholders; it cannot be used directly as a generated PRD.
