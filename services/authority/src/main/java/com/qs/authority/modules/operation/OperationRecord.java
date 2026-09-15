package com.qs.authority.modules.operation;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 应用功能操作，对应表 {@code qs__auth__operation}。
 *
 * <p>完整操作码全平台唯一，必须以所属应用编码加点号开头；改名保留稳定 id，已有授权关系不变。
 */
@Getter
@Setter
public class OperationRecord {

    private Long id;
    private String appCode;
    private String operationCode;
    private String operationName;
    private String operationDesc;
    private String resourceType;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
