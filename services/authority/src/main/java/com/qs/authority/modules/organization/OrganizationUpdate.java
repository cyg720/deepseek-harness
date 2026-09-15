package com.qs.authority.modules.organization;

import com.qs.authority.common.web.PatchValue;
import lombok.Getter;
import lombok.Setter;

/**
 * 组织 PATCH 更新参数。
 *
 * <p>每个字段都是三态：未提交、显式清空、提交新值；SQL 只写入已提交的列，version 与
 * updated_at 由数据库触发器维护。{@code parentId} 与 {@code orgPath} 只在移动子树时同时提交，
 * 二者必须成对出现：{@code orgPath} 是新父路径加本节点标识。
 */
@Getter
@Setter
public class OrganizationUpdate {

    private long id;
    private long version;
    private Long updatedBy;
    private PatchValue<Long> parentId;
    private PatchValue<String> orgPath;
    private PatchValue<String> orgName;
    private PatchValue<String> orgType;
    private PatchValue<String> leader;
    private PatchValue<Integer> sortOrder;
    private PatchValue<String> remark;
}
