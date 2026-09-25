/** 目录装配门禁同时检查未选分支，防止换平台后才发现缺依赖。 */
import { expect, it } from 'vitest'
import { additionalClientSurfaceReferences, bundlePluginDependencyErrors } from '../verify-cordis-config.ts'

const name = '@deepseek-ai/dsh-host-directory-picker-auto'
const file = 'packages/qs/example/cordis.patch.yml'
it('两分支引用都交给真实 manifest 依赖检查', () => {
  const result = additionalClientSurfaceReferences({ name, config: { additionalClientSurfaces: { native: ['qs-native'], browse: ['qs-browse'] } } }, file)
  expect(result.errors).toEqual([])
  expect(result.references.map(ref => ref.name)).toEqual(['qs-native', 'qs-browse'])
  expect(bundlePluginDependencyErrors('packages/qs/example/package.json', { dependencies: { 'qs-browse': 'workspace:^' } }, result.references)).toEqual([
    `${file}: qs-native must be declared in packages/qs/example/package.json dependencies`,
  ])
})
it.each([
  false,
  { native: 'qs-native' },
  { browse: [{ __jsExpr: 'process.env.PACKAGE' }] },
  { native: ['qs-native', 'qs-native'] },
  { browse: ['@deepseek-ai/dsh-client-ui-directory-picker-native'] },
  { native: [''] },
  { browse: [' qs-browse'] },
])('拒绝非静态、空白或重复的附加配置 %j', (additionalClientSurfaces) => {
  expect(additionalClientSurfaceReferences({ name, config: { additionalClientSurfaces } }, file).errors.length).toBeGreaterThan(0)
})
it('默认和无关插件不增加动态依赖', () => {
  for (const entry of [{ name }, { name, config: {} }, { name: 'unrelated', config: { additionalClientSurfaces: false } }]) {
    expect(additionalClientSurfaceReferences(entry, file)).toEqual({ references: [], errors: [] })
  }
})
