package com.qs.authority.modules.dictionary;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 授权中心字典，对应表 {@code qs__auth__sys_dict}。
 *
 * <p>字典项是 JSONB 字符串数组；读回为 JSON 文本，由服务层转换为字符串列表后才进入响应。
 * 实体只在服务与持久层之间传递。
 */
@Getter
@Setter
public class SysDictionary {

    private Long id;
    private String dictCode;
    /** JSONB 列，读回为 JSON 文本。 */
    private String dictItems;
    private String description;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
