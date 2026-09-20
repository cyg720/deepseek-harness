/**
 * 登录接缝。
 *
 * 第一优先**没有后端接口**：`signIn` 走本地模拟校验加固定延时，仅用于验证界面状态机。
 *
 * **不承诺**未来认证接口"零改动"：宿主侧接入（`/qs-auth/*`）会同时改动这里的实现与
 * 错误映射，届时按 05-接口核对表补条目。也**不把登录页当作安全边界**：`/api` 没有
 * 用户级鉴权，登录门只决定首屏渲染哪一个界面。
 */

/** 登录凭据。密码只在这一层使用，不落盘、不进入任何 store 或日志。 */
export interface QsCredentials {
  readonly username: string
  readonly password: string
}

/** 登录失败原因（界面据此选择错误文案键）。 */
export type QsSignInFailureReason = 'empty-username' | 'empty-password' | 'too-short' | 'rejected'

/** 登录失败。 */
export class QsSignInError extends Error {
  override readonly name = 'QsSignInError'

  /**
   * @param reason - 失败原因判别式。
   */
  constructor(readonly reason: QsSignInFailureReason) {
    super(`qs-login: sign-in failed (${reason})`)
  }
}

/** 登录接缝。 */
export interface QsAuthGateway {
  /**
   * 提交登录。
   * @param credentials - 用户名与密码。
   * @returns 校验通过时完成；失败时 reject {@link QsSignInError}。
   */
  signIn(credentials: QsCredentials): Promise<void>
}

/** 演示账号（仅本地校验用，非真实凭据）。 */
export const DEMO_USERNAME = 'admin'
/** 演示口令（仅本地校验用，非真实凭据）。 */
export const DEMO_PASSWORD = 'Demo@2026'

/** 提交中的模拟延时。 */
export const SIGN_IN_DELAY_MS = 600

/**
 * 校验凭据形状；不涉及任何远端调用。
 * @param credentials - 待校验凭据。
 * @throws {QsSignInError} 当用户名或口令为空、或口令长度不足。
 */
export function assertCredentials(credentials: QsCredentials): void {
  if (credentials.username.trim() === '') throw new QsSignInError('empty-username')
  if (credentials.password === '') throw new QsSignInError('empty-password')
  if (credentials.password.length < 6) throw new QsSignInError('too-short')
}

/**
 * 创建本地模拟登录接缝。
 * @param delayMs - 模拟网络延时。
 * @returns 登录接缝实现。
 */
export function createLocalAuthGateway(delayMs: number = SIGN_IN_DELAY_MS): QsAuthGateway {
  return {
    async signIn(credentials: QsCredentials): Promise<void> {
      assertCredentials(credentials)
      await new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
      if (credentials.username.trim() !== DEMO_USERNAME || credentials.password !== DEMO_PASSWORD) {
        throw new QsSignInError('rejected')
      }
    },
  }
}
