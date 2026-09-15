package com.qs.authority.modules.dictionary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 字典接口的请求与响应模型。
 *
 * <p>标识与 version 以十进制字符串传输，时间为北京时间 {@code YYYY-MM-DD HH:mm:ss}；字典项在
 * 请求与响应中都是字符串数组，空数组表示清空字典项。
 */
public final class DictionaryDtos {

    private DictionaryDtos() {
    }

    /**
     * 新增字典请求。
     *
     * @param dictCode 字典编码，全局唯一
     * @param dictItems 字典项字符串数组；元素必须非空且不重复，允许空数组
     * @param description 字典描述，可为空
     */
    public record CreateRequest(
            @NotBlank(message = "请输入字典编码") @Size(max = 64, message = "长度不能超过 64 个字符") String dictCode,
            @NotNull(message = "请提交字典项数组") List<String> dictItems,
            @Size(max = 512, message = "长度不能超过 512 个字符") String description) {
    }

    /**
     * 字典响应字段。
     *
     * @param id 字典标识
     * @param dictCode 字典编码
     * @param dictItems 字典项字符串数组
     * @param description 字典描述
     * @param createdAt 创建时间
     * @param updatedAt 更新时间
     * @param createdBy 创建人
     * @param updatedBy 修改人
     * @param version 当前版本
     */
    public record Detail(String id, String dictCode, List<String> dictItems, String description, String createdAt,
            String updatedAt, String createdBy, String updatedBy, String version) {
    }
}
