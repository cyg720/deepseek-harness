package com.qs.authority.modules.usergroupmembership;

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
import com.qs.authority.modules.usergroup.UserGroupMapper;
import com.qs.authority.modules.usergroupmembership.UserGroupMembershipDtos.CreateRequest;
import com.qs.authority.modules.usergroupmembership.UserGroupMembershipDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户组成员服务。
 *
 * <p>加入用户组不增加功能权限，只维护跨部门人员集合；成员关系两端必须指向真实用户组与真实账号，
 * 同一组合只保留一条记录。删除只解除关系，不删除用户组或账号。
 */
@Service
public class UserGroupMembershipService {

    /** 成员列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "userGroupId",
            "accountId");

    /** 成员 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "userGroupId", "accountId");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final UserGroupMembershipMapper userGroupMembershipMapper;
    private final UserGroupMapper userGroupMapper;
    private final AccountMapper accountMapper;

    /**
     * 构造成员服务。
     *
     * @param userGroupMembershipMapper 成员持久层
     * @param userGroupMapper 用户组持久层
     * @param accountMapper 账号持久层
     */
    public UserGroupMembershipService(UserGroupMembershipMapper userGroupMembershipMapper,
            UserGroupMapper userGroupMapper, AccountMapper accountMapper) {
        this.userGroupMembershipMapper = userGroupMembershipMapper;
        this.userGroupMapper = userGroupMapper;
        this.accountMapper = accountMapper;
    }

    /**
     * 成员列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增成员。
     *
     * @param request 新增请求
     * @return 新增后的成员关系
     * @throws BusinessException 用户组或账号不存在返回 40001，组合重复返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        long userGroupId = Ids.require(request.userGroupId(), "userGroupId");
        long accountId = Ids.require(request.accountId(), "accountId");
        requireUserGroup(userGroupId);
        requireAccount(accountId);
        requireAbsent(userGroupId, accountId, null);

        UserGroupMembership membership = new UserGroupMembership();
        membership.setUserGroupId(userGroupId);
        membership.setAccountId(accountId);
        membership.setCreatedBy(AuthContext.operatorId());
        membership.setUpdatedBy(AuthContext.operatorId());
        userGroupMembershipMapper.insert(membership);
        return toDetail(require(membership.getId()));
    }

    /**
     * 成员详情。
     *
     * @param id 成员关系标识
     * @return 成员详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询成员。
     *
     * @param query 分页与排序参数
     * @param userGroupId 用户组标识筛选，可为 null
     * @param accountId 账号标识筛选，可为 null
     * @return 分页结果
     * @throws BusinessException 筛选值不是整数标识时返回 40001
     */
    public Paged<Detail> list(PageQuery query, String userGroupId, String accountId) {
        Long normalizedGroupId = Ids.parse(userGroupId, "userGroupId");
        Long normalizedAccountId = Ids.parse(accountId, "accountId");
        List<UserGroupMembership> rows = userGroupMembershipMapper.list(normalizedGroupId, normalizedAccountId,
                query.orderBy(), query.pageSize(), query.offset());
        long total = userGroupMembershipMapper.count(normalizedGroupId, normalizedAccountId);
        return new Paged<>(rows.stream().map(UserGroupMembershipService::toDetail).toList(), query.page(),
                query.pageSize(), total);
    }

    /**
     * 编辑成员关系，提交的一端或两端整体替换为新的组合。
     *
     * <p>只提交一端时另一端保持原值，写入仍是完整组合，不会变成新增记录；替换后的组合被其他记录
     * 占用时拒绝，原记录保持不变。
     *
     * <p>提交的两端与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 成员关系标识
     * @param body PATCH 请求体
     * @return 编辑后的成员关系
     * @throws BusinessException 未知字段、用户组或账号不存在、没有有效变更返回 40001，组合重复返回 40902，
     *     版本冲突返回 40901
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        UserGroupMembership current = require(id);
        PatchValue<Long> groupPatch = body.id("userGroupId", true);
        PatchValue<Long> accountPatch = body.id("accountId", true);
        long userGroupId = groupPatch.isPresent() ? groupPatch.getValue() : current.getUserGroupId();
        long accountId = accountPatch.isPresent() ? accountPatch.getValue() : current.getAccountId();
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(groupPatch, current.getUserGroupId())
                || isChanged(accountPatch, current.getAccountId()));
        requireUserGroup(userGroupId);
        requireAccount(accountId);
        requireAbsent(userGroupId, accountId, id);

        UserGroupMembershipUpdate update = new UserGroupMembershipUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUserGroupId(userGroupId);
        update.setAccountId(accountId);
        update.setUpdatedBy(AuthContext.operatorId());
        applyUpdate(update);
        return toDetail(require(id));
    }

    /**
     * 删除成员关系；只解除该账号与用户组的关系，账号、用户组与其他成员关系保持不变。
     *
     * @param id 成员关系标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = userGroupMembershipMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取成员关系，不存在时返回 40401。
     *
     * @param id 成员关系标识
     * @return 成员记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public UserGroupMembership require(long id) {
        UserGroupMembership membership = userGroupMembershipMapper.findById(id);
        if (membership == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return membership;
    }

    private void requireUserGroup(long userGroupId) {
        if (userGroupMapper.findById(userGroupId) == null) {
            throw BusinessException.invalidField("userGroupId", "用户组不存在");
        }
    }

    private void requireAccount(long accountId) {
        if (accountMapper.findById(accountId) == null) {
            throw BusinessException.invalidField("accountId", "账号不存在");
        }
    }

    private void requireAbsent(long userGroupId, long accountId, Long excludeId) {
        if (userGroupMembershipMapper.countByPair(userGroupId, accountId, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "该账号已加入该用户组");
        }
    }

    private void applyUpdate(UserGroupMembershipUpdate update) {
        int rows = userGroupMembershipMapper.update(update);
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
     * @param membership 成员记录
     * @return 成员响应字段
     */
    public static Detail toDetail(UserGroupMembership membership) {
        return new Detail(Ids.of(membership.getId()), Ids.of(membership.getUserGroupId()),
                Ids.of(membership.getAccountId()), BeijingTime.format(membership.getCreatedAt()),
                BeijingTime.format(membership.getUpdatedAt()), Ids.of(membership.getCreatedBy()),
                Ids.of(membership.getUpdatedBy()), Ids.of(membership.getVersion()));
    }
}
