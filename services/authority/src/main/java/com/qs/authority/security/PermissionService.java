package com.qs.authority.security;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.config.AuthorityProperties;
import com.qs.authority.modules.appauthorization.AppAuthorization;
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.operation.OperationMapper;
import com.qs.authority.modules.operation.OperationRecord;
import com.qs.authority.modules.permissiongroup.PermissionGroupMapper;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * 权限计算：用户取得哪些权限组、组内操作并集、应用可见性与功能权限。
 *
 * <p>普通账号通过“用户与权限组关联”或“其实际所属组织与权限组关联”取得权限组；应用可见性是
 * 用户取得的组与应用可见组的交集，功能权限是取得组内操作的并集。内置超级管理员不依赖权限组，
 * 但身份、冻结与首次改密检查照旧。
 *
 * <p>授权中心的自身管理接口使用与 {@code POST /authorization-checks} 完全相同的两级判定：
 * 普通账号必须同时满足“授权中心应用对其可见”和“拥有目标操作”，因此鉴权接口拒绝的调用不会在
 * 管理接口上成功。
 */
@Service
public class PermissionService {

    private final PermissionGroupMapper permissionGroupMapper;
    private final OperationMapper operationMapper;
    private final AppAuthorizationMapper appAuthorizationMapper;
    private final AuthorityProperties properties;

    /**
     * 构造权限服务。
     *
     * @param permissionGroupMapper 权限组持久层
     * @param operationMapper 操作持久层
     * @param appAuthorizationMapper 应用授权持久层
     * @param properties 部署配置
     */
    public PermissionService(PermissionGroupMapper permissionGroupMapper, OperationMapper operationMapper,
            AppAuthorizationMapper appAuthorizationMapper, AuthorityProperties properties) {
        this.permissionGroupMapper = permissionGroupMapper;
        this.operationMapper = operationMapper;
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.properties = properties;
    }

    /**
     * 查询账号实际取得的权限组标识。
     *
     * @param accountId 账号标识
     * @return 权限组标识列表
     */
    public List<Long> obtainedGroupIds(long accountId) {
        return permissionGroupMapper.listObtainedGroupIds(accountId);
    }

    /**
     * 计算若干权限组内操作的并集。
     *
     * @param groupIds 权限组标识；为空时返回空集合
     * @return 操作标识集合
     */
    public Set<Long> operationIds(List<Long> groupIds) {
        if (groupIds == null || groupIds.isEmpty()) {
            return Set.of();
        }
        return new LinkedHashSet<>(permissionGroupMapper.listOperationIds(groupIds));
    }

    /**
     * 校验管理接口所需的操作权限。
     *
     * @param account 登录账号
     * @param operationSuffix 操作码后缀，形如 {@code AccountController.create}
     * @throws BusinessException 超级管理员以外无该操作时抛出 40301
     */
    public void requireOperation(AuthContext.AccountIdentity account, String operationSuffix) {
        if (account == null) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION);
        }
        if (account.superAdmin()) {
            return;
        }
        String operationCode = CenterOperations.full(properties.selfAppCode(), operationSuffix);
        OperationRecord operation = operationMapper.findByCode(operationCode);
        if (operation == null) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "该管理操作尚未登记，无法授权");
        }
        AppAuthorization selfApp = appAuthorizationMapper.findByAppCode(properties.selfAppCode());
        if (selfApp == null) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "授权中心自身应用尚未登记");
        }
        AccessDecision decision = decide(account, selfApp, operation.getId());
        if (!decision.allowed()) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION,
                    decision.visible() ? "未授予该操作" : "应用对该账号不可见");
        }
    }

    /**
     * 判断目标应用对账号是否可见。
     *
     * @param accountId 账号标识
     * @param appAuthorizationId 应用授权记录标识
     * @return 命中任一可见组时为 true
     */
    public boolean appVisible(long accountId, long appAuthorizationId) {
        List<Long> groupIds = obtainedGroupIds(accountId);
        if (groupIds.isEmpty()) {
            return false;
        }
        return appAuthorizationMapper.countVisibility(appAuthorizationId, groupIds) > 0;
    }

    /**
     * 计算账号在目标应用内可用的操作。
     *
     * @param account 登录账号
     * @param appCode 目标应用编码
     * @return 可用操作列表；超级管理员返回该应用全部已登记操作，不可见时返回空列表
     */
    public List<OperationRecord> effectiveOperations(AuthContext.AccountIdentity account, String appCode) {
        List<OperationRecord> operations = operationMapper.listAllByAppCode(appCode);
        if (account.superAdmin()) {
            return operations;
        }
        AppAuthorization app = appAuthorizationMapper.findByAppCode(appCode);
        if (app == null || !appVisible(account.id(), app.getId())) {
            return List.of();
        }
        Set<Long> granted = operationIds(obtainedGroupIds(account.id()));
        return operations.stream().filter(operation -> granted.contains(operation.getId())).toList();
    }

    /**
     * 应用与操作的两级判定结果。
     *
     * @param visible 应用是否对账号可见
     * @param operationGranted 账号是否拥有该操作
     */
    public record AccessDecision(boolean visible, boolean operationGranted) {

        /**
         * 是否允许。
         *
         * @return 应用可见且拥有操作时为 true
         */
        public boolean allowed() {
            return visible && operationGranted;
        }
    }

    /**
     * 判定账号在目标应用内是否拥有指定操作。
     *
     * @param account 登录账号
     * @param app 目标应用授权记录
     * @param operationId 操作标识
     * @return 判定结果；超级管理员始终视为可见且拥有
     */
    public AccessDecision decide(AuthContext.AccountIdentity account, AppAuthorization app, long operationId) {
        if (account.superAdmin()) {
            return new AccessDecision(true, true);
        }
        List<Long> groupIds = obtainedGroupIds(account.id());
        if (groupIds.isEmpty()) {
            return new AccessDecision(false, false);
        }
        boolean visible = appAuthorizationMapper.countVisibility(app.getId(), groupIds) > 0;
        boolean granted = operationIds(groupIds).contains(operationId);
        return new AccessDecision(visible, granted);
    }
}
