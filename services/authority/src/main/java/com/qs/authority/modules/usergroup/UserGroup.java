package com.qs.authority.modules.usergroup;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户组记录，对应表 {@code qs__auth__user_group}。
 *
 * <p>用户组只维护跨部门人员集合，不授予权限：组成员身份不会带来任何权限组或操作权限。
 */
@Getter
@Setter
public class UserGroup {

    private Long id;
    /** 用户组编码，全局唯一。 */
    private String groupCode;
    private String groupName;
    private String description;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
