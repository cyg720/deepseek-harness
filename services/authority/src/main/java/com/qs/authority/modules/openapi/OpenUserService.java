package com.qs.authority.modules.openapi;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.Ids;
import com.qs.authority.modules.account.Account;
import com.qs.authority.modules.account.AccountDtos;
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.account.AccountService;
import com.qs.authority.modules.appauthorization.AppAuthorization;
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.openapi.OpenUserDtos.OperationItem;
import com.qs.authority.modules.openapi.OpenUserDtos.PermissionsResponse;
import com.qs.authority.modules.operation.OperationRecord;
import com.qs.authority.security.AuthContext;
import com.qs.authority.security.PermissionService;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * 开放能力服务：当前用户详情与在目标应用内的可用操作。
 *
 * <p>权限始终按当前登录账号计算，接口不接收账号标识，也不提供跨应用转授权限的链路；目标应用
 * 不可见时拒绝，而不是返回空许可。
 */
@Service
public class OpenUserService {

    private final AccountMapper accountMapper;
    private final AppAuthorizationMapper appAuthorizationMapper;
    private final PermissionService permissionService;

    /**
     * 构造开放能力服务。
     *
     * @param accountMapper 账号持久层
     * @param appAuthorizationMapper 应用授权持久层
     * @param permissionService 权限服务
     */
    public OpenUserService(AccountMapper accountMapper, AppAuthorizationMapper appAuthorizationMapper,
            PermissionService permissionService) {
        this.accountMapper = accountMapper;
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.permissionService = permissionService;
    }

    /**
     * 当前登录账号详情。
     *
     * @param accountId 账号标识
     * @return 获准账号字段
     * @throws BusinessException 账号不存在时返回 40101
     */
    public AccountDtos.Detail me(long accountId) {
        Account account = accountMapper.findById(accountId);
        if (account == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        return AccountService.toDetail(account);
    }

    /**
     * 查询当前账号在目标应用内可用的操作。
     *
     * @param account 当前登录账号
     * @param appCode 目标应用编码
     * @return 应用可见性与可用操作
     * @throws BusinessException 应用未登记返回 40401，应用冻结或下线返回 40302，应用不可见返回 40301
     */
    public PermissionsResponse permissions(AuthContext.AccountIdentity account, String appCode) {
        if (appCode == null || appCode.isBlank()) {
            throw BusinessException.invalidField("appCode", "请输入目标应用编码");
        }
        AppAuthorization app = appAuthorizationMapper.findByAppCode(appCode.trim());
        if (app == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND, "目标应用未登记");
        }
        if (!app.active()) {
            throw BusinessException.of(ErrorCode.SUBJECT_UNAVAILABLE,
                    "frozen".equals(app.getStatus()) ? "应用已冻结" : "应用已下线");
        }
        if (!account.superAdmin() && !permissionService.appVisible(account.id(), app.getId())) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "应用对该账号不可见");
        }
        List<OperationItem> operations = permissionService.effectiveOperations(account, app.getAppCode()).stream()
                .map(OpenUserService::toItem)
                .toList();
        return new PermissionsResponse(app.getAppCode(), true, operations);
    }

    private static OperationItem toItem(OperationRecord operation) {
        return new OperationItem(Ids.of(operation.getId()), operation.getOperationCode(),
                operation.getOperationName());
    }
}
