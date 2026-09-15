package com.qs.authority.modules.operation;

import com.qs.authority.common.web.PatchValue;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 应用功能操作持久层。 */
@Mapper
public interface OperationMapper {

    /**
     * 按主键查询。
     *
     * @param id 操作标识
     * @return 操作记录，不存在时为 null
     */
    OperationRecord findById(@Param("id") long id);

    /**
     * 按完整操作码查询。
     *
     * @param operationCode 完整操作码
     * @return 操作记录，不存在时为 null
     */
    OperationRecord findByCode(@Param("operationCode") String operationCode);

    /**
     * 查询某应用的全部已登记操作，用于权限计算；不分页、不截断。
     *
     * @param appCode 应用编码
     * @return 该应用的全部操作，按标识升序
     */
    java.util.List<OperationRecord> listAllByAppCode(@Param("appCode") String appCode);

    /**
     * 分页查询操作。
     *
     * @param appCode 应用编码筛选，可为 null
     * @param operationCode 完整操作码筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 操作列表
     */
    List<OperationRecord> list(@Param("appCode") String appCode, @Param("operationCode") String operationCode,
            @Param("orderBy") String orderBy, @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的操作总数。
     *
     * @param appCode 应用编码筛选，可为 null
     * @param operationCode 完整操作码筛选，可为 null
     * @return 总数
     */
    long count(@Param("appCode") String appCode, @Param("operationCode") String operationCode);

    /**
     * 新增操作。
     *
     * @param operation 操作记录，成功回填 id
     * @return 影响行数
     */
    int insert(OperationRecord operation);

    /**
     * 按 version 条件更新操作。
     *
     * @param id 操作标识
     * @param version 读取时版本
     * @param operationCode 新完整操作码，未提交时为未提交载体
     * @param operationName 新操作名称，未提交时为未提交载体
     * @param operationDesc 新描述，未提交时为未提交载体
     * @param resourceType 新业务事件类型，未提交时为未提交载体
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(@Param("id") long id, @Param("version") long version,
            @Param("operationCode") PatchValue<String> operationCode,
            @Param("operationName") PatchValue<String> operationName,
            @Param("operationDesc") PatchValue<String> operationDesc,
            @Param("resourceType") PatchValue<String> resourceType,
            @Param("updatedBy") Long updatedBy);

    /**
     * 统计引用指定操作的权限组数量。
     *
     * @param operationId 操作标识
     * @return 引用数量
     */
    long countPermissionGroupReferences(@Param("operationId") long operationId);
}
