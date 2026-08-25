/**
 * Local typings for use-sync-external-store 1.2.0: the package ships no types
 * and the DefinitelyTyped package is unavailable offline. Mirrors the shim's
 * with-selector build (the only entry this package consumes).
 */
/*
 * 文件职责：为离线缺少类型的外部 store selector shim 补充精确声明。
 * 技术维度：使用泛型环境模块声明描述订阅、快照、选择器和相等比较函数。
 * 产品维度：React 界面只在选中状态真实变化时重渲染，保持外部 store 响应性。
 * 逻辑维度：订阅变化、读取客户端或服务端快照、选择局部值并可选比较。
 * 关键边界：声明只覆盖项目实际导入的 with-selector 入口，版本升级需重新核对。
 * 新手阅读建议：按 subscribe、getSnapshot、selector、isEqual 顺序理解数据流。
 */
declare module 'use-sync-external-store/shim/with-selector.js' {
  /**
   * 订阅外部 store 并返回 selector 选出的值。
   * @param subscribe 注册变化回调并返回注销函数。
   * @param getSnapshot 返回客户端当前快照，未变化时应保持引用稳定。
   * @param getServerSnapshot 服务端快照读取器；本项目可传 undefined 或 null。
   * @param selector 把完整快照转换为组件需要的选择值。
   * @param isEqual 可选相等比较器，返回 true 时跳过该次选择值更新。
   * @returns 当前选择值，类型由 Selection 泛型决定。
   * @example `useSyncExternalStoreWithSelector(subscribe, get, undefined, s => s.value)`
   */
  export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot: undefined | null | (() => Snapshot),
    selector: (snapshot: Snapshot) => Selection,
    isEqual?: (a: Selection, b: Selection) => boolean,
  ): Selection
}
