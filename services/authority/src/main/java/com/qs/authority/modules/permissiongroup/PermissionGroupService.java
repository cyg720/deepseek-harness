package com.qs.authority.modules.permissiongroup;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.error.ErrorData.ReferenceItem;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.support.Json;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.operation.OperationMapper;
import com.qs.authority.modules.permissiongroup.PermissionGroupDtos.CreateRequest;
import com.qs.authority.modules.permissiongroup.PermissionGroupDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 权限组服务：增改删查。
 *
 * <p>{@code operationIds} 保存操作稳定标识，提交数组时整体替换，每个元素必须已登记于
 * {@code qs__auth__operation}；删除权限组不连带删除任何关联，被应用可见范围、用户或组织关联
 * 引用时返回 40903。
 */
@Service
public class PermissionGroupService {

    /** 权限组列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "name");

    /** 权限组 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "name", "description", "operationIds");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "name", "name",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    /**
     * 权限组列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    private final PermissionGroupMapper permissionGroupMapper;
    private final OperationMapper operationMapper;

    /**
     * 构造权限组服务。
     *
     * @param permissionGroupMapper 权限组持久层
     * @param operationMapper 操作持久层，用于校验操作标识存在
     */
    public PermissionGroupService(PermissionGroupMapper permissionGroupMapper, OperationMapper operationMapper) {
        this.permissionGroupMapper = permissionGroupMapper;
        this.operationMapper = operationMapper;
    }

    /**
     * 新增权限组。
     *
     * @param request 新增请求
     * @return 新增后的权限组
     * @throws BusinessException 操作标识非法或不存在时抛出 40001
     */
    @Transactional
    public Detail create(CreateRequest request) {
        PermissionGroup group = new PermissionGroup();
        group.setName(request.name().trim());
        group.setDescription(blankToNull(request.description()));
        group.setOperationIds(PatchBody.IdArray.toJson(validateOperationIds(request.operationIds())));
        group.setCreatedBy(AuthContext.operatorId());
        group.setUpdatedBy(AuthContext.operatorId());
        permissionGroupMapper.insert(group);
        return toDetail(require(group.getId()));
    }

    /**
     * 权限组详情。
     *
     * @param id 权限组标识
     * @return 权限组详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询权限组。
     *
     * @param query 分页与排序参数
     * @param name 名称精确筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String name) {
        String normalizedName = blankToNull(name);
        List<PermissionGroup> rows = permissionGroupMapper.list(normalizedName, query.orderBy(), query.pageSize(),
                query.offset());
        long total = permissionGroupMapper.count(normalizedName);
        return new Paged<>(rows.stream().map(PermissionGroupService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑权限组。
     *
     * <p>提交的字段与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变；操作标识按
     * 元素集合比较，元素相同而顺序不同不算变更。
     *
     * @param id 权限组标识
     * @param body PATCH 请求体
     * @return 编辑后的权限组
     * @throws BusinessException 未知字段、操作标识非法或没有有效变更返回 40001，目标不存在返回 40401，
     *     版本冲突返回 40901
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        PermissionGroup current = require(id);

        PatchValue<String> name = body.text("name", true, 128);
        if (name.isPresent()) {
            name = PatchValue.of(name.getValue().trim());
        }
        PatchValue<String> description = body.text("description", false, 512);
        PatchValue<PatchBody.IdArray> operationIds = toOperationIdsPatch(body);

        boolean operationsChanged = operationIds.isPresent()
                && EffectiveChanges.idSetDiffers(operationIds.getValue().ids(),
                        Json.longList(current.getOperationIds()));
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(name, current.getName())
                || isChanged(description, current.getDescription()) || operationsChanged);

        int rows = permissionGroupMapper.update(id, version, name, description, toJsonPatch(operationIds),
                AuthContext.operatorId());
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return toDetail(require(id));
    }

    /**
     * 物理删除权限组；被应用可见范围、用户或组织关联引用时不删除任何数据并返回 40903。
     *
     * @param id 权限组标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901，有引用返回 40903
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        List<ReferenceItem> references = describeReferences(id);
        if (!references.isEmpty()) {
            throw BusinessException.referenced(references);
        }
        int rows = permissionGroupMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取权限组，不存在时返回 40401。
     *
     * @param id 权限组标识
     * @return 权限组记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public PermissionGroup require(long id) {
        PermissionGroup group = permissionGroupMapper.findById(id);
        if (group == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return group;
    }

    /**
     * 解析提交的操作标识并校验其存在性。
     *
     * @param body PATCH 请求体
     * @return 三态结果；已提交时值包含解析后的标识
     * @throws BusinessException 提交值非法或操作不存在时返回 40001
     */
    private PatchValue<PatchBody.IdArray> toOperationIdsPatch(PatchBody body) {
        PatchValue<PatchBody.IdArray> patch = body.idArray("operationIds", false, true);
        if (!patch.isPresent()) {
            return PatchValue.absent();
        }
        if (patch.getValue() == null) {
            // operation_ids 是 NOT NULL 的集合列，显式 null 按平台公约对必填字段处理。
            throw BusinessException.invalidField("operationIds", "该字段不能为空");
        }
        List<Long> ids = patch.getValue().ids();
        requireOperationsExist(ids);
        return PatchValue.of(new PatchBody.IdArray(ids, PatchBody.IdArray.toJson(ids)));
    }

    /**
     * 取出已提交操作标识的 JSONB 文本。
     *
     * @param operationIds 三态操作标识
     * @return 三态 JSONB 文本；未提交时为未提交载体
     */
    private static PatchValue<String> toJsonPatch(PatchValue<PatchBody.IdArray> operationIds) {
        return operationIds.isPresent() ? PatchValue.of(operationIds.getValue().json()) : PatchValue.absent();
    }

    private List<Long> validateOperationIds(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        Set<Long> ids = new LinkedHashSet<>();
        for (String element : raw) {
            if (element == null || element.isBlank()) {
                throw BusinessException.invalidField("operationIds", "数组元素必须是正整数标识");
            }
            long id = Ids.require(element, "operationIds");
            if (id <= 0) {
                throw BusinessException.invalidField("operationIds", "数组元素必须是正整数标识");
            }
            if (!ids.add(id)) {
                throw BusinessException.invalidField("operationIds", "数组元素不能重复");
            }
        }
        List<Long> distinct = List.copyOf(ids);
        requireOperationsExist(distinct);
        return distinct;
    }

    private void requireOperationsExist(List<Long> ids) {
        for (Long id : ids) {
            if (operationMapper.findById(id) == null) {
                throw BusinessException.invalidField("operationIds", "操作不存在");
            }
        }
    }

    private List<ReferenceItem> describeReferences(long id) {
        List<ReferenceItem> references = new ArrayList<>();
        long apps = permissionGroupMapper.countAppReferences(id);
        if (apps > 0) {
            references.add(new ReferenceItem("appPermissionGroup", null, "存在 " + apps + " 条应用可见范围关联"));
        }
        long accounts = permissionGroupMapper.countAccountReferences(id);
        if (accounts > 0) {
            references.add(new ReferenceItem("permissionGroupAccount", null, "存在 " + accounts + " 条用户权限组关联"));
        }
        long organizations = permissionGroupMapper.countOrganizationReferences(id);
        if (organizations > 0) {
            references.add(new ReferenceItem("permissionGroupOrg", null, "存在 " + organizations + " 条组织权限组关联"));
        }
        return references;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /**
     * 提交的字段与当前值是否不同；未提交的字段不参与比较。
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
     * 转换为响应模型。
     *
     * @param group 权限组记录
     * @return 权限组响应字段
     */
    public static Detail toDetail(PermissionGroup group) {
        return new Detail(Ids.of(group.getId()), group.getName(), group.getDescription(),
                Json.longList(group.getOperationIds()).stream().map(Ids::of).toList(),
                BeijingTime.format(group.getCreatedAt()), BeijingTime.format(group.getUpdatedAt()),
                Ids.of(group.getCreatedBy()), Ids.of(group.getUpdatedBy()), Ids.of(group.getVersion()));
    }
}
