package com.qs.authority.modules.dictionary;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.support.Json;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.dictionary.DictionaryDtos.CreateRequest;
import com.qs.authority.modules.dictionary.DictionaryDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 字典服务：授权中心自身字典的增改删查。
 *
 * <p>字典项是字符串数组，元素必须非空文本且互不重复，空数组表示清空字典项；字典编码在单企业内
 * 唯一。字典项整组替换：任一元素不合法时整体拒绝，数据库原值保持不变。服务不缓存字典，保存
 * 成功后立即生效。
 *
 * <p>字典编码与字典项 JSON 文本全部经 MyBatis {@code #{}} 绑定，JSON 文本以参数形式交给
 * PostgreSQL 的 {@code CAST(... AS jsonb)}，不拼接进 SQL；排序字段只按 {@link #sortColumns()}
 * 白名单映射为固定列名，未列入白名单的取值返回 40001。
 */
@Service
public class DictionaryService {

    /** 字典列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "dictCode");

    /** 单个字典项的长度上限。 */
    public static final int DICT_ITEM_MAX_LENGTH = 64;

    /** 字典 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "dictCode", "dictItems", "description");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "dictCode", "dict_code",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final DictionaryMapper dictionaryMapper;

    /**
     * 构造字典服务。
     *
     * @param dictionaryMapper 字典持久层
     */
    public DictionaryService(DictionaryMapper dictionaryMapper) {
        this.dictionaryMapper = dictionaryMapper;
    }

    /**
     * 字典列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增字典。
     *
     * @param request 新增请求
     * @return 新增后的字典
     * @throws BusinessException 字典编码重复返回 40902，字段不合法返回 40001
     */
    @Transactional
    public Detail create(CreateRequest request) {
        String dictCode = request.dictCode().trim();
        requireUniqueCode(dictCode, null);
        List<String> items = requireItems(request.dictItems());

        SysDictionary dictionary = new SysDictionary();
        dictionary.setDictCode(dictCode);
        dictionary.setDictItems(PatchBody.StringArray.toJson(items));
        dictionary.setDescription(blankToNull(request.description()));
        dictionary.setCreatedBy(AuthContext.operatorId());
        dictionary.setUpdatedBy(AuthContext.operatorId());
        dictionaryMapper.insert(dictionary);
        return toDetail(dictionaryMapper.findById(dictionary.getId()));
    }

    /**
     * 字典详情。
     *
     * @param id 字典标识
     * @return 字典详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询字典。
     *
     * @param query 分页与排序参数
     * @param dictCode 字典编码精确筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String dictCode) {
        String filter = blankToNull(dictCode);
        List<SysDictionary> rows = dictionaryMapper.list(filter, query.orderBy(), query.pageSize(), query.offset());
        long total = dictionaryMapper.count(filter);
        return new Paged<>(rows.stream().map(DictionaryService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑字典。
     *
     * <p>提交的字段与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变；字典项按
     * 顺序比较，元素相同而顺序不同不算变更。
     *
     * @param id 字典标识
     * @param body PATCH 请求体
     * @return 编辑后的字典
     * @throws BusinessException 未知字段、字典项非法、空字典项或没有有效变更返回 40001，目标不存在返回 40401，
     *         版本冲突返回 40901，字典编码重复返回 40902
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        SysDictionary current = require(id);

        PatchValue<String> dictCode = body.text("dictCode", true, 64);
        if (dictCode.isPresent()) {
            dictCode = PatchValue.of(dictCode.getValue().trim());
            requireUniqueCode(dictCode.getValue(), id);
        }
        PatchValue<PatchBody.StringArray> items = body.stringArray("dictItems", false, true, DICT_ITEM_MAX_LENGTH);
        if (items.isPresent() && items.getValue() == null) {
            throw BusinessException.invalidField("dictItems", "该字段不能为空，清空字典项请提交空数组");
        }
        PatchValue<String> description = body.text("description", false, 512);

        boolean itemsChanged = items.isPresent() && EffectiveChanges.orderedDiffers(items.getValue().values(),
                Json.stringList(current.getDictItems()));
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(dictCode, current.getDictCode()) || itemsChanged
                || isChanged(description, current.getDescription()));

        PatchValue<String> dictItems = PatchValue.absent();
        if (items.isPresent()) {
            dictItems = PatchValue.of(items.getValue().json());
        }
        int rows = dictionaryMapper.update(id, version, dictCode, dictItems, description, AuthContext.operatorId());
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return detail(id);
    }

    /**
     * 物理删除字典；字典没有引用表，删除不需要引用校验。
     *
     * @param id 字典标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在或重复删除返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = dictionaryMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取字典，不存在时返回 40401。
     *
     * @param id 字典标识
     * @return 字典记录
     * @throws BusinessException 目标不存在返回 40401
     */
    private SysDictionary require(long id) {
        SysDictionary dictionary = dictionaryMapper.findById(id);
        if (dictionary == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return dictionary;
    }

    private void requireUniqueCode(String dictCode, Long excludeId) {
        if (dictionaryMapper.countByCode(dictCode, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "字典编码已存在");
        }
    }

    private static List<String> requireItems(List<String> values) {
        Set<String> distinct = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null || value.isBlank()) {
                throw BusinessException.invalidField("dictItems", "数组元素必须是非空文本");
            }
            if (value.length() > DICT_ITEM_MAX_LENGTH) {
                throw BusinessException.invalidField("dictItems",
                        "数组元素长度不能超过 " + DICT_ITEM_MAX_LENGTH + " 个字符");
            }
            if (!distinct.add(value)) {
                throw BusinessException.invalidField("dictItems", "数组元素不能重复");
            }
        }
        return List.copyOf(values);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 提交的标量字段与当前值是否不同；未提交的字段不参与比较。
     *
     * <p>三态语义下显式 null 与当前非 null 属于变更。
     *
     * @param submitted 提交的三态字段
     * @param current 当前值
     * @return 字段已提交且与当前值不同时为 true
     */
    private static boolean isChanged(PatchValue<?> submitted, Object current) {
        return submitted.isPresent() && EffectiveChanges.differs(submitted.getValue(), current);
    }

    /**
     * 转换为响应模型；JSONB 列文本在此展开为字符串数组。
     *
     * @param dictionary 字典记录
     * @return 字典响应字段
     */
    public static Detail toDetail(SysDictionary dictionary) {
        return new Detail(Ids.of(dictionary.getId()), dictionary.getDictCode(),
                Json.stringList(dictionary.getDictItems()), dictionary.getDescription(),
                BeijingTime.format(dictionary.getCreatedAt()), BeijingTime.format(dictionary.getUpdatedAt()),
                Ids.of(dictionary.getCreatedBy()), Ids.of(dictionary.getUpdatedBy()), Ids.of(dictionary.getVersion()));
    }
}
