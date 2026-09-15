package com.qs.authority.modules.appauthorization;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 应用可见范围授权记录，对应表 {@code qs__auth__app_authorization}。
 *
 * <p>应用编码唯一且不可重复注册；状态由应用中心受控同步，授权中心不提供注册、冻结或下线的管理入口。
 */
@Getter
@Setter
public class AppAuthorization {

    private Long id;
    private String appCode;
    private String appKey;
    private String appSecret;
    private String status;
    private LocalDateTime secretExpireAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;

    /**
     * 应用是否可用于鉴权。
     *
     * @return 状态为 active 时为 true
     */
    public boolean active() {
        return "active".equals(status);
    }
}
