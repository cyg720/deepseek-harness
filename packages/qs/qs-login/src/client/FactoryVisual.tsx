/**
 * 由原型 factory.svg 机械转换而来：去掉 SVG 内部 <style>（其选择器会泄漏到文档级），
 * 动画改由 CSS Module 驱动；路径与几何保持原样。
 *
 * 插画里画着字（无障名称、设备标签、标语），它们同样是**用户可见文案**，因此由调用方
 * 从字典传入，而不是焊在 SVG 里——否则英文界面会显示中文。
 */
import type { ReactNode } from 'react'
import styles from './factory.module.css'

/** 插画内的可本地化文案。 */
export interface FactoryVisualLabels {
  /** 无障名称（图形替代文本）。 */
  readonly label: string
  /** 中央枢纽的字标。 */
  readonly hub: string
  /** 三个设备标签。 */
  readonly monitor: string
  readonly vision: string
  readonly sensing: string
  /** 底部标语。 */
  readonly tagline: string
}

/**
 * 渲染"一个人，通过 AI 连接整座工厂"插画。
 * @param labels - 插画内的可本地化文案。
 * @returns 内联 SVG 节点。
 */
export function FactoryVisual({ labels }: { readonly labels: FactoryVisualLabels }): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 840 520"
      role="img"
      aria-label={labels.label}
      className={styles.visual}
    >

      <defs>
        <linearGradient id="floor" x2="0" y2="1"><stop stopColor="#2a4a37" stopOpacity=".6" /><stop offset="1" stopColor="#152e24" stopOpacity="0" /></linearGradient>
        <linearGradient id="top" x2=".6" y2="1"><stop stopColor="#6e9463" /><stop offset="1" stopColor="#38543d" /></linearGradient>
        <linearGradient id="wall" x2="1" y2="1"><stop stopColor="#34543f" /><stop offset="1" stopColor="#213b2d" /></linearGradient>
        <linearGradient id="glass" x2="0" y2="1"><stop stopColor="#d7f58e" stopOpacity=".26" /><stop offset="1" stopColor="#d7f58e" stopOpacity=".02" /></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="3" /></filter>
        <pattern id="grid" width="50" height="29" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .48 -1 .48 420 90)"><path d="M50 0H0V29" fill="none" stroke="#82a676" strokeOpacity=".14" strokeWidth=".8" /></pattern>
      </defs>

      <ellipse cx="414" cy="314" rx="350" ry="165" fill="url(#floor)" />
      <path d="M420 83 817 280 423 478 22 279Z" fill="url(#grid)" />
      <g fill="none" stroke="#769261" strokeWidth="1.1" opacity=".35"><path d="M70 310 420 478 780 298" /><path d="M97 330 420 487 749 326" /></g>

      <g transform="translate(120 165)">
        <path d="M0 52 110 0 209 48 100 104Z" fill="url(#top)" stroke="#799568" strokeWidth=".8" />
        <path d="M0 52 100 104V181L0 127Z" fill="url(#wall)" stroke="#52734e" strokeWidth=".8" />
        <path d="M100 104 209 48V123L100 181Z" fill="#294631" stroke="#52734e" strokeWidth=".8" />
        <path d="M29 52 66 34 165 81M53 41 91 22 189 69" stroke="#90ac76" strokeWidth="2" fill="none" />
        <g fill="#9fbc75" opacity=".5"><path d="M13 77 31 87V112L13 102Z" /><path d="M41 92 60 102V126L41 116Z" /><path d="M71 107 88 116V141L71 132Z" /></g>
        <path d="M117 111 190 73V90L117 129Z" fill="#7b9f64" opacity=".35" />
        <path d="M126 143 146 133V157L126 168Z" fill="#111f18" /><path d="M160 126 179 116V140L160 150Z" fill="#111f18" />
      </g>
      <g transform="translate(490 140)">
        <path d="M0 58 102 7 213 62 111 114Z" fill="url(#top)" stroke="#68885b" />
        <path d="M0 58 111 114V181L0 122Z" fill="url(#wall)" stroke="#55734b" />
        <path d="M111 114 213 62V129L111 181Z" fill="#294432" stroke="#55734b" />
        <path d="M28 57 84 29 164 68 109 97Z" fill="#203c2f" stroke="#789e67" />
        <path d="M43 54 122 94M65 42 143 83M92 47 38 74M117 59 61 85" stroke="#789e67" opacity=".5" />
        <path d="M16 85 94 125V145L16 104Z" fill="#729661" opacity=".4" />
        <g fill="#658954" opacity=".5"><path d="M124 125 141 116V135L124 144Z" /><path d="M152 111 170 102V120L152 129Z" /><path d="M181 96 199 87V106L181 115Z" /></g>
      </g>
      <g transform="translate(348 101)">
        <path d="M0 43 62 12 121 42 59 73Z" fill="#628456" stroke="#7e9e69" />
        <path d="M0 43 59 73V133L0 102Z" fill="#35563d" /><path d="M59 73 121 42V102L59 133Z" fill="#294432" />
        <path d="M14 13 37 2 58 12 35 23Z" fill="#91a974" /><path d="M14 13 35 23V68L14 57Z" fill="#4c6c46" /><path d="M35 23 58 12V57L35 68Z" fill="#35533a" />
        <path d="M69 18 91 7 110 17 89 28Z" fill="#91a974" /><path d="M69 18 89 28V62L69 52Z" fill="#4c6c46" /><path d="M89 28 110 17V52L89 62Z" fill="#35533a" />
        <path d="M16 81 46 96V110L16 95Z" fill="#b3ce7e" opacity=".5" />
      </g>
      <g transform="translate(570 340)"><path d="M0 21 43 0 91 24 47 45Z" fill="#769765" /><path d="M0 21 47 45V75L0 49Z" fill="#3f6042" /><path d="M47 45 91 24V54L47 75Z" fill="#294b32" /><path d="M11 26 38 40M54 40 78 29" stroke="#b4ce88" strokeWidth="2" /></g>
      <g fill="none" stroke="#bbdf85" strokeWidth="1.5" opacity=".7"><path className={styles['dash']} d="M418 341 303 285 232 285" /><path className={styles['dash']} d="M421 337V239L408 227" /><path className={styles['dash']} d="M421 340 530 286 586 286" /><path className={styles['dash']} d="M420 352 522 402 602 379" /></g>
      <g className={styles['pulse']} fill="#d6f5a0"><circle cx="232" cy="285" r="4" /><circle cx="408" cy="227" r="4" /><circle cx="586" cy="286" r="4" /><circle cx="602" cy="379" r="4" /></g>
      <g className={styles['float']}>
        <path d="M350 326 420 291 490 326 420 361Z" fill="#476f42" stroke="#b9d687" strokeWidth="1" />
        <path d="M350 326 420 361V377L350 342Z" fill="#375737" /><path d="M420 361 490 326V342L420 377Z" fill="#28482f" />
        <path d="M366 324 420 298 474 324 420 350Z" fill="#d8f38b" opacity=".2" />
        <path d="M365 321V251L420 224 475 251V321" fill="url(#glass)" stroke="#c9e698" strokeOpacity=".35" />
        <path d="M365 251 420 279 475 251M420 279V350" fill="none" stroke="#d8f38b" strokeOpacity=".4" />
        <text x="402" y="290" fill="#e3f8b4" fontSize="27" transform="skewY(0)">{labels.hub}</text>
      </g>

      <g transform="translate(334 392)">
        <ellipse cx="30" cy="72" rx="32" ry="11" fill="#0f231b" opacity=".65" />
        <path d="M25 31 20 65M35 31 39 65" stroke="#90a890" strokeWidth="8" strokeLinecap="round" />
        <path d="M18 10Q29 0 40 10L40 38Q29 44 17 35Z" fill="#c5d4a8" />
        <circle cx="29" cy="-1" r="10" fill="#cbd8b1" />
        <path d="M20 0Q14-16 31-13Q41-12 39-2" fill="#284230" />
        <path d="M18 14 5 24 0 14M39 14 52 24 61 12" stroke="#b9cba0" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M-6-18 56-47 83-33 20-2Z" fill="#d8f38b" opacity=".2" stroke="#d6edac" />
        <path d="M20-2V15L83-17V-33" fill="url(#glass)" stroke="#c9dfaa" strokeOpacity=".5" />
        <path d="M6-18 29-29M16-13 45-27M37-26 55-35" stroke="#d4eca9" strokeWidth="2" opacity=".75" />
      </g>
      <g fontSize="10" fill="#b5caa7">
        <g transform="translate(72 160)"><rect width="121" height="29" rx="7" fill="#274535" stroke="#597550" strokeWidth=".7" /><circle cx="13" cy="15" r="3" fill="#b4dc7d" /><text x="25" y="19">{labels.monitor}</text></g>
        <g transform="translate(587 142)"><rect width="122" height="29" rx="7" fill="#274535" stroke="#597550" strokeWidth=".7" /><circle cx="13" cy="15" r="3" fill="#b4dc7d" /><text x="25" y="19">{labels.vision}</text></g>
        <g transform="translate(393 70)"><rect width="112" height="29" rx="7" fill="#274535" stroke="#597550" strokeWidth=".7" /><circle cx="13" cy="15" r="3" fill="#b4dc7d" /><text x="25" y="19">{labels.sensing}</text></g>
        <text x="512" y="442" fill="#809978" fontSize="9" letterSpacing="2">{labels.tagline}</text>
      </g>
    </svg>
  )
}
