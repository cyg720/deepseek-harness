package com.qs.authority.modules.parameter;

import com.qs.authority.common.web.PatchValue;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 授权中心参数持久层。
 *
 * <p>参数编码与参数值一律通过 {@code #{}} 绑定传给数据库，任何情况下都不拼接到 SQL 文本中；
 * 排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface ParameterMapper {

    /**
     * 按主键查询。
     *
     * @param id 参数标识
     * @return 参数记录，不存在时为 null
     */
    SysParameter findById(@Param("id") long id);

    /**
     * 按参数编码查询。
     *
     * @param paramCode 参数编码
     * @return 参数记录，不存在时为 null
     */
    SysParameter findByCode(@Param("paramCode") String paramCode);

    /**
     * 统计参数编码占用。
     *
     * @param paramCode 参数编码
     * @param excludeId 需要排除的参数标识，可为 null
     * @return 占用数量
     */
    long countByCode(@Param("paramCode") String paramCode, @Param("excludeId") Long excludeId);

    /**
     * 分页查询参数。
     *
     * @param paramCode 参数编码精确筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 参数列表
     */
    List<SysParameter> list(@Param("paramCode") String paramCode, @Param("orderBy") String orderBy,
            @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的参数总数。
     *
     * @param paramCode 参数编码精确筛选，可为 null
     * @return 总数
     */
    long count(@Param("paramCode") String paramCode);

    /**
     * 新增参数。
     *
     * @param parameter 参数记录，成功回填 id
     * @return 影响行数
     */
    int insert(SysParameter parameter);

    /**
     * 按 version 条件更新参数；version 与 updated_at 由数据库触发器维护。
     *
     * @param id 参数标识
     * @param version 读取时版本
     * @param paramCode 新参数编码，未提交时为未提交载体
     * @param paramValue 新参数值，未提交时为未提交载体
     * @param description 新描述，未提交时为未提交载体
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(@Param("id") long id, @Param("version") long version,
            @Param("paramCode") PatchValue<String> paramCode, @Param("paramValue") PatchValue<String> paramValue,
            @Param("description") PatchValue<String> description, @Param("updatedBy") Long updatedBy);

    /**
     * 按 version 条件物理删除参数。
     *
     * @param id 参数标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);
}
