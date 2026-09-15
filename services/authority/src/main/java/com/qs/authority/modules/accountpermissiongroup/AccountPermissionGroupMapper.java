package com.qs.authority.modules.accountpermissiongroup;

import com.qs.authority.common.web.PatchValue;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 用户权限组关联持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 * 表结构没有 updated_by 列，更新只写关联两端与 version 条件。
 */
@Mapper
public interface AccountPermissionGroupMapper {

    /**
     * 按主键查询。
     *
     * @param id 关联标识
     * @return 关联记录，不存在时为 null
     */
    AccountPermissionGroup findById(@Param("id") long id);

    /**
     * 分页查询关联。
     *
     * @param permissionGroupId 权限组标识筛选，可为 null
     * @param accountId 账号标识筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 关联列表
     */
    List<AccountPermissionGroup> list(@Param("permissionGroupId") Long permissionGroupId,
            @Param("accountId") Long accountId, @Param("orderBy") String orderBy, @Param("limit") int limit,
            @Param("offset") long offset);

    /**
     * 统计符合条件的关联总数。
     *
     * @param permissionGroupId 权限组标识筛选，可为 null
     * @param accountId 账号标识筛选，可为 null
     * @return 总数
     */
    long count(@Param("permissionGroupId") Long permissionGroupId, @Param("accountId") Long accountId);

    /**
     * 统计同一组合的关联数量，用于唯一性检查。
     *
     * @param permissionGroupId 权限组标识
     * @param accountId 账号标识
     * @param excludeId 需要排除的关联标识，可为 null
     * @return 占用数量
     */
    long countByPair(@Param("permissionGroupId") long permissionGroupId, @Param("accountId") long accountId,
            @Param("excludeId") Long excludeId);

    /**
     * 新增关联。
     *
     * @param record 关联记录，成功回填 id
     * @return 影响行数
     */
    int insert(AccountPermissionGroup record);

    /**
     * 按 version 条件更新关联两端。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @param permissionGroupId 新权限组标识，未提交时为未提交载体
     * @param accountId 新账号标识，未提交时为未提交载体
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(@Param("id") long id, @Param("version") long version,
            @Param("permissionGroupId") PatchValue<Long> permissionGroupId,
            @Param("accountId") PatchValue<Long> accountId);

    /**
     * 按 version 条件物理删除关联。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);
}
