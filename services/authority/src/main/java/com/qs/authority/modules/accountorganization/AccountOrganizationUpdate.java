package com.qs.authority.modules.accountorganization;

import lombok.Getter;
import lombok.Setter;

/**
 * 账号与组织关联的 PATCH 更新参数。
 *
 * <p>两端的标识列都是 NOT NULL 且不可清空，因此这里保存服务层解析后的完整组合值：编辑请求即便只
 * 提交一端，也把另一端按现有值补齐后整体写入，保证替换目标完整成功。version 与 updated_at 由数据
 * 库触发器维护。
 */
@Getter
@Setter
public class AccountOrganizationUpdate {

    private long id;
    private long version;
    private long accountId;
    private long orgId;
    private Long updatedBy;
}
