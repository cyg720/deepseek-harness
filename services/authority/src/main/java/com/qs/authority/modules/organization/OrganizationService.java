package com.qs.authority.modules.organization;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.error.ErrorData.ReferenceItem;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.organization.OrganizationDtos.CreateRequest;
import com.qs.authority.modules.organization.OrganizationDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 组织服务：组织树增改删查与子树移动。
 *
 * <p>插入前预取主键，因此物化路径在插入时一次成型；移动组织时本节点与全部后代的路径在同一事务内
 * 整体改写，后代节点的编辑版本不变。组织树的父子关系不自动授予权限：账号或组织取得权限组只按
 * 各自的关联记录计算，不继承父组织的权限组。
 */
@Service
public class OrganizationService {

    /** 组织列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "parentId",
            "orgType");

    /** 组织 PATCH 允许写入的字段；orgPath 由服务按父路径维护，不接受提交。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "parentId", "orgName", "orgType", "leader",
            "sortOrder", "remark");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "orgName", "org_name",
            "sortOrder", "sort_order",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private static final Set<String> ORG_TYPES = Set.of("company", "plant", "department", "post", "team");

    /** {@code org_path} 列长度，与建表声明一致。 */
    private static final int MAX_ORG_PATH_LENGTH = 512;

    private final OrganizationMapper organizationMapper;

    /**
     * 构造组织服务。
     *
     * @param organizationMapper 组织持久层
     */
    public OrganizationService(OrganizationMapper organizationMapper) {
        this.organizationMapper = organizationMapper;
    }

    /**
     * 组织列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增组织。
     *
     * @param request 新增请求
     * @return 新增后的组织
     * @throws BusinessException 父组织不存在或字段不合法返回 40001
     */
    @Transactional
    public Detail create(CreateRequest request) {
        long parentId = parseParentId(request.parentId());
        String orgName = request.orgName().trim();
        String orgType = normalizeOrgType(request.orgType());
        String parentPath = parentPath(parentId);

        long id = organizationMapper.nextId();
        String orgPath = parentPath + "/" + id;
        requirePathLength(orgPath);
        Organization organization = new Organization();
        organization.setId(id);
        organization.setParentId(parentId);
        organization.setOrgPath(orgPath);
        organization.setOrgName(orgName);
        organization.setOrgType(orgType);
        organization.setLeader(blankToNull(request.leader()));
        organization.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        organization.setRemark(blankToNull(request.remark()));
        organization.setCreatedBy(AuthContext.operatorId());
        organization.setUpdatedBy(AuthContext.operatorId());
        organizationMapper.insert(organization);
        return toDetail(require(id));
    }

    /**
     * 组织详情。
     *
     * @param id 组织标识
     * @return 组织详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询组织。
     *
     * @param query 分页与排序参数
     * @param parentId 父组织标识筛选，可为 null
     * @param orgType 组织类型筛选，可为 null
     * @return 分页结果
     * @throws BusinessException 筛选值不合法返回 40001
     */
    public Paged<Detail> list(PageQuery query, String parentId, String orgType) {
        Long normalizedParentId = Ids.parse(parentId, "parentId");
        String normalizedType = QueryParams.enumValue("orgType", orgType, ORG_TYPES);
        List<Organization> rows = organizationMapper.list(normalizedParentId, normalizedType, query.orderBy(),
                query.pageSize(), query.offset());
        long total = organizationMapper.count(normalizedParentId, normalizedType);
        return new Paged<>(rows.stream().map(OrganizationService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑组织；提交 parentId 表示把该组织及其后代移动到新的父组织。
     *
     * <p>提交的字段与当前值完全相同（含提交与当前相同的父组织）视为没有有效变更，返回 40001 且不落库，
     * 版本保持不变。
     *
     * @param id 组织标识
     * @param body PATCH 请求体
     * @return 编辑后的组织
     * @throws BusinessException 未知字段、父组织不存在、移动到自身或自己的后代、没有有效变更返回 40001；
     *     版本冲突返回 40901
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        Organization current = require(id);

        OrganizationUpdate update = new OrganizationUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUpdatedBy(AuthContext.operatorId());
        update.setOrgName(body.text("orgName", true, 128));
        update.setOrgType(toOrgType(body));
        update.setLeader(body.text("leader", false, 64));
        update.setSortOrder(body.integer("sortOrder", true, 0, null));
        update.setRemark(body.text("remark", false, 512));

        String oldPrefix = moveTarget(body, current, update);
        // 提交的 parentId 与当前相同时 moveTarget 不写移动参数，因此 oldPrefix 非空即父组织确有改变。
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(oldPrefix != null
                || isChanged(update.getOrgName(), current.getOrgName())
                || isChanged(update.getOrgType(), current.getOrgType())
                || isChanged(update.getLeader(), current.getLeader())
                || isChanged(update.getSortOrder(), current.getSortOrder())
                || isChanged(update.getRemark(), current.getRemark()));
        applyUpdate(update);
        if (oldPrefix != null) {
            organizationMapper.moveSubtree(oldPrefix, update.getOrgPath().getValue());
        }
        return toDetail(require(id));
    }

    /**
     * 物理删除组织；有子组织、账号关联或组织权限组关联时不删除任何数据并返回 40903。
     *
     * @param id 组织标识
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
        int rows = organizationMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取组织，不存在时返回 40401。
     *
     * @param id 组织标识
     * @return 组织记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public Organization require(long id) {
        Organization organization = organizationMapper.findById(id);
        if (organization == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return organization;
    }

    /**
     * 读取父组织的路径；根组织的路径为空串。
     *
     * @param parentId 父组织标识，0 表示根
     * @return 父组织路径，根组织为空串
     * @throws BusinessException 父组织不存在返回 40001
     */
    private String parentPath(long parentId) {
        if (parentId == 0) {
            return "";
        }
        Organization parent = organizationMapper.findById(parentId);
        if (parent == null) {
            throw BusinessException.invalidField("parentId", "父组织不存在");
        }
        return parent.getOrgPath();
    }

    /**
     * 解析移动目标；需要移动时把新父标识与新路径写入更新参数。
     *
     * @param body PATCH 请求体
     * @param current 当前组织
     * @param update 更新参数
     * @return 移动前的父路径前缀；未移动时为 null
     * @throws BusinessException 父组织不存在、移动到自身或自己的后代返回 40001
     */
    private String moveTarget(PatchBody body, Organization current, OrganizationUpdate update) {
        PatchValue<String> patch = body.text("parentId", true, 64);
        if (!patch.isPresent()) {
            return null;
        }
        long parentId = parseParentId(patch.getValue());
        if (parentId == current.getParentId()) {
            return null;
        }
        if (parentId == current.getId()) {
            throw BusinessException.invalidField("parentId", "不能把组织移动到自身");
        }
        String newParentPath = parentPath(parentId);
        if (parentId != 0 && newParentPath.startsWith(current.getOrgPath() + "/")) {
            throw BusinessException.invalidField("parentId", "不能把组织移动到自己的下级");
        }
        String newPath = newParentPath + "/" + current.getId();
        requirePathLength(newPath);
        requireSubtreePathLength(current.getOrgPath(), newPath);
        update.setParentId(PatchValue.of(parentId));
        update.setOrgPath(PatchValue.of(newPath));
        return current.getOrgPath();
    }

    private static void requirePathLength(String orgPath) {
        if (orgPath.length() > MAX_ORG_PATH_LENGTH) {
            throw BusinessException.invalidField("parentId", "组织层级过深，物化路径超出 512 个字符");
        }
    }

    /**
     * 移动会整体改写后代路径，必须按子树最长路径判定，否则会落到数据库列长约束上。
     *
     * @param oldPath 移动前的自身路径
     * @param newPath 移动后的自身路径
     * @throws BusinessException 任一后代路径将超过列长时返回 40001
     */
    private void requireSubtreePathLength(String oldPath, String newPath) {
        int longestDescendant = organizationMapper.maxDescendantPathLength(oldPath);
        if (longestDescendant == 0) {
            return;
        }
        int projected = longestDescendant + newPath.length() - oldPath.length();
        if (projected > MAX_ORG_PATH_LENGTH) {
            throw BusinessException.invalidField("parentId", "移动后子组织物化路径超出 512 个字符");
        }
    }

    private void applyUpdate(OrganizationUpdate update) {
        int rows = organizationMapper.update(update);
        if (rows == 0) {
            require(update.getId());
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    private PatchValue<String> toOrgType(PatchBody body) {
        PatchValue<String> patch = body.text("orgType", true, 32);
        if (!patch.isPresent()) {
            return patch;
        }
        return PatchValue.of(normalizeOrgType(patch.getValue()));
    }

    private List<ReferenceItem> describeReferences(long id) {
        List<ReferenceItem> references = new ArrayList<>();
        long children = organizationMapper.countChildren(id);
        if (children > 0) {
            references.add(new ReferenceItem("childOrganization", null, "存在 " + children + " 个子组织"));
        }
        long accounts = organizationMapper.countAccountLinks(id);
        if (accounts > 0) {
            references.add(new ReferenceItem("accountOrganization", null, "存在 " + accounts + " 条账号与组织关联"));
        }
        long groups = organizationMapper.countPermissionGroupLinks(id);
        if (groups > 0) {
            references.add(new ReferenceItem("permissionGroupOrganization", null,
                    "存在 " + groups + " 条组织权限组关联"));
        }
        return references;
    }

    private static long parseParentId(String text) {
        Long value = Ids.parse(text, "parentId");
        if (value == null) {
            return 0L;
        }
        if (value < 0) {
            throw BusinessException.invalidField("parentId", "请输入大于等于 0 的整数标识");
        }
        return value;
    }

    private static String normalizeOrgType(String value) {
        String trimmed = value == null ? "" : value.trim();
        if (!ORG_TYPES.contains(trimmed)) {
            throw BusinessException.invalidField("orgType", "不支持的取值");
        }
        return trimmed;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 提交的字段与当前值是否不同。
     *
     * <p>三态语义下只有已提交的字段参与比较，显式 null 与当前非 null 属于变更。{@code parentId} 不在此
     * 比较：{@link #moveTarget} 的返回值已经表示父组织是否改变。
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
     * @param organization 组织记录
     * @return 组织响应字段
     */
    public static Detail toDetail(Organization organization) {
        return new Detail(Ids.of(organization.getId()), Ids.of(organization.getParentId()),
                organization.getOrgPath(), organization.getOrgName(), organization.getOrgType(),
                organization.getLeader(), organization.getSortOrder(), organization.getRemark(),
                BeijingTime.format(organization.getCreatedAt()), BeijingTime.format(organization.getUpdatedAt()),
                Ids.of(organization.getCreatedBy()), Ids.of(organization.getUpdatedBy()),
                Ids.of(organization.getVersion()));
    }
}
