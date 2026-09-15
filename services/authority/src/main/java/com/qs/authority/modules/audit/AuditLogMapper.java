package com.qs.authority.modules.audit;

import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 审计日志持久层：只追加、按复合主键查询、按保留期物理删除。 */
@Mapper
public interface AuditLogMapper {

    /**
     * 追加一条审计事件。
     *
     * @param log 日志记录，成功回填 id
     * @return 影响行数
     */
    int insert(AuditLog log);

    /**
     * 分页查询日志。
     *
     * @param accountId 账号筛选，可为 null
     * @param appCode 应用筛选，可为 null
     * @param result 结果筛选，可为 null
     * @param createdAtFrom 起始时间，可为 null
     * @param createdAtTo 结束时间，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 日志列表
     */
    List<AuditLog> list(@Param("accountId") Long accountId, @Param("appCode") String appCode,
            @Param("result") String result, @Param("createdAtFrom") LocalDateTime createdAtFrom,
            @Param("createdAtTo") LocalDateTime createdAtTo, @Param("orderBy") String orderBy,
            @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的日志总数。
     *
     * @param accountId 账号筛选，可为 null
     * @param appCode 应用筛选，可为 null
     * @param result 结果筛选，可为 null
     * @param createdAtFrom 起始时间，可为 null
     * @param createdAtTo 结束时间，可为 null
     * @return 总数
     */
    long count(@Param("accountId") Long accountId, @Param("appCode") String appCode,
            @Param("result") String result, @Param("createdAtFrom") LocalDateTime createdAtFrom,
            @Param("createdAtTo") LocalDateTime createdAtTo);

    /**
     * 按复合主键查询日志。
     *
     * @param id 日志标识
     * @param createdAt 创建时间，分区键
     * @return 日志记录，不存在时为 null
     */
    AuditLog findById(@Param("id") long id, @Param("createdAt") LocalDateTime createdAt);

    /**
     * 物理删除超过保留期的日志。
     *
     * @param cutoff 截点；创建时间严格早于该时刻的日志被删除，恰好等于时保留
     * @return 删除行数
     */
    int deleteOlderThan(@Param("cutoff") LocalDateTime cutoff);
}
