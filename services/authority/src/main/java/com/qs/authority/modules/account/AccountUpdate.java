package com.qs.authority.modules.account;

import com.qs.authority.common.web.PatchValue;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 账号 PATCH 更新参数。
 *
 * <p>每个字段都是三态：未提交、显式清空、提交新值；SQL 只写入已提交的列，version 与
 * updated_at 由数据库触发器维护。accountType、isSuperAdmin 不在此列，分别由专用流程与初始化
 * 维护；password 只由改密与随机重置流程写入，普通编辑接口不会构造该字段。
 */
@Getter
@Setter
public class AccountUpdate {

    private long id;
    private long version;
    private Long updatedBy;
    private PatchValue<String> username;
    private PatchValue<String> password;
    private PatchValue<String> phone;
    private PatchValue<String> email;
    private PatchValue<String> logo;
    private PatchValue<String> remark;
    private PatchValue<String> ipWhitelist;
    private PatchValue<String> status;
    private PatchValue<Boolean> mustChangePassword;
    private PatchValue<LocalDateTime> lastLoginAt;
}
