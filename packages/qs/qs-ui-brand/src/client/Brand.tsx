/** Workbench brand presentation, independently mounted from layout. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
/** Render the workbench symbol.
 * @returns Decorative SVG inside the shared logo surface.
 */
export function BrandMark() {
  return <span className="qs-logo-mark"><svg className="qs-icon qs-icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z" /></svg></span>
}
/** Render the localized brand name.
 * @param props - Brand dictionary.
 * @returns Name and tagline.
 */
export function BrandName({ t }: PropsLocale<'qs-ui-brand'>) {
  return <div><strong>{t('name')}</strong><small>{t('tagline')}</small></div>
}
