package com.qs.authority.modules.permissiongroup;

import java.time.LocalDateTime;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组，对应表 {@code qs__auth__permission_group}。
 *
 * <p>{@code operationIds} 是操作稳定 id 的 JSON 数组；权限组既决定应用对谁可见，也决定用户
 * 能使用应用中的哪些操作。
 */
@Getter
@Setter
public class PermissionGroup {

    private Long id;
    private String name;
    private String description;
    /** JSONB 列，读回为 JSON 文本。 */
    private String operationIds;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
