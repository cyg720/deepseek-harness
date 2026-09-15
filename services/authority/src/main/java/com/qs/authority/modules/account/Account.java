package com.qs.authority.modules.account;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 账号记录，对应表 {@code qs__auth__account}。
 *
 * <p>实体只在服务与持久层之间传递；{@code password} 只保存散列，任何接口响应都不得包含它。
 */
@Getter
@Setter
public class Account {

    private Long id;
    /** 全局唯一标识符；UUID 列以文本形式读出。 */
    private String uuid;
    private String username;
    private String password;
    private String phone;
    private String email;
    private String logo;
    private String remark;
    private String accountType;
    private String status;
    /** JSONB 列，读回为 JSON 文本。 */
    private String ipWhitelist;
    private LocalDateTime lastLoginAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
    private Boolean mustChangePassword;
    private Boolean isSuperAdmin;

    /**
     * 是否内置超级管理员。
     *
     * @return 标识为真时为 true
     */
    public boolean superAdmin() {
        return Boolean.TRUE.equals(isSuperAdmin);
    }

    /**
     * 账号是否可登录。
     *
     * @return 状态为 normal 时为 true
     */
    public boolean normal() {
        return "normal".equals(status);
    }

    /**
     * 是否为自然人账号。
     *
     * @return accountType 为 person 时为 true
     */
    public boolean person() {
        return "person".equals(accountType);
    }
}
