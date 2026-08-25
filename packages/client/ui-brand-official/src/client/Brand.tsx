/**
 * 文件职责：提供官方品牌鱼形标记和不含标记的名称字标 React 组件。
 * 技术维度：组合 ui-primitives 图形组件，并用交叉类型兼容首页与侧边栏插槽属性。
 * 产品维度：在不同宿主界面一致展示 DeepSeek Harness 官方品牌识别。
 * 逻辑维度：OfficialBrandMark 透传尺寸与类名给 FishLogo；OfficialBrandName 关闭字标内置标记。
 * 关键边界：组件只负责官方素材呈现，不处理点击或导航；标记与名称由不同插槽独立布局。
 * 新手阅读建议：先看 OfficialBrandMarkProps 如何合并两个宿主，再比较两个组件各自输出的图形。
 */
import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

// OfficialBrandMarkProps：同时满足首页品牌标记和侧边栏品牌标记插槽的展示属性。
type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
/*
 * 按宿主请求的尺寸和类名渲染官方鱼形标记。
 * @param props - size 控制图形尺寸，className 提供宿主附加样式。
 * @returns 对应展示属性的 FishLogo 元素。
 * @example <OfficialBrandMark size={24} className="brand" />
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <FishLogo size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
/*
 * 渲染不带独立图形标记的官方名称字标。
 * @returns includeMark 固定为 false 的 BrandWordmark 元素。
 * @example <OfficialBrandName />
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
