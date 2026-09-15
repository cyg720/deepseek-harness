package com.qs.authority.modules.usergroup;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 用户组持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface UserGroupMapper {

    /**
     * 按主键查询。
     *
     * @param id 用户组标识
     * @return 用户组记录，不存在时为 null
     */
    UserGroup findById(@Param("id") long id);

    /**
     * 统计用户组编码占用。
     *
     * @param groupCode 用户组编码
     * @param excludeId 需要排除的用户组标识，可为 null
     * @return 占用数量
     */
    long countByGroupCode(@Param("groupCode") String groupCode, @Param("excludeId") Long excludeId);

    /**
     * 分页查询用户组。
     *
     * @param groupCode 用户组编码精确筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 用户组列表
     */
    List<UserGroup> list(@Param("groupCode") String groupCode, @Param("orderBy") String orderBy,
            @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的用户组总数。
     *
     * @param groupCode 用户组编码精确筛选，可为 null
     * @return 总数
     */
    long count(@Param("groupCode") String groupCode);

    /**
     * 新增用户组。
     *
     * @param group 用户组记录，成功回填 id
     * @return 影响行数
     */
    int insert(UserGroup group);

    /**
     * 按 version 条件更新用户组。
     *
     * @param update 更新参数
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(UserGroupUpdate update);

    /**
     * 按 version 条件物理删除用户组。
     *
     * @param id 用户组标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);

    /**
     * 统计用户组的成员数。
     *
     * @param id 用户组标识
     * @return 成员数
     */
    long countMembers(@Param("id") long id);
}
