/** Frozen released-v0 physical codec and identity migration into shared-layout v1. */

/*
 * 【文件职责】导出冻结的 v0 编解码器及共享布局 v1 的身份迁移，保持已发布数据可按原语义读取。
 */

export * from './codec.ts'
export * from './dispositions.ts'
export * from './migration.ts'
export { assertReleasedPayloadSemantics } from './payload-validation.ts'
export { assertReleasedArtifactRelationships } from './relationships.ts'
export {
  assertReleasedSurfaceMetadata,
  assertReleasedV1Artifact,
  assertReleasedV1Header,
  restoreReleasedV1Artifact,
} from './validation.ts'
