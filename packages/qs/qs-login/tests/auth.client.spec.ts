import { describe, expect, it } from 'vitest'
import {
  assertCredentials, createLocalAuthGateway, DEMO_PASSWORD, DEMO_USERNAME, QsSignInError,
} from '../src/client/auth-gateway.ts'

describe('登录接缝校验', () => {
  it('空用户名或空口令被拒', () => {
    const blankUser = (): void => { assertCredentials({ username: ' ', password: 'x'.repeat(8) }) }
    expect(blankUser).toThrow(QsSignInError)
    const blankPassword = (): void => { assertCredentials({ username: 'admin', password: '' }) }
    expect(blankPassword).toThrow(/empty-password/)
  })

  it('口令短于 6 位被拒', () => {
    const shortPassword = (): void => { assertCredentials({ username: 'admin', password: '12345' }) }
    expect(shortPassword).toThrow(/too-short/)
  })

  it('演示账号通过，其它凭据被拒（延时设为 0 以便单测）', async () => {
    const gateway = createLocalAuthGateway(0)
    await expect(gateway.signIn({ username: DEMO_USERNAME, password: DEMO_PASSWORD }))
      .resolves.toBeUndefined()
    await expect(gateway.signIn({ username: 'admin', password: 'wrongpass' }))
      .rejects.toThrow(/rejected/)
  })

  it('失败错误只带原因判别式，不回显口令', async () => {
    const gateway = createLocalAuthGateway(0)
    const error = await gateway
      .signIn({ username: 'admin', password: 'wrong-pass' })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(QsSignInError)
    expect(String(error)).not.toContain('wrong-pass')
  })
})
