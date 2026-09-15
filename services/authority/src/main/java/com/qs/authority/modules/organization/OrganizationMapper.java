package com.qs.authority.modules.organization;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 组织持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface OrganizationMapper {

    /**
     * 按主键查询。
     *
     * @param id 组织标识
     * @return 组织记录，不存在时为 null
     */
    Organization findById(@Param("id") long id);

    /**
     * 预取主键，供物化路径在插入时一次成型。
     *
     * @return 序列的下一个标识
     */
    Long nextId();

    /**
     * 分页查询组织。
     *
     * @param parentId 父组织标识筛选，可为 null
     * @param orgType 组织类型筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 组织列表
     */
    List<Organization> list(@Param("parentId") Long parentId, @Param("orgType") String orgType,
            @Param("orderBy") String orderBy, @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的组织总数。
     *
     * @param parentId 父组织标识筛选，可为 null
     * @param orgType 组织类型筛选，可为 null
     * @return 总数
     */
    long count(@Param("parentId") Long parentId, @Param("orgType") String orgType);

    /**
     * 新增组织；id 由服务层预取后显式写入。
     *
     * @param organization 组织记录
     * @return 影响行数
     */
    int insert(Organization organization);

    /**
     * 按 version 条件更新组织，移动时同时写入新的父标识与路径。
     *
     * @param update 更新参数
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(OrganizationUpdate update);

    /**
     * 查询子树中最长的物化路径长度（不含自身）。
     *
     * @param prefix 子树根路径，形如 {@code /1/23}
     * @return 最长路径字符数；没有后代时返回 0
     */
    int maxDescendantPathLength(@Param("prefix") String prefix);

    /**
     * 整体重写子树路径：保留原路径相对前缀，替换为新前缀。
     *
     * <p>只写 org_path，不触发版本递增，因此子节点的编辑版本不受移动影响。
     *
     * @param oldPrefix 移动前的父路径前缀，形如 {@code /1/23}
     * @param newPrefix 移动后的父路径前缀，形如 {@code /1/99/23}
     * @return 影响行数，即被重写的后代节点数
     */
    int moveSubtree(@Param("oldPrefix") String oldPrefix, @Param("newPrefix") String newPrefix);

    /**
     * 按 version 条件物理删除组织。
     *
     * @param id 组织标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);

    /**
     * 统计直接子组织数。
     *
     * @param id 组织标识
     * @return 子组织数
     */
    long countChildren(@Param("id") long id);

    /**
     * 统计组织的账号关联数。
     *
     * @param orgId 组织标识
     * @return 关联数
     */
    long countAccountLinks(@Param("orgId") long orgId);

    /**
     * 统计组织的权限组关联数。
     *
     * @param orgId 组织标识
     * @return 关联数
     */
    long countPermissionGroupLinks(@Param("orgId") long orgId);
}
