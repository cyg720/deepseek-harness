package com.qs.authority.modules.account;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 账号接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}；
 * 响应不包含密码散列或令牌摘要。
 */
public final class AccountDtos {

    private AccountDtos() {
    }

    /**
     * 新增账号请求。
     *
     * @param username 用户名，单企业内唯一
     * @param password 初始密码，仅自然人账号可提交
     * @param phone 手机号，可为空且唯一
     * @param email 邮箱，可为空且唯一
     * @param logo 头像 URL
     * @param remark 备注
     * @param accountType person:自然人, service:服务账号；省略时为 person
     * @param ipWhitelist 服务账号 IP 白名单；服务账号必填且非空
     */
    public record CreateRequest(
            @NotBlank(message = "请输入用户名") @Size(max = 64, message = "长度不能超过 64 个字符") String username,
            @Size(max = 64, message = "长度不能超过 64 个字符") String password,
            @Size(max = 20, message = "长度不能超过 20 个字符") String phone,
            @Size(max = 128, message = "长度不能超过 128 个字符") String email,
            @Size(max = 512, message = "长度不能超过 512 个字符") String logo,
            @Size(max = 512, message = "长度不能超过 512 个字符") String remark,
            String accountType,
            List<@Size(max = 64, message = "长度不能超过 64 个字符") String> ipWhitelist) {
    }

    /**
     * 冻结或解冻请求。
     *
     * @param version 读取时的 version
     */
    public record VersionRequest(@NotBlank(message = "请提交读取时的 version") String version) {
    }

    /**
     * 随机重置密码响应；初始密码只在本次成功响应返回，不入日志、不可再次查询。
     *
     * @param accountId 目标账号标识
     * @param initialPassword 随机初始密码明文
     * @param mustChangePassword 目标账号下次登录必须改密，固定为 true
     */
    public record PasswordResetResponse(String accountId, String initialPassword, boolean mustChangePassword) {
    }

    /**
     * 账号响应字段。
     *
     * @param id 账号标识
     * @param uuid 全局唯一标识符
     * @param username 用户名
     * @param phone 手机号
     * @param email 邮箱
     * @param logo 头像 URL
     * @param remark 备注
     * @param accountType 账号类型
     * @param status 账号状态
     * @param ipWhitelist 服务账号 IP 白名单
     * @param lastLoginAt 最后登录时间
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     * @param mustChangePassword 是否必须改密
     * @param isSuperAdmin 是否内置超级管理员
     */
    public record Detail(String id, String uuid, String username, String phone, String email, String logo,
            String remark, String accountType, String status, List<String> ipWhitelist, String lastLoginAt,
            String createdAt, String updatedAt, String createdBy, String updatedBy, String version,
            boolean mustChangePassword, boolean isSuperAdmin) {
    }
}
