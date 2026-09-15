package com.qs.authority.modules.accountpermissiongroup;

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
import com.qs.authority.modules.accountpermissiongroup.AccountPermissionGroupDtos.CreateRequest;
import com.qs.authority.modules.accountpermissiongroup.AccountPermissionGroupDtos.Detail;
import com.qs.authority.modules.permissiongroup.PermissionGroupMapper;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户权限组关联服务：增改删查。
 *
 * <p>账号与权限组都必须已存在，同一组合不重复；编辑可以整体替换任一端的标识，替换后仍按
 * 新组合做唯一性检查；删除只解除该条用户与权限组的关联，不删除权限组或账号本身。
 */
@Service
public class AccountPermissionGroupService {

    /** 关联列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder",
            "permissionGroupId", "accountId");

    /** 关联 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "permissionGroupId", "accountId");

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

    private final AccountPermissionGroupMapper accountPermissionGroupMapper;
    private final PermissionGroupMapper permissionGroupMapper;
    private final AccountMapper accountMapper;

    /**
     * 构造关联服务。
     *
     * @param accountPermissionGroupMapper 关联持久层
     * @param permissionGroupMapper 权限组持久层，用于校验权限组存在
     * @param accountMapper 账号持久层，用于校验账号存在
     */
    public AccountPermissionGroupService(AccountPermissionGroupMapper accountPermissionGroupMapper,
            PermissionGroupMapper permissionGroupMapper, AccountMapper accountMapper) {
        this.accountPermissionGroupMapper = accountPermissionGroupMapper;
        this.permissionGroupMapper = permissionGroupMapper;
        this.accountMapper = accountMapper;
    }

    /**
     * 新增用户权限组关联。
     *
     * @param request 新增请求
     * @return 新增后的关联
     * @throws BusinessException 一端不存在返回 40001，组合已存在返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        long permissionGroupId = requirePermissionGroup(Ids.require(request.permissionGroupId(), "permissionGroupId"));
        long accountId = requireAccount(Ids.require(request.accountId(), "accountId"));
        requireUniquePair(permissionGroupId, accountId, null);

        AccountPermissionGroup record = new AccountPermissionGroup();
        record.setPermissionGroupId(permissionGroupId);
        record.setAccountId(accountId);
        record.setCreatedBy(AuthContext.operatorId());
        accountPermissionGroupMapper.insert(record);
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
     * @param accountId 账号标识筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, Long permissionGroupId, Long accountId) {
        List<AccountPermissionGroup> rows = accountPermissionGroupMapper.list(permissionGroupId, accountId,
                query.orderBy(), query.pageSize(), query.offset());
        long total = accountPermissionGroupMapper.count(permissionGroupId, accountId);
        return new Paged<>(rows.stream().map(AccountPermissionGroupService::toDetail).toList(), query.page(),
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
        AccountPermissionGroup current = require(id);

        PatchValue<Long> permissionGroupId = body.id("permissionGroupId", true);
        PatchValue<Long> accountId = body.id("accountId", true);
        long effectiveGroupId = permissionGroupId.isPresent() ? permissionGroupId.getValue()
                : current.getPermissionGroupId();
        long effectiveAccountId = accountId.isPresent() ? accountId.getValue() : current.getAccountId();
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(permissionGroupId, current.getPermissionGroupId())
                || isChanged(accountId, current.getAccountId()));
        requirePermissionGroup(effectiveGroupId);
        requireAccount(effectiveAccountId);
        requireUniquePair(effectiveGroupId, effectiveAccountId, id);

        int rows = accountPermissionGroupMapper.update(id, version, permissionGroupId, accountId);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return toDetail(require(id));
    }

    /**
     * 删除关联：只解除该条用户与权限组的关联，权限组与账号本身保持原样。
     *
     * @param id 关联标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = accountPermissionGroupMapper.delete(id, version);
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
    public AccountPermissionGroup require(long id) {
        AccountPermissionGroup record = accountPermissionGroupMapper.findById(id);
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

    private long requireAccount(long id) {
        if (accountMapper.findById(id) == null) {
            throw BusinessException.invalidField("accountId", "账号不存在");
        }
        return id;
    }

    private void requireUniquePair(long permissionGroupId, long accountId, Long excludeId) {
        if (accountPermissionGroupMapper.countByPair(permissionGroupId, accountId, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "该用户权限组关联已存在");
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
    public static Detail toDetail(AccountPermissionGroup record) {
        return new Detail(Ids.of(record.getId()), Ids.of(record.getPermissionGroupId()), Ids.of(record.getAccountId()),
                BeijingTime.format(record.getCreatedAt()), BeijingTime.format(record.getUpdatedAt()),
                Ids.of(record.getCreatedBy()), Ids.of(record.getVersion()));
    }
}
