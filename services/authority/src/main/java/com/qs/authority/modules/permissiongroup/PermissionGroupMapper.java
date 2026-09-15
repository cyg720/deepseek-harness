package com.qs.authority.modules.permissiongroup;

import com.qs.authority.common.web.PatchValue;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 权限组持久层，同时提供鉴权引擎需要的取得组与可见性查询。 */
@Mapper
public interface PermissionGroupMapper {

    /**
     * 按主键查询。
     *
     * @param id 权限组标识
     * @return 权限组，不存在时为 null
     */
    PermissionGroup findById(@Param("id") long id);

    /**
     * 分页查询权限组。
     *
     * @param name 名称筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 权限组列表
     */
    List<PermissionGroup> list(@Param("name") String name, @Param("orderBy") String orderBy,
            @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的权限组总数。
     *
     * @param name 名称筛选，可为 null
     * @return 总数
     */
    long count(@Param("name") String name);

    /**
     * 按标识批量查询。
     *
     * @param ids 标识列表；为空时返回空列表
     * @return 权限组列表
     */
    List<PermissionGroup> listByIds(@Param("ids") List<Long> ids);

    /**
     * 新增权限组。
     *
     * @param group 权限组，成功回填 id
     * @return 影响行数
     */
    int insert(PermissionGroup group);

    /**
     * 按 version 条件更新权限组。
     *
     * @param id 权限组标识
     * @param version 读取时版本
     * @param name 名称，未提交时为未提交载体
     * @param description 描述，未提交时为未提交载体
     * @param operationIds 操作集合 JSON 文本，未提交时为未提交载体
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(@Param("id") long id, @Param("version") long version, @Param("name") PatchValue<String> name,
            @Param("description") PatchValue<String> description,
            @Param("operationIds") PatchValue<String> operationIds, @Param("updatedBy") Long updatedBy);

    /**
     * 按 version 条件物理删除权限组。
     *
     * @param id 权限组标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);

    /**
     * 查询账号实际取得的权限组标识：直接关联，或通过其所属组织关联。
     *
     * @param accountId 账号标识
     * @return 权限组标识列表
     */
    List<Long> listObtainedGroupIds(@Param("accountId") long accountId);

    /**
     * 展开若干权限组内操作标识的并集。
     *
     * @param groupIds 权限组标识；为空时返回空列表
     * @return 操作标识列表
     */
    List<Long> listOperationIds(@Param("groupIds") List<Long> groupIds);

    /**
     * 统计权限组被应用、账号、组织引用的总数。
     *
     * @param id 权限组标识
     * @return 引用数量
     */
    long countReferences(@Param("id") long id);

    /**
     * 统计权限组被应用可见范围引用的次数。
     *
     * @param id 权限组标识
     * @return 引用数量
     */
    long countAppReferences(@Param("id") long id);

    /**
     * 统计权限组被账号关联引用的次数。
     *
     * @param id 权限组标识
     * @return 引用数量
     */
    long countAccountReferences(@Param("id") long id);

    /**
     * 统计权限组被组织关联引用的次数。
     *
     * @param id 权限组标识
     * @return 引用数量
     */
    long countOrganizationReferences(@Param("id") long id);
}
