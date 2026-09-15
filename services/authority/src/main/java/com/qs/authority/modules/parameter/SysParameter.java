package com.qs.authority.modules.parameter;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 授权中心参数，对应表 {@code qs__auth__sys_param}。
 *
 * <p>参数只服务授权中心自身配置，值可为文字或数值，去空白后必须非空；消费方每次从数据库读取，
 * 因此保存成功后立即生效。实体只在服务与持久层之间传递。
 */
@Getter
@Setter
public class SysParameter {

    private Long id;
    private String paramCode;
    private String paramValue;
    private String description;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;
}
