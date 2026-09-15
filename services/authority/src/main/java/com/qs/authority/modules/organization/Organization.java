package com.qs.authority.modules.organization;

import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 组织记录，对应表 {@code qs__auth__organization}。
 *
 * <p>组织树由 {@code parentId} 与物化路径 {@code orgPath} 共同描述：根组织的 {@code parentId} 为 0，
 * 路径形如 {@code /1/23/456}。父子关系不自动授予权限，账号或组织取得权限组仍只按各自的关联记录计算。
 */
@Getter
@Setter
public class Organization {

    private Long id;
    /** 父组织标识，0 表示根组织。 */
    private Long parentId;
    /** 物化路径，根组织为 {@code /id}，子组织为父路径加 {@code /id}。 */
    private String orgPath;
    private String orgName;
    /** company:单位, plant:厂区, department:部门, post:岗位, team:班组。 */
    private String orgType;
    private String leader;
    private Integer sortOrder;
    private String remark;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long createdBy;
    private Long updatedBy;
    private Long version;

    /**
     * 是否根组织。
     *
     * @return parentId 为 0 时为 true
     */
    public boolean root() {
        return parentId == null || parentId == 0L;
    }
}
