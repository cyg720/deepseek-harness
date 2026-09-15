package com.qs.authority.modules.dictionary;

import com.qs.authority.common.web.PatchValue;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 授权中心字典持久层。
 *
 * <p>字典编码与字典项 JSON 文本一律通过 {@code #{}} 绑定传给数据库；JSONB 列写入使用
 * {@code CAST(#{...} AS jsonb)}，读回使用 {@code ::text}；排序片段由服务层按白名单拼装后传入。
 */
@Mapper
public interface DictionaryMapper {

    /**
     * 按主键查询。
     *
     * @param id 字典标识
     * @return 字典记录，不存在时为 null
     */
    SysDictionary findById(@Param("id") long id);

    /**
     * 统计字典编码占用。
     *
     * @param dictCode 字典编码
     * @param excludeId 需要排除的字典标识，可为 null
     * @return 占用数量
     */
    long countByCode(@Param("dictCode") String dictCode, @Param("excludeId") Long excludeId);

    /**
     * 分页查询字典。
     *
     * @param dictCode 字典编码精确筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 字典列表
     */
    List<SysDictionary> list(@Param("dictCode") String dictCode, @Param("orderBy") String orderBy,
            @Param("limit") int limit, @Param("offset") long offset);

    /**
     * 统计符合条件的字典总数。
     *
     * @param dictCode 字典编码精确筛选，可为 null
     * @return 总数
     */
    long count(@Param("dictCode") String dictCode);

    /**
     * 新增字典。
     *
     * @param dictionary 字典记录，成功回填 id
     * @return 影响行数
     */
    int insert(SysDictionary dictionary);

    /**
     * 按 version 条件更新字典；version 与 updated_at 由数据库触发器维护。
     *
     * @param id 字典标识
     * @param version 读取时版本
     * @param dictCode 新字典编码，未提交时为未提交载体
     * @param dictItems 新字典项 JSON 数组文本，未提交时为未提交载体
     * @param description 新描述，未提交时为未提交载体
     * @param updatedBy 操作账号标识，可为 null
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(@Param("id") long id, @Param("version") long version,
            @Param("dictCode") PatchValue<String> dictCode, @Param("dictItems") PatchValue<String> dictItems,
            @Param("description") PatchValue<String> description, @Param("updatedBy") Long updatedBy);

    /**
     * 按 version 条件物理删除字典。
     *
     * @param id 字典标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);
}
