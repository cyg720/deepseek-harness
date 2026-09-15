package com.qs.authority.modules.usergroupmembership;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 用户组成员的持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface UserGroupMembershipMapper {

    /**
     * 按主键查询。
     *
     * @param id 成员关系标识
     * @return 成员记录，不存在时为 null
     */
    UserGroupMembership findById(@Param("id") long id);

    /**
     * 统计同一用户组与账号的成员关系数。
     *
     * @param userGroupId 用户组标识
     * @param accountId 账号标识
     * @param excludeId 需要排除的成员关系标识，可为 null
     * @return 占用数量
     */
    long countByPair(@Param("userGroupId") long userGroupId, @Param("accountId") long accountId,
            @Param("excludeId") Long excludeId);

    /**
     * 分页查询成员。
     *
     * @param userGroupId 用户组标识筛选，可为 null
     * @param accountId 账号标识筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 成员列表
     */
    List<UserGroupMembership> list(@Param("userGroupId") Long userGroupId, @Param("accountId") Long accountId,
            @Param("orderBy") String orderBy, @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的成员总数。
     *
     * @param userGroupId 用户组标识筛选，可为 null
     * @param accountId 账号标识筛选，可为 null
     * @return 总数
     */
    long count(@Param("userGroupId") Long userGroupId, @Param("accountId") Long accountId);

    /**
     * 新增成员。
     *
     * @param membership 成员记录，成功回填 id
     * @return 影响行数
     */
    int insert(UserGroupMembership membership);

    /**
     * 按 version 条件更新成员关系的两端标识。
     *
     * @param update 更新参数
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(UserGroupMembershipUpdate update);

    /**
     * 按 version 条件物理删除成员关系。
     *
     * @param id 成员关系标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);
}
