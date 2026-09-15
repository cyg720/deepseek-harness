package com.qs.authority.modules.appauthorization;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 应用授权接口模型。
 *
 * <p>应用凭据（AppKey 与 AppSecret）只出现在建立授权记录的一次性响应中：详情、列表、配置与
 * 状态同步响应都不返回可用作身份的字段，避免“能看详情”被放大成“能用应用中心身份调用”。
 */
public final class AppAuthorizationDtos {

    private AppAuthorizationDtos() {
    }

    /**
     * 建立授权记录请求。
     *
     * @param appCode 应用编码，单企业内唯一且不可重复注册
     * @param appSecretExpireAt AppSecret 过期时间，北京时间 {@code YYYY-MM-DD HH:mm:ss}，可为空
     */
    public record CreateRequest(
            @NotBlank(message = "请输入应用编码") @Size(max = 64, message = "长度不能超过 64 个字符") String appCode,
            String appSecretExpireAt) {
    }

    /**
     * 建立授权记录响应。
     *
     * @param id 授权记录标识
     * @param appCode 应用编码
     * @param appKey 应用密钥，作为应用身份凭据受控交付
     * @param appSecret 应用密钥明文，只在本次响应返回一次
     * @param status 授权状态，新建为 active
     * @param version 当前版本
     */
    public record CreateResponse(String id, String appCode, String appKey, String appSecret, String status,
            String version) {
    }

    /**
     * 应用状态同步请求。
     *
     * @param status 目标状态：active、frozen 或 offline
     * @param version 应用中心读取到的授权记录版本
     */
    public record StateSyncRequest(
            @NotBlank(message = "请输入目标状态") String status,
            @NotBlank(message = "请提交读取时的 version") String version) {
    }

    /**
     * 授权列表条目：不含 AppKey，列表不是凭据交付通道。
     *
     * @param id 授权记录标识
     * @param appCode 应用编码
     * @param status 授权状态
     * @param secretExpireAt AppSecret 过期时间
     * @param permissionGroupIds 当前关联的可见权限组
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record ListItem(String id, String appCode, String status, String secretExpireAt,
            List<String> permissionGroupIds, String createdAt, String updatedAt, String createdBy, String updatedBy,
            String version) {
    }

    /**
     * 授权记录响应字段。
     *
     * @param id 授权记录标识
     * @param appCode 应用编码
     * @param status 授权状态
     * @param secretExpireAt AppSecret 过期时间
     * @param permissionGroupIds 当前关联的可见权限组
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String appCode, String status, String secretExpireAt,
            List<String> permissionGroupIds, String createdAt, String updatedAt, String createdBy, String updatedBy,
            String version) {
    }
}
