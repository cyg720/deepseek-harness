package com.qs.authority.modules.appauthorization;

import com.qs.authority.common.web.PatchValue;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 应用授权与可见权限组关联的持久层。 */
@Mapper
public interface AppAuthorizationMapper {

    /**
     * 按主键查询。
     *
     * @param id 授权记录标识
     * @return 授权记录，不存在时为 null
     */
    AppAuthorization findById(@Param("id") long id);

    /**
     * 按应用编码查询。
     *
     * @param appCode 应用编码
     * @return 授权记录，不存在时为 null
     */
    AppAuthorization findByAppCode(@Param("appCode") String appCode);

    /**
     * 按 AppKey 查询。
     *
     * @param appKey 应用密钥
     * @return 授权记录，不存在时为 null
     */
    AppAuthorization findByAppKey(@Param("appKey") String appKey);

    /**
     * 分页查询授权记录。
     *
     * @param appCode 应用编码筛选，可为 null
     * @param status 状态筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 授权记录列表
     */
    List<AppAuthorization> list(@Param("appCode") String appCode, @Param("status") String status,
            @Param("orderBy") String orderBy, @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的授权记录总数。
     *
     * @param appCode 应用编码筛选，可为 null
     * @param status 状态筛选，可为 null
     * @return 总数
     */
    long count(@Param("appCode") String appCode, @Param("status") String status);

    /**
     * 新增授权记录。
     *
     * @param authorization 授权记录，成功回填 id
     * @return 影响行数
     */
    int insert(AppAuthorization authorization);

    /**
     * 按 version 条件更新应用状态，仅应用中心受控同步使用。
     *
     * @param id 授权记录标识
     * @param version 读取时版本
     * @param status 目标状态
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int updateStatus(@Param("id") long id, @Param("version") long version, @Param("status") String status,
            @Param("updatedBy") Long updatedBy);

    /**
     * 按 version 条件记录一次配置编辑，使可见权限组变更推进授权记录版本。
     *
     * @param id 授权记录标识
     * @param version 读取时版本
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int touch(@Param("id") long id, @Param("version") long version, @Param("updatedBy") Long updatedBy);

    /**
     * 查询应用当前关联的可见权限组标识。
     *
     * @param appAuthorizationId 授权记录标识
     * @return 权限组标识列表
     */
    List<Long> listPermissionGroupIds(@Param("appAuthorizationId") long appAuthorizationId);

    /**
     * 覆盖应用可见权限组集合：先清空再写入。
     *
     * @param appAuthorizationId 授权记录标识
     * @param groupIds 权限组标识
     * @param operatorId 操作账号标识，可为 null
     * @return 影响行数
     */
    int replacePermissionGroups(@Param("appAuthorizationId") long appAuthorizationId,
            @Param("groupIds") List<Long> groupIds, @Param("operatorId") Long operatorId);

    /**
     * 删除应用的全部可见权限组关联。
     *
     * @param appAuthorizationId 授权记录标识
     * @return 影响行数
     */
    int deletePermissionGroups(@Param("appAuthorizationId") long appAuthorizationId);

    /**
     * 统计权限组被应用引用的次数。
     *
     * @param permissionGroupId 权限组标识
     * @return 引用数
     */
    long countByPermissionGroupId(@Param("permissionGroupId") long permissionGroupId);

    /**
     * 判断应用是否通过给定权限组对用户可见。
     *
     * @param appAuthorizationId 授权记录标识
     * @param groupIds 用户取得的权限组标识；为空时直接不可见
     * @return 命中数量，大于 0 表示可见
     */
    long countVisibility(@Param("appAuthorizationId") long appAuthorizationId, @Param("groupIds") List<Long> groupIds);

    /**
     * 查询应用当前同步状态与版本，用于应用中心冲突判断。
     *
     * @param appCode 应用编码
     * @return 授权记录，不存在时为 null
     */
    AppAuthorization findStatusByAppCode(@Param("appCode") String appCode);

    /**
     * 更新应用密钥与过期时间，用于初始化内置应用。
     *
     * @param id 授权记录标识
     * @param appKey 应用密钥
     * @param appSecret 应用密钥散列
     * @return 影响行数
     */
    int updateCredentials(@Param("id") long id, @Param("appKey") String appKey, @Param("appSecret") String appSecret);

    /**
     * 统计应用已登记的操作数。
     *
     * @param appCode 应用编码
     * @return 操作数
     */
    long countOperations(@Param("appCode") String appCode);
}
