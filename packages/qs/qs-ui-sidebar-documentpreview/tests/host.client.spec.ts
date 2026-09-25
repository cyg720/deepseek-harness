/** Host 入口不复制文件读取服务。 */
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'
it('keeps the Host entry inert', () => { expect(apply).not.toThrow() })
