/**
 * 登录页。
 *
 * 两栏：左故事栏（品牌 + eyebrow + 标题 + 说明 + 工厂插画 + 页脚），
 * 右表单栏（帮助入口 + kicker + 标题 + 说明 + 用户名/密码 + 自动登录/忘记密码 +
 * 主按钮 + 错误区 + 演示账号 + 安全说明）。
 *
 * 状态机：`idle | submitting | error`。提交中禁用并给出 loading 文案；错误区
 * `role="alert"`；密码可见切换带 `aria-pressed`；IME 组合期不提交。
 */
import { clsx } from 'clsx'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { QsGateProps } from './contract.ts'
import type { QsSignInFailureReason } from './auth-gateway.ts'
import { DEMO_PASSWORD, DEMO_USERNAME, QsSignInError } from './auth-gateway.ts'
import { FactoryVisual } from './FactoryVisual.tsx'
import { QsIcon } from './Icon.tsx'
import styles from './login.module.css'

/**
 * 本机存储是否不可用。
 *
 * store 实例由 qs-login 的 apply 持有（登录页不接 store 座席），因此这里直接探测一次；
 * 探测失败只影响提示文案，不参与登录判定。
 * @returns 不可用时为 true。
 */
function storageDegradedOn(): boolean {
  try {
    localStorage.setItem('dsh.qs.auth.probe', '1')
    localStorage.removeItem('dsh.qs.auth.probe')
    return false
  } catch {
    return true
  }
}

/** 提交阶段。 */
type Phase = 'idle' | 'submitting' | 'error'

/**
 * 渲染登录页。
 * @param props - owner、store、inject 与 locale 四份共享面。
 * @returns 登录页节点。
 */
export function LoginPage(props: QsGateProps): ReactNode {
  const { t, useAuth, signIn, rememberedUser } = props
  const authenticated = useAuth(s => s.authenticated)

  const [username, setUsername] = useState(() => rememberedUser())
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(() => rememberedUser() !== '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<QsSignInFailureReason | 'unknown' | undefined>(undefined)
  const submittingRef = useRef(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setPhase('submitting')
    setFailure(undefined)
    try {
      // 一次调用同时完成网关校验与状态提交：状态写在发布 auth 座席的同一个实例上。
      await signIn({ username, password }, remember)
      setPassword('')
      setPhase('idle')
    } catch (error) {
      setFailure(error instanceof QsSignInError ? error.reason : 'unknown')
      setPhase('error')
    } finally {
      submittingRef.current = false
    }
  }

  // authenticated 由父级 root occupant 决定渲染哪一支；这里只做一次自检，
  // 避免登录页在已登录状态下被意外渲染成"登录中的空壳"。
  void authenticated

  return (
    <div className={clsx('qs-root', styles.login)}>
      <section className={styles.story} aria-hidden="false">
        <div className={clsx('qs-brand', styles.storyBrand)}>
          <span className={clsx('qs-logo-mark', styles.storyLogo)}><QsIcon name="spark" /></span>
          <div>
            <strong>{t('brand.name')}</strong>
            <small>{t('brand.tagline')}</small>
          </div>
        </div>
        <div className={styles.storyCopy}>
          <div className={clsx('qs-eyebrow', styles.storyEyebrow)}>{t('story.eyebrow')}</div>
          <h1 className={styles.storyTitle}>
            {t('story.title').split('\n').map((line, index) => (
              <span key={line} className={index === 1 ? styles.storyTitleAccent : undefined}>
                {index === 0 ? line : <><br />{line}</>}
              </span>
            ))}
          </h1>
          <p className={styles.storyLead}>{t('story.lead')}</p>
        </div>
        <div className={styles.storyVisual} data-qs-factory-visual>
          <FactoryVisual
            labels={{
              label: t('story.visual.label'),
              hub: t('story.visual.hub'),
              monitor: t('story.visual.monitor'),
              vision: t('story.visual.vision'),
              sensing: t('story.visual.sensing'),
              tagline: t('story.visual.tagline'),
            }}
          />
        </div>
        <div className={styles.storyFooter}>
          <span>{t('story.footer.note')}</span>
          <span>{t('story.footer.product')}</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTop}>
          <span>{t('form.help')}</span>
        </div>
        <div className={styles.formWrap}>
          <div className={styles.kicker}>{t('form.kicker')}</div>
          <h2 className={styles.formTitle}>{t('form.title')}</h2>
          <p className={styles.formLead}>{t('form.lead')}</p>
          <form onSubmit={(event) => { void submit(event) }} noValidate>
            <div className="qs-field">
              <label htmlFor="qs-login-user">{t('form.username')}</label>
              <span className={styles.inputWrap}>
                <QsIcon name="user" size="sm" />
                <input
                  id="qs-login-user"
                  name="username"
                  autoComplete="username"
                  placeholder={t('form.usernamePlaceholder')}
                  value={username}
                  disabled={phase === 'submitting'}
                  onChange={(event) => { setUsername(event.target.value) }}
                />
              </span>
            </div>
            <div className="qs-field">
              <label htmlFor="qs-login-password">{t('form.password')}</label>
              <span className={styles.inputWrap}>
                <QsIcon name="shield" size="sm" />
                <input
                  id="qs-login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('form.passwordPlaceholder')}
                  value={password}
                  disabled={phase === 'submitting'}
                  onChange={(event) => { setPassword(event.target.value) }}
                />
                <button
                  type="button"
                  className={clsx('qs-icon-button', styles.inputToggle)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? t('form.hidePassword') : t('form.showPassword')}
                  title={showPassword ? t('form.hidePassword') : t('form.showPassword')}
                  onClick={() => { setShowPassword(value => !value) }}
                >
                  <QsIcon name={showPassword ? 'close' : 'check'} size="sm" />
                </button>
              </span>
            </div>
            <div className={styles.options}>
              <label className="qs-check-label">
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={phase === 'submitting'}
                  onChange={(event) => { setRemember(event.target.checked) }}
                />
                {t('form.remember')}
              </label>
              <button type="button" className="qs-text-button">{t('form.forgot')}</button>
            </div>
            <button
              type="submit"
              className={clsx('qs-btn', 'qs-btn-primary', 'qs-btn-block', styles.submit)}
              disabled={phase === 'submitting'}
            >
              {phase === 'submitting' ? t('form.submitting') : t('form.submit')}
              <QsIcon name="arrow" size="sm" />
            </button>
            <p className={styles.error} role="alert" data-qs-login-error>
              {failure === undefined ? '' : t(`error.${failure}`)}
            </p>
          </form>
          <div className={styles.demo}>
            <p>{t('form.demo')}</p>
            <button
              type="button"
              className="qs-text-button"
              onClick={() => {
                setUsername(DEMO_USERNAME)
                setPassword(DEMO_PASSWORD)
              }}
            >
              {t('form.demoFill')}
            </button>
          </div>
          {storageDegradedOn() ? <p className={styles.degraded}>{t('form.storageDegraded')}</p> : null}
        </div>
        <p className={styles.panelBottom}>{t('form.security')}</p>
      </section>
    </div>
  )
}
