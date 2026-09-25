/** 仅映射呈现语法，支持范围与官方 code 预览元数据保持一致。 */
const languageExtensions: Readonly<Record<string, readonly string[]>> = {
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  shellscript: ['sh', 'bash', 'zsh'],
  json: ['json', 'jsonc', 'jsonl', 'ndjson'],
  python: ['py', 'pyw', 'pyi'],
  ruby: ['rb', 'rake', 'gemspec'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'],
  csharp: ['cs'],
  kotlin: ['kt', 'kts'],
  swift: ['swift'],
  php: ['php'],
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  ini: ['ini'],
  markdown: ['md', 'markdown'],
  mdx: ['mdx'],
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  sql: ['sql'],
  xml: ['xml', 'xsd', 'xsl', 'xslt'],
  lua: ['lua'],
}

const languages = new Map(Object.entries(languageExtensions)
  .flatMap(([language, extensions]) => extensions.map(extension => [extension, language] as const)))

/**
 * 按官方预览支持的后缀选择公共高亮语法。
 * @param path - 解码后的源文件路径。
 * @returns 公共 CodeBlock 的语法名，未知后缀返回 undefined。
 */
export function languageForPath(path: string): string | undefined {
  const extension = /\.([^./]+)$/u.exec(path.replaceAll('\\', '/'))?.[1]?.toLowerCase()
  return extension === undefined ? undefined : languages.get(extension)
}
