/**
 * Generate the model-facing client slot catalog consumed by `cordis_inspect
 * what:"client"`. A dynamic package's browser half can only contribute UI
 * through `ctx.slots.register`, and every fact it needs to do that safely —
 * which keys exist, what each register call must pass, what the component
 * receives, who already occupies the seat, and when the seat exists at all —
 * is decided at compile time by the shipped web bundle. This generator reads
 * those facts lexically (no type-checker program) and emits them as a data
 * module inside `tool-cordis`, so the host-side toolset teaches the browser
 * surface without importing a single client runtime module.
 *
 * `--check` verifies the committed artifact is fresh.
 */
/*
 * 文件职责：实现 gen-client-catalog.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  declaredTypes,
  indexExportedTypes,
  referencedTypeNames,
  scanSlotFiles,
  slotDeclarations,
  slotRegistrations,
  standardKitMembers,
} from './slot-walk.ts'
import type { ScannedFile, SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT = 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts'

/** Source globs: every workspace package's sources, `.tsx` included (a contract may live in one). */
/* 中文说明：常量 SOURCE_GLOBS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SOURCE_GLOBS = ['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx']

/** Slot cardinalities the contract allows. */
/* 中文说明：常量 KINDS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const KINDS = ['single', 'list', 'keyed', 'chain'] as const
/** Slot data scopes the contract allows. */
/* 中文说明：常量 SCOPES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCOPES = ['root', 'session', 'session-maybe'] as const

/** Declarations longer than this render truncated; the full shape stays in source. */
/* 中文说明：常量 MAX_DECL_CHARS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_DECL_CHARS = 1200

/**
 * Line budget for ONE slot's expanded report. The whole point of narrowing to a
 * single slot is to spend less context, so a report a model cannot finish
 * reading is a defect rather than a detail. The widest measured slot renders 60
 * lines, so this leaves room to document a slot properly while catching the two
 * ways a report runs away: an owner share that hands down a subsystem instead of
 * a share, and prose that grew into a manual.
 */
/* 中文说明：常量 MAX_ENTRY_LINES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_ENTRY_LINES = 120

/** One register-call option as the catalog teaches it. */
/* 中文说明：interface OptionDoc 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface OptionDoc {
  readonly name: string
  readonly requirement: 'required' | 'optional'
  readonly type: string
  readonly doc: string
}

/**
 * Register options per cardinality, curated from `KindOptions` in
 * `packages/client/ui-slots/src/index.ts` — the authority for what a register
 * call may pass. Curated rather than projected because the authority is a
 * conditional type keyed on the slot's kind: it has no per-kind declaration a
 * lexical scan could read, and its own JSDoc addresses the compiler, not a
 * registrant. `verify-client-catalog` pins the authority's text so a change
 * there forces this table to be revisited.
 */
/* 中文说明：常量 REGISTER_OPTIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const REGISTER_OPTIONS: Readonly<Record<(typeof KINDS)[number], readonly OptionDoc[]>> = {
  single: [],
  list: [
    { name: 'id', requirement: 'required', type: 'string', doc: 'Your cell key. Use an id of your own: a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it. Owners that filter by id address you by it.' },
    { name: 'order', requirement: 'optional', type: 'number', doc: 'Position among the entries, ascending (default 0).' },
    { name: 'label', requirement: 'optional', type: 'string | (() => string)', doc: 'Display text where the owner projects one (nav rows, tabs). A thunk is re-read on every projection, so localized text follows the active locale without re-registering.' },
  ],
  keyed: [
    { name: 'key', requirement: 'required', type: 'string', doc: 'Your cell key: the entry renders where the owner dispatches this exact key. Registering an already-occupied key replaces that occupant.' },
  ],
  chain: [
    { name: 'select', requirement: 'required', type: '(owner) => unknown | null', doc: 'Pure routing selector. Entries are tried in ascending order; the first non-null result wins and arrives as the component\'s `matched` prop. All-null falls through to the owner\'s fallback.' },
  ],
}

/** The one register option a dynamic package must NOT pass, and why. */
/* 中文说明：常量 PRIORITY_NOTE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PRIORITY_NOTE = 'Do NOT pass `priority`: the browser-half facade assigns one automatically, and it is LOWER than every shipped entry — in a single or keyed cell that means your entry is the one that renders.'

/** Cross-cutting rules a registrant needs once, not per slot. */
/* 中文说明：常量 CLIENT_NOTES 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CLIENT_NOTES: readonly string[] = [
  'Contribute UI only through `ctx.slots.register(options, Component)`; declare `inject: [\'slots\']` in your returned plugin (object form) or the seat is withheld.',
  'Wrap every registration in `ctx.slots.inject(key, () => ctx.slots.register(...))`. A slot exists only while the entry that declared it is mounted, and registering into an undeclared slot throws; `inject` runs your registration when the declaration is (or becomes) live and re-runs it if the owner remounts.',
  PRIORITY_NOTE,
  'You cannot `import` anything, so the design-system components are out of reach: build markup with `React.createElement` and ship CSS through `styles.insert(css)`. Use the theme CSS variables (`var(--dsw-alias-bg-layer-1)`, `var(--dsw-alias-label-primary)`, …) instead of literal colors, or your contribution breaks in the other color scheme.',
  'Every component receives the framework hook seats listed under `framework props` for its scope; a selector hook is called with a selector, e.g. `useSessions(state => state.current)`.',
  'This catalog is the COMPILE-TIME contract of the shipped web bundle, not a snapshot of one page: a key is registrable only where the owner that declares it is mounted. A failed registration surfaces in the browser-half load report — read it back with `cordis_inspect what:"temporary"`.',
]

/** Standard-kit interface that applies to each scope, beyond the global one. */
/* 中文说明：常量 SCOPE_KIT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCOPE_KIT: Readonly<Record<(typeof SCOPES)[number], string | undefined>> = {
  'root': undefined,
  'session': 'SessionStandardProps',
  'session-maybe': 'SessionMaybeStandardProps',
}

/** One resolved catalog entry, ready to render. */
/* 中文说明：interface SlotEntry 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface SlotEntry {
  readonly key: string
  readonly kind: string
  readonly scope: string
  readonly summary: string
  readonly doc: string
  readonly registerOptions: readonly OptionDoc[]
  readonly ownerProps: readonly string[]
  readonly ownerPropsReferences: readonly string[]
  readonly standardProps: readonly string[]
  readonly keyDomain: string
  readonly hookContext: string
  readonly slotInject: string
  readonly declaredBy: string
  readonly occupants: readonly string[]
  readonly replaceRisk: string
  readonly example: string
  readonly source: string
}

/**
 * Read the workspace and resolve every catalog entry, failing loud on a
 * contract the catalog cannot teach.
 * @param scanRoot - repository root to scan.
 * @returns the entries, sorted by key.
 * @throws when any declared slot is unteachable or the scan contradicts itself.
 */
/* 中文说明：函数 collectSlotEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function collectSlotEntries(scanRoot: string): SlotEntry[] {
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = scanSlotFiles(scanRoot, SOURCE_GLOBS)
  /** 中文说明：函数值 declarations 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const declarations = files.flatMap(file => slotDeclarations(file))
  /** 中文说明：函数值 registrations 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const registrations = files.flatMap(file => slotRegistrations(file))
  /** 中文说明：变量 types 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const types = indexExportedTypes(scanRoot, SOURCE_GLOBS)
  /** 中文说明：变量 problems 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const problems = validateSlotContracts(declarations, registrations, types)
  if (problems.length > 0) {
    throw new Error(`gen-client-catalog: ${String(problems.length)} contract violation(s):\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = resolveSlotEntries(declarations, registrations, types, standardKits(files))
  /** 中文说明：变量 oversized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const oversized = oversizedSlotReports(entries)
  if (oversized.length > 0) {
    throw new Error(`gen-client-catalog: ${String(oversized.length)} slot(s) exceed the per-slot report budget `
      + `of ${String(MAX_ENTRY_LINES)} lines:\n${oversized.map(problem => `  ${problem}`).join('\n')}`)
  }
  return entries
}

/**
 * Slots whose expanded report exceeds {@link MAX_ENTRY_LINES}. Separated from
 * the scan so the budget is provable on one hand-built entry.
 * @param entries - resolved catalog entries.
 * @returns one message per over-budget slot, empty when every report is readable.
 */
/* 中文说明：函数 oversizedSlotReports 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function oversizedSlotReports(entries: readonly SlotEntry[]): string[] {
  return entries
    .filter(entry => entryLines(entry) > MAX_ENTRY_LINES)
    .map(entry => `slot '${entry.key}' (${entry.source}) reports ${String(entryLines(entry))} lines. `
      + 'Narrow the owner share it passes down (a slot hands a registrant a share, not a subsystem) or tighten '
      + 'its prose, so asking about one slot stays cheaper than asking about all of them.')
}

/** Line count of one entry's variable-length content, the proxy for its rendered report. */
/* 中文说明：函数 entryLines 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function entryLines(entry: SlotEntry): number {
  /** 中文说明：函数值 blocks 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const blocks = [entry.doc, entry.example, ...entry.ownerProps, ...entry.registerOptions.map(option => option.doc)]
  return blocks.reduce((total, block) => total + block.split('\n').length, 0)
    + entry.standardProps.length + entry.ownerPropsReferences.length + entry.occupants.length
}

/**
 * Fail-closed contract checks: an unteachable slot must break the gate rather
 * than ship an entry a model cannot act on. Pure, so every rejection is
 * provable without scanning the workspace.
 * @param declarations - every declared slot.
 * @param registrations - every registration call site.
 * @param types - exported type index the owner-props reference resolves against.
 * @returns one message per violation, empty when the surface is teachable.
 */
/* 中文说明：函数 validateSlotContracts 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function validateSlotContracts(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
): string[] {
  /** 中文说明：变量 problems 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const problems: string[] = []
  /** 中文说明：变量 byKey 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byKey = new Map<string, SlotDeclaration>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const declaration of declarations) {
    /** 中文说明：变量 where 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const where = `slot '${declaration.key}' (${declaration.source})`
    /** 中文说明：变量 previous 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previous = byKey.get(declaration.key)
    if (previous !== undefined) {
      problems.push(`${where} is also declared at ${previous.source}; SlotMap merges duplicates silently, so the catalog cannot tell which documentation wins.`)
      continue
    }
    byKey.set(declaration.key, declaration)
    if (!(KINDS as readonly string[]).includes(declaration.kind)) {
      problems.push(`${where} has no literal 'kind'; the catalog derives the register options from it, so it must be one of ${KINDS.join('/')}.`)
    }
    if (!(SCOPES as readonly string[]).includes(declaration.scope)) {
      problems.push(`${where} has no literal 'scope'; the catalog derives the framework props from it, so it must be one of ${SCOPES.join('/')}.`)
    }
    if (docProse(declaration.jsDoc) === '') {
      problems.push(`${where} has no JSDoc prose. Write it from the REGISTRANT's side: what to pass, what the component receives, whom a registration replaces, and what absence looks like (packages/client/ui-settings/src/client/contract/slots.ts is the template).`)
    }
    if (declaration.ownerType !== undefined
      && /^[A-Za-z_$][\w$]*$/.test(declaration.ownerType)
      && !types.has(declaration.ownerType)) {
      problems.push(`${where} names owner props '${declaration.ownerType}' that no exported declaration provides; export the interface so the catalog can show what the component receives.`)
    }
  }
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const registration of registrations) {
    if (!byKey.has(registration.key)) {
      problems.push(`registration into '${registration.key}' (${registration.source}) targets a slot no SlotMap merge declares; either the scan has a blind spot or the registration is dead.`)
    }
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const child of registration.children) {
      if (!byKey.has(child)) {
        problems.push(`registration at ${registration.source} declares child slot '${child}' that no SlotMap merge types.`)
      }
    }
  }
  return problems
}

/**
 * Project validated declarations into catalog entries: cardinality decides the
 * register options, scope decides the framework props, and the registration
 * call sites decide who already sits in the seat and which owner's mount makes
 * it exist. Pure, so the projection facts are provable without a workspace.
 * @param declarations - validated slot declarations.
 * @param registrations - every registration call site.
 * @param types - exported type index for owner-props expansion.
 * @param kits - framework prop seats per scope.
 * @returns the entries, sorted by key.
 */
/* 中文说明：函数 resolveSlotEntries 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function resolveSlotEntries(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry[] {
  /** 中文说明：变量 declaredBy 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declaredBy = new Map<string, SlotRegistration>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const registration of registrations) {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const child of registration.children) {
      if (!declaredBy.has(child)) declaredBy.set(child, registration)
    }
  }
  return declarations
    .map(declaration => entryOf(declaration, registrations, declaredBy.get(declaration.key), types, kits))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/** The framework prop seats per scope, read from the merged standard-kit interfaces. */
/* 中文说明：函数 standardKits 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function standardKits(files: readonly ScannedFile[]): ReadonlyMap<string, readonly string[]> {
  /** 中文说明：变量 global 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const global = standardKitMembers(files, 'GlobalStandardProps')
  /** 中文说明：变量 kits 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const kits = new Map<string, readonly string[]>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const scope of SCOPES) {
    /** 中文说明：变量 extra 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const extra = SCOPE_KIT[scope]
    kits.set(scope, [...global, ...extra === undefined ? [] : standardKitMembers(files, extra)])
  }
  return kits
}

/** Resolve one declaration into its catalog entry. */
/* 中文说明：函数 entryOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function entryOf(
  declaration: SlotDeclaration,
  registrations: readonly SlotRegistration[],
  declaredBy: SlotRegistration | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry {
  /** 中文说明：函数值 occupants 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const occupants = registrations.filter(registration => registration.key === declaration.key)
  /** 中文说明：函数值 cellOccupied 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const cellOccupied = occupants.some(occupant =>
    declaration.kind === 'single' || occupant.entryKey !== undefined)
  /** 中文说明：变量 doc 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const doc = docProse(declaration.jsDoc)
  /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const owner = ownerShapes(declaration.ownerType, types)
  return {
    key: declaration.key,
    kind: declaration.kind,
    scope: declaration.scope,
    summary: firstSentence(doc),
    doc,
    registerOptions: REGISTER_OPTIONS[declaration.kind as (typeof KINDS)[number]],
    ownerProps: owner.declarations.map(type => truncate(type.text)),
    ownerPropsReferences: owner.references,
    standardProps: kits.get(declaration.scope) ?? [],
    keyDomain: keyDomainOf(declaration, occupants),
    hookContext: declaration.hookContext ?? '',
    slotInject: declaration.injectType ?? '',
    declaredBy: declaredBy === undefined
      ? 'the runtime itself (built in; always present)'
      : `an entry in '${declaredBy.key}' (${shortPackage(declaredBy.package)}), so it exists while that entry is mounted`,
    occupants: occupants.map(occupant => [
      shortPackage(occupant.package),
      occupant.component,
      ...occupant.id === undefined ? [] : [`id '${occupant.id}'`],
      ...occupant.entryKey === undefined ? [] : [`key '${occupant.entryKey}'`],
    ].join(' ')),
    replaceRisk: cellOccupied && (declaration.kind === 'single' || declaration.kind === 'keyed')
      ? 'shadows-shipped-ui'
      : 'none',
    example: exampleOf(declaration),
    source: declaration.source,
  }
}

/**
 * The owner-props contract at ONE level: the owner declaration(s) themselves,
 * plus the names of the shapes their fields reference. Expanding transitively
 * pulled the whole session model into four seats (one report exceeded 2400
 * lines), which defeats the purpose of narrowing to a single slot — a registrant
 * needs the fields and their documented meaning, not the type graph behind them.
 */
/* 中文说明：函数 ownerShapes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function ownerShapes(
  ownerType: string | undefined,
  types: ReadonlyMap<string, TypeDeclaration>,
): { declarations: TypeDeclaration[]; references: string[] } {
  if (ownerType === undefined) return { declarations: [], references: [] }
  /** 中文说明：变量 declarations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declarations = declaredTypes(referencedTypeNames([ownerType], types), types)
  /** 中文说明：函数值 own 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const own = new Set(declarations.map(declaration => declaration.name))
  /** 中文说明：函数值 references 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const references = referencedTypeNames(declarations.map(declaration => declaration.text), types)
    .filter(name => !own.has(name))
  return { declarations, references }
}

/** How a keyed slot's key domain is constrained, '' for the other kinds. */
/* 中文说明：函数 keyDomainOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function keyDomainOf(declaration: SlotDeclaration, occupants: readonly SlotRegistration[]): string {
  if (declaration.kind !== 'keyed') return ''
  /** 中文说明：函数值 taken 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const taken = [...new Set(occupants.flatMap(occupant => occupant.entryKey === undefined ? [] : [occupant.entryKey]))].sort()
  /** 中文说明：变量 shipped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const shipped = taken.length === 0 ? 'none are taken yet' : `already taken: ${taken.join(', ')}`
  return declaration.keyProps === undefined
    ? `open: any string the owner dispatches (no compile-time key set), ${shipped}`
    : `fixed by the owner's key table ${declaration.keyProps}, ${shipped}`
}

/** A runnable minimal registration for one slot, per cardinality. */
/* 中文说明：函数 exampleOf 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function exampleOf(declaration: SlotDeclaration): string {
  /** 中文说明：变量 options 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const options = [`name: '${declaration.key}'`, ...KIND_EXAMPLE[declaration.kind] ?? []].join(', ')
  return [
    'return {',
    "  inject: ['slots'],",
    '  apply(ctx) {',
    `    ctx.slots.inject('${declaration.key}', () => ctx.slots.register(`,
    `      { ${options} },`,
    "      () => React.createElement('div', null, 'hello'),",
    '    ))',
    '  },',
    '}',
  ].join('\n')
}

/** Extra example options per cardinality. */
/* 中文说明：常量 KIND_EXAMPLE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const KIND_EXAMPLE: Readonly<Record<string, readonly string[]>> = {
  single: [],
  list: ["id: 'my-entry'", 'order: 100', "label: 'My entry'"],
  keyed: ["key: '<one key the owner dispatches>'"],
  chain: ['select: owner => null'],
}

/** Drop the `@deepseek-ai/dsh-` prefix so rows stay readable. */
/* 中文说明：函数 shortPackage 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function shortPackage(name: string): string {
  return name.replace('@deepseek-ai/dsh-', '')
}

/** Truncate an over-long declaration, naming the truncation. */
/* 中文说明：函数 truncate 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function truncate(text: string): string {
  return text.length > MAX_DECL_CHARS
    ? `${text.slice(0, MAX_DECL_CHARS)} /* …truncated — full shape in source */`
    : text
}

/** JSDoc prose: comment markers and block tags removed, paragraphs kept. */
/* 中文说明：函数 docProse 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function docProse(jsDoc: string): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = jsDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  /** 中文说明：变量 kept 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const kept: string[] = []
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const line of lines) {
    if (line.trimStart().startsWith('@')) break
    kept.push(line)
  }
  return kept.join('\n').replace(/\{@link\s+([^}]+)\}/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

/** First sentence of a prose block, for the compact listing. */
/* 中文说明：函数 firstSentence 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function firstSentence(doc: string): string {
  /** 中文说明：变量 flat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const flat = doc.replace(/\s+/g, ' ').trim()
  /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const match = /^(.*?[.!?])(?:\s|$)/.exec(flat)
  return (match?.[1] ?? flat).trim()
}

/** Render one value as a single-quoted TypeScript literal. */
/* 中文说明：函数 quote 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

/** Render a readonly string-array literal. */
/* 中文说明：函数 list 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function list(values: readonly string[], indent: string): string {
  if (values.length === 0) return '[]'
  return ['[', ...values.map(value => `${indent}  ${quote(value)},`), `${indent}]`].join('\n')
}

/**
 * Render the generated data module.
 * @param entries - resolved catalog entries.
 * @returns the module source.
 */
/* 中文说明：函数 renderClientCatalog 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function renderClientCatalog(entries: readonly SlotEntry[]): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines: string[] = [
    '/**',
    ' * Generated by scripts/gen-client-catalog.ts — do not edit by hand; run',
    ' * `pnpm run gen-client-catalog` to regenerate (freshness-gated by',
    ' * `pnpm run verify-client-catalog` in doc-sync).',
    ' *',
    ' * The compile-time contract of the shipped web bundle\'s slot surface, as',
    ' * `cordis_inspect what:"client"` serves it to the model: every SlotMap key a',
    ' * browser half can register into, what that register call must pass, what the',
    ' * component receives, who already occupies the seat, and which owner has to be',
    ' * mounted for the seat to exist. Data only — this module is the one legitimate',
    ' * meeting point of the two planes, so it carries strings, never client imports.',
    ' *',
    ' * @module @deepseek-ai/dsh-cordis-client-runner/client/slot-catalog',
    ' */',
    '',
    '/* 【文件职责】生成浏览器插槽的类型、拥有者及贡献目录，供 cordis_inspect 查询可用组合位置。 */',
    '',
    '/* jscpd:ignore-start */',
    '/** One option a register call passes for a given slot cardinality. */',
    'export interface ClientSlotOption {',
    '  /** Option name as written in the register options object. */',
    '  name: string',
    '  /** Whether the cardinality requires it. */',
    '  requirement: string',
    '  /** Accepted type, in source spelling. */',
    '  type: string',
    '  /** What it does, from the registrant\'s side. */',
    '  doc: string',
    '}',
    '',
    '/** One browser-half slot a dynamic package can contribute UI into. */',
    'export interface ClientSlotEntry {',
    '  /** SlotMap key passed as the register call\'s `name`. */',
    '  key: string',
    '  /** Cardinality: `single`, `list`, `keyed`, or `chain`. */',
    '  kind: string',
    '  /** Data scope: `root`, `session`, or `session-maybe`. */',
    '  scope: string',
    '  /** First sentence of the contract prose. */',
    '  summary: string',
    '  /** Full contract prose from the SlotMap declaration. */',
    '  doc: string',
    '  /** Options this cardinality accepts (beyond `name`). */',
    '  registerOptions: readonly ClientSlotOption[]',
    '  /** Declarations of the props the owner passes down, with their own documentation. */',
    '  ownerProps: readonly string[]',
    '  /** Names of the shapes those props reference; deliberately not expanded here. */',
    '  ownerPropsReferences: readonly string[]',
    '  /** Framework-supplied component props for this scope. */',
    '  standardProps: readonly string[]',
    '  /** For keyed slots: how the key set is constrained and which keys are taken. */',
    '  keyDomain: string',
    '  /** Opaque per-render-site context passed to slot-level hooks, when the slot declares one. */',
    '  hookContext: string',
    '  /** Slot-level inject face every entry receives, when the slot declares one. */',
    '  slotInject: string',
    '  /** Which mounted entry makes this slot exist. */',
    '  declaredBy: string',
    '  /** Entries the shipped composition already registered here. */',
    '  occupants: readonly string[]',
    '  /** `shadows-shipped-ui` when registering here replaces shipped UI; `none` when additive. */',
    '  replaceRisk: string',
    '  /** A minimal browser half that registers into this slot. */',
    '  example: string',
    '  /** Source pointer of the contract declaration. */',
    '  source: string',
    '}',
    '',
    '/** Rules that apply to every browser-half contribution, in reading order. */',
    'export const CLIENT_NOTES: readonly string[] = [',
    ...CLIENT_NOTES.map(note => `  ${quote(note)},`),
    ']',
    '',
    '/** Every slot the shipped web bundle declares, sorted by key. */',
    // The entries below repeat by nature: seats of one cardinality share their
    // register options and framework props verbatim, and that sameness is the
    // contract a registrant reads, not a refactor waiting to happen. Clone
    // detection is told so here rather than through a config exception, which is
    // how this repository marks duplication that belongs to its subject.
    '// Seats of one cardinality repeat their register options and framework props',
    '// verbatim; that sameness IS the contract a registrant reads, so clone',
    '// detection is told to skip the data rather than the file.',
    'export const CLIENT_SLOT_API: readonly ClientSlotEntry[] = [',
  ]
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const entry of entries) {
    lines.push('  {')
    lines.push(`    key: ${quote(entry.key)},`)
    lines.push(`    kind: ${quote(entry.kind)},`)
    lines.push(`    scope: ${quote(entry.scope)},`)
    lines.push(`    summary: ${quote(entry.summary)},`)
    lines.push(`    doc: ${quote(entry.doc)},`)
    if (entry.registerOptions.length === 0) {
      lines.push('    registerOptions: [],')
    } else {
      lines.push('    registerOptions: [')
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const option of entry.registerOptions) {
        lines.push('      {')
        lines.push(`        name: ${quote(option.name)},`)
        lines.push(`        requirement: ${quote(option.requirement)},`)
        lines.push(`        type: ${quote(option.type)},`)
        lines.push(`        doc: ${quote(option.doc)},`)
        lines.push('      },')
      }
      lines.push('    ],')
    }
    lines.push(`    ownerProps: ${list(entry.ownerProps, '    ')},`)
    lines.push(`    ownerPropsReferences: ${list(entry.ownerPropsReferences, '    ')},`)
    lines.push(`    standardProps: ${list(entry.standardProps, '    ')},`)
    lines.push(`    keyDomain: ${quote(entry.keyDomain)},`)
    lines.push(`    hookContext: ${quote(entry.hookContext)},`)
    lines.push(`    slotInject: ${quote(entry.slotInject)},`)
    lines.push(`    declaredBy: ${quote(entry.declaredBy)},`)
    lines.push(`    occupants: ${list(entry.occupants, '    ')},`)
    lines.push(`    replaceRisk: ${quote(entry.replaceRisk)},`)
    lines.push(`    example: ${quote(entry.example)},`)
    lines.push(`    source: ${quote(entry.source)},`)
    lines.push('  },')
  }
  lines.push(']', '/* jscpd:ignore-end */', '')
  return lines.join('\n')
}

/**
 * CLI entry: regenerate the catalog, or with `--check` fail when it is stale.
 * @returns nothing; writes the artifact or reports freshness through the process.
 */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function main(): void {
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = renderClientCatalog(collectSlotEntries(root))
  /** 中文说明：变量 destination 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const destination = resolve(root, OUT)
  if (process.argv.includes('--check')) {
    /** 中文说明：变量 committed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let committed: string | null = null
    try {
      committed = readFileSync(destination, 'utf8')
    } catch {
      // Only ENOENT (never generated) is expected here, and its remedy is the
      // same as a stale artifact's: regenerate.
      committed = null
    }
    if (committed === content) {
      console.log(`gen-client-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-client-catalog: stale — ${OUT}. Run \`pnpm run gen-client-catalog\` and commit the result.`)
    process.exit(1)
  }
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, content)
  console.log(`gen-client-catalog: wrote ${OUT}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
