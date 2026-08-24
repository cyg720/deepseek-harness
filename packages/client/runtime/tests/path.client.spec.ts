/**
 * 中文说明：
 * - 文件职责：验证客户端主目录路径缩写和工作区相对路径解析规则。
 * - 技术维度：使用 Vitest 和平台无关的纯字符串路径函数。
 * - 产品维度：让界面以 ~ 简洁显示 POSIX 主目录路径，同时正确定位工作区文件。
 * - 逻辑维度：先覆盖主目录本身、后代和反例，再验证相对路径拼接与绝对路径直通。
 * - 关键边界：Windows 驱动器与 UNC 路径不缩写；空、缺失或根目录 home 不参与替换。
 * - 新手阅读建议：先看 POSIX 正例，再比较前缀相邻与 Windows 反例，最后读 resolveWorkspacePath。
 */
import { describe, expect, it } from 'vitest'
import { abbreviateHomePath, resolveWorkspacePath } from '../src/client/workspaces/path.ts'

/** 中文：主目录路径缩写测试组。 */
describe('abbreviateHomePath', () => {
  /** 中文：POSIX home 本身变为 ~，其后代保留相对后缀；无参数和返回值。 */
  it('collapses a POSIX home and its descendants', () => {
    expect(abbreviateHomePath('/Users/u', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/', '/Users/u')).toBe('~')
    expect(abbreviateHomePath('/Users/u/Documents/project', '/Users/u')).toBe('~/Documents/project')
    expect(abbreviateHomePath('/Users/u/Documents/project/', '/Users/u/')).toBe('~/Documents/project/')
  })

  /** 中文：仅字符串前缀相近、非 home、相对或已缩写路径保持原样；无参数和返回值。 */
  it('keeps prefix-adjacent names and non-home paths', () => {
    expect(abbreviateHomePath('/Users/u2/a.ts', '/Users/u')).toBe('/Users/u2/a.ts')
    expect(abbreviateHomePath('/etc/hosts', '/Users/u')).toBe('/etc/hosts')
    expect(abbreviateHomePath('src/a.ts', '/Users/u')).toBe('src/a.ts')
    expect(abbreviateHomePath('~/already', '/Users/u')).toBe('~/already')
  })

  /** 中文：home 缺失、为空或为文件系统根时不缩写；无参数和返回值。 */
  it('does not abbreviate when home is missing, empty, or the filesystem root', () => {
    expect(abbreviateHomePath('/Users/u/a.ts')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/Users/u/a.ts', '')).toBe('/Users/u/a.ts')
    expect(abbreviateHomePath('/etc/hosts', '/')).toBe('/etc/hosts')
    expect(abbreviateHomePath('/etc/hosts', '///')).toBe('/etc/hosts')
  })

  /** 中文：Windows 驱动器和 UNC 路径始终原样返回；无参数和返回值。 */
  it('leaves Windows drive and UNC paths verbatim', () => {
    expect(abbreviateHomePath('C:\\Users\\u\\project', 'C:\\Users\\u')).toBe('C:\\Users\\u\\project')
    expect(abbreviateHomePath('C:/Users/u/project', '/Users/u')).toBe('C:/Users/u/project')
    expect(abbreviateHomePath('/Users/u/project', 'C:\\Users\\u')).toBe('/Users/u/project')
    expect(abbreviateHomePath('\\\\server\\share\\u', '\\\\server\\share\\u')).toBe('\\\\server\\share\\u')
  })
})

/** 中文：工作区路径解析测试组。 */
describe('resolveWorkspacePath', () => {
  /** 中文：相对路径拼到 cwd 下，绝对路径和缺失 cwd 输入直通；无参数和返回值。 */
  it('joins a relative path under cwd and passes absolute paths through', () => {
    expect(resolveWorkspacePath('/w', 'src/a.ts')).toBe('/w/src/a.ts')
    expect(resolveWorkspacePath('/w/', '/abs/a.ts')).toBe('/abs/a.ts')
    expect(resolveWorkspacePath(undefined, 'src/a.ts')).toBe('src/a.ts')
    expect(resolveWorkspacePath('/w', 'C:\\x\\a.ts')).toBe('C:\\x\\a.ts')
  })
})
