package com.qs.authority.modules.accountorganization;

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
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.accountorganization.AccountOrganizationDtos.CreateRequest;
import com.qs.authority.modules.accountorganization.AccountOrganizationDtos.Detail;
import com.qs.authority.modules.organization.OrganizationMapper;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 账号与组织关联服务。
 *
 * <p>关联的两端必须指向真实账号与真实组织，同一组合只保留一条记录；删除只解除该条关联，不删除
 * 账号或组织，也不影响账号的其他组织关联。
 */
@Service
public class AccountOrganizationService {

    /** 关联列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "accountId",
            "orgId");

    /** 关联 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "accountId", "orgId");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final AccountOrganizationMapper accountOrganizationMapper;
    private final AccountMapper accountMapper;
    private final OrganizationMapper organizationMapper;

    /**
     * 构造关联服务。
     *
     * @param accountOrganizationMapper 关联持久层
     * @param accountMapper 账号持久层
     * @param organizationMapper 组织持久层
     */
    public AccountOrganizationService(AccountOrganizationMapper accountOrganizationMapper, AccountMapper accountMapper,
            OrganizationMapper organizationMapper) {
        this.accountOrganizationMapper = accountOrganizationMapper;
        this.accountMapper = accountMapper;
        this.organizationMapper = organizationMapper;
    }

    /**
     * 关联列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增关联。
     *
     * @param request 新增请求
     * @return 新增后的关联
     * @throws BusinessException 账号或组织不存在返回 40001，组合重复返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        long accountId = Ids.require(request.accountId(), "accountId");
        long orgId = Ids.require(request.orgId(), "orgId");
        requireAccount(accountId);
        requireOrganization(orgId);
        requireAbsent(accountId, orgId, null);

        AccountOrganization link = new AccountOrganization();
        link.setAccountId(accountId);
        link.setOrgId(orgId);
        link.setCreatedBy(AuthContext.operatorId());
        link.setUpdatedBy(AuthContext.operatorId());
        accountOrganizationMapper.insert(link);
        return toDetail(require(link.getId()));
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
     * @param accountId 账号标识筛选，可为 null
     * @param orgId 组织标识筛选，可为 null
     * @return 分页结果
     * @throws BusinessException 筛选值不是整数标识时返回 40001
     */
    public Paged<Detail> list(PageQuery query, String accountId, String orgId) {
        Long normalizedAccountId = Ids.parse(accountId, "accountId");
        Long normalizedOrgId = Ids.parse(orgId, "orgId");
        List<AccountOrganization> rows = accountOrganizationMapper.list(normalizedAccountId, normalizedOrgId,
                query.orderBy(), query.pageSize(), query.offset());
        long total = accountOrganizationMapper.count(normalizedAccountId, normalizedOrgId);
        return new Paged<>(rows.stream().map(AccountOrganizationService::toDetail).toList(), query.page(),
                query.pageSize(), total);
    }

    /**
     * 编辑关联，提交的一端或两端整体替换为新的组合。
     *
     * <p>只提交一端时另一端保持原值，写入仍是完整组合，不会变成新增记录；替换后的组合被其他记录
     * 占用时拒绝，原记录保持不变。
     *
     * <p>提交的两端与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 关联标识
     * @param body PATCH 请求体
     * @return 编辑后的关联
     * @throws BusinessException 未知字段、账号或组织不存在、没有有效变更返回 40001，组合重复返回 40902，
     *     版本冲突返回 40901
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        AccountOrganization current = require(id);
        PatchValue<Long> accountPatch = body.id("accountId", true);
        PatchValue<Long> orgPatch = body.id("orgId", true);
        long accountId = accountPatch.isPresent() ? accountPatch.getValue() : current.getAccountId();
        long orgId = orgPatch.isPresent() ? orgPatch.getValue() : current.getOrgId();
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(accountPatch, current.getAccountId())
                || isChanged(orgPatch, current.getOrgId()));
        requireAccount(accountId);
        requireOrganization(orgId);
        requireAbsent(accountId, orgId, id);

        AccountOrganizationUpdate update = new AccountOrganizationUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setAccountId(accountId);
        update.setOrgId(orgId);
        update.setUpdatedBy(AuthContext.operatorId());
        applyUpdate(update);
        return toDetail(require(id));
    }

    /**
     * 删除关联；只解除该条账号与组织的关系，账号、组织与其他关联保持不变。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = accountOrganizationMapper.delete(id, version);
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
    public AccountOrganization require(long id) {
        AccountOrganization link = accountOrganizationMapper.findById(id);
        if (link == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return link;
    }

    private void requireAccount(long accountId) {
        if (accountMapper.findById(accountId) == null) {
            throw BusinessException.invalidField("accountId", "账号不存在");
        }
    }

    private void requireOrganization(long orgId) {
        if (organizationMapper.findById(orgId) == null) {
            throw BusinessException.invalidField("orgId", "组织不存在");
        }
    }

    private void requireAbsent(long accountId, long orgId, Long excludeId) {
        if (accountOrganizationMapper.countByPair(accountId, orgId, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "该账号已关联该组织");
        }
    }

    private void applyUpdate(AccountOrganizationUpdate update) {
        int rows = accountOrganizationMapper.update(update);
        if (rows == 0) {
            require(update.getId());
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
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
     * @param link 关联记录
     * @return 关联响应字段
     */
    public static Detail toDetail(AccountOrganization link) {
        return new Detail(Ids.of(link.getId()), Ids.of(link.getAccountId()), Ids.of(link.getOrgId()),
                BeijingTime.format(link.getCreatedAt()), BeijingTime.format(link.getUpdatedAt()),
                Ids.of(link.getCreatedBy()), Ids.of(link.getUpdatedBy()), Ids.of(link.getVersion()));
    }
}
