package com.qs.authority.modules.usergroup;

import com.qs.authority.common.web.PatchValue;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户组 PATCH 更新参数。
 *
 * <p>每个字段都是三态：未提交、显式清空、提交新值；SQL 只写入已提交的列，version 与
 * updated_at 由数据库触发器维护。groupCode 与 groupName 为必填列，不接受清空。
 */
@Getter
@Setter
public class UserGroupUpdate {

    private long id;
    private long version;
    private Long updatedBy;
    private PatchValue<String> groupCode;
    private PatchValue<String> groupName;
    private PatchValue<String> description;
}
