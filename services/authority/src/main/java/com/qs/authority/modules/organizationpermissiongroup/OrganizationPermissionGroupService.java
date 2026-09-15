package com.qs.authority.modules.organizationpermissiongroup;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.organizationpermissiongroup.OrganizationPermissionGroupDtos.CreateRequest;
import com.qs.authority.modules.organizationpermissiongroup.OrganizationPermissionGroupDtos.Detail;
import com.qs.authority.modules.permissiongroup.PermissionGroupMapper;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 组织权限组关联服务：增改删查。
 *
 * <p>组织与权限组都必须已存在，同一组合不重复；编辑可以整体替换任一端的标识，替换后仍按
 * 新组合做唯一性检查；删除只解除该条组织与权限组的关联，不删除权限组或组织本身。
 */
@Service
public class OrganizationPermissionGroupService {

    /** 关联列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder",
            "permissionGroupId", "orgId");

    /** 关联 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "permissionGroupId", "orgId");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    /**
     * 关联列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    private final OrganizationPermissionGroupMapper organizationPermissionGroupMapper;
    private final PermissionGroupMapper permissionGroupMapper;

    /**
     * 构造关联服务。
     *
     * @param organizationPermissionGroupMapper 关联持久层，同时用于校验组织存在
     * @param permissionGroupMapper 权限组持久层，用于校验权限组存在
     */
    public OrganizationPermissionGroupService(OrganizationPermissionGroupMapper organizationPermissionGroupMapper,
            PermissionGroupMapper permissionGroupMapper) {
        this.organizationPermissionGroupMapper = organizationPermissionGroupMapper;
        this.permissionGroupMapper = permissionGroupMapper;
    }

    /**
     * 新增组织权限组关联。
     *
     * @param request 新增请求
     * @return 新增后的关联
     * @throws BusinessException 一端不存在返回 40001，组合已存在返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        long permissionGroupId = requirePermissionGroup(Ids.require(request.permissionGroupId(), "permissionGroupId"));
        long orgId = requireOrganization(Ids.require(request.orgId(), "orgId"));
        requireUniquePair(permissionGroupId, orgId, null);

        OrganizationPermissionGroup record = new OrganizationPermissionGroup();
        record.setPermissionGroupId(permissionGroupId);
        record.setOrgId(orgId);
        record.setCreatedBy(AuthContext.operatorId());
        organizationPermissionGroupMapper.insert(record);
        return toDetail(require(record.getId()));
    }

    /**
     * 关联详情。
     *
     * @param id 关联标识
     * @return 关联详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询关联。
     *
     * @param query 分页与排序参数
     * @param permissionGroupId 权限组标识筛选，可为 null
     * @param orgId 组织标识筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, Long permissionGroupId, Long orgId) {
        List<OrganizationPermissionGroup> rows = organizationPermissionGroupMapper.list(permissionGroupId, orgId,
                query.orderBy(), query.pageSize(), query.offset());
        long total = organizationPermissionGroupMapper.count(permissionGroupId, orgId);
        return new Paged<>(rows.stream().map(OrganizationPermissionGroupService::toDetail).toList(), query.page(),
                query.pageSize(), total);
    }

    /**
     * 编辑关联：整体替换提交的一端或两端标识。
     *
     * <p>提交的两端与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 关联标识
     * @param body PATCH 请求体
     * @return 编辑后的关联
     * @throws BusinessException 未知字段、没有有效变更返回 40001，目标不存在返回 40401，版本冲突返回 40901，组合重复返回 40902
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        OrganizationPermissionGroup current = require(id);

        PatchValue<Long> permissionGroupId = body.id("permissionGroupId", true);
        PatchValue<Long> orgId = body.id("orgId", true);
        long effectiveGroupId = permissionGroupId.isPresent() ? permissionGroupId.getValue()
                : current.getPermissionGroupId();
        long effectiveOrgId = orgId.isPresent() ? orgId.getValue() : current.getOrgId();
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(permissionGroupId, current.getPermissionGroupId())
                || isChanged(orgId, current.getOrgId()));
        requirePermissionGroup(effectiveGroupId);
        requireOrganization(effectiveOrgId);
        requireUniquePair(effectiveGroupId, effectiveOrgId, id);

        int rows = organizationPermissionGroupMapper.update(id, version, permissionGroupId, orgId);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return toDetail(require(id));
    }

    /**
     * 删除关联：只解除该条组织与权限组的关联，权限组与组织本身保持原样。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = organizationPermissionGroupMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取关联，不存在时返回 40401。
     *
     * @param id 关联标识
     * @return 关联记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public OrganizationPermissionGroup require(long id) {
        OrganizationPermissionGroup record = organizationPermissionGroupMapper.findById(id);
        if (record == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return record;
    }

    private long requirePermissionGroup(long id) {
        if (permissionGroupMapper.findById(id) == null) {
            throw BusinessException.invalidField("permissionGroupId", "权限组不存在");
        }
        return id;
    }

    private long requireOrganization(long id) {
        if (organizationPermissionGroupMapper.countOrganization(id) == 0) {
            throw BusinessException.invalidField("orgId", "组织不存在");
        }
        return id;
    }

    private void requireUniquePair(long permissionGroupId, long orgId, Long excludeId) {
        if (organizationPermissionGroupMapper.countByPair(permissionGroupId, orgId, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "该组织权限组关联已存在");
        }
    }

    /**
     * 提交的标识与当前值是否不同；未提交的一端不参与比较。
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
     * @param record 关联记录
     * @return 关联响应字段
     */
    public static Detail toDetail(OrganizationPermissionGroup record) {
        return new Detail(Ids.of(record.getId()), Ids.of(record.getPermissionGroupId()), Ids.of(record.getOrgId()),
                BeijingTime.format(record.getCreatedAt()), BeijingTime.format(record.getUpdatedAt()),
                Ids.of(record.getCreatedBy()), Ids.of(record.getVersion()));
    }
}
