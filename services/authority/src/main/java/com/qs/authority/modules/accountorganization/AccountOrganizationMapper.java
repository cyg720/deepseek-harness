package com.qs.authority.modules.accountorganization;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 账号与组织关联的持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface AccountOrganizationMapper {

    /**
     * 按主键查询。
     *
     * @param id 关联标识
     * @return 关联记录，不存在时为 null
     */
    AccountOrganization findById(@Param("id") long id);

    /**
     * 统计同一账号与组织的关联数。
     *
     * @param accountId 账号标识
     * @param orgId 组织标识
     * @param excludeId 需要排除的关联标识，可为 null
     * @return 占用数量
     */
    long countByPair(@Param("accountId") long accountId, @Param("orgId") long orgId,
            @Param("excludeId") Long excludeId);

    /**
     * 分页查询关联。
     *
     * @param accountId 账号标识筛选，可为 null
     * @param orgId 组织标识筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 关联列表
     */
    List<AccountOrganization> list(@Param("accountId") Long accountId, @Param("orgId") Long orgId,
            @Param("orderBy") String orderBy, @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的关联总数。
     *
     * @param accountId 账号标识筛选，可为 null
     * @param orgId 组织标识筛选，可为 null
     * @return 总数
     */
    long count(@Param("accountId") Long accountId, @Param("orgId") Long orgId);

    /**
     * 新增关联。
     *
     * @param link 关联记录，成功回填 id
     * @return 影响行数
     */
    int insert(AccountOrganization link);

    /**
     * 按 version 条件更新关联的两端标识。
     *
     * @param update 更新参数
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(AccountOrganizationUpdate update);

    /**
     * 按 version 条件物理删除关联。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);
}
