package com.qs.authority.modules.authorizationcheck;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.support.Json;
import com.qs.authority.common.trace.TraceContext;
import com.qs.authority.modules.appauthorization.AppAuthorization;
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.audit.AuditAttributes;
import com.qs.authority.modules.audit.AuditLog;
import com.qs.authority.modules.audit.AuditService;
import com.qs.authority.modules.authorizationcheck.AuthorizationCheckDtos.CheckRequest;
import com.qs.authority.modules.authorizationcheck.AuthorizationCheckDtos.CheckResponse;
import com.qs.authority.modules.operation.OperationMapper;
import com.qs.authority.modules.operation.OperationRecord;
import com.qs.authority.security.AuthContext;
import com.qs.authority.security.PermissionService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 验证应用授权（API-11）。
 *
 * <p>调用顺序：AppKey 与用户令牌已在拦截器核验 → 按完整操作码找到目标应用 → 判定应用可见性
 * 与操作权限。普通账号必须同时满足“应用可见”和“拥有该操作”，可见权限组不构成功能上限；内置
 * 超级管理员不依赖权限组即获得全部已登记应用与功能。授权中心只返回功能授权结果，不返回行级数据
 * 范围，也不返回委托信息。
 *
 * <p>允许结果在返回许可前写入审计：审计写失败即视为本次判定未完成，不返回许可。
 */
@Service
public class AuthorizationCheckService {

    private final OperationMapper operationMapper;
    private final AppAuthorizationMapper appAuthorizationMapper;
    private final PermissionService permissionService;
    private final AuditService auditService;

    /**
     * 构造鉴权服务。
     *
     * @param operationMapper 操作持久层
     * @param appAuthorizationMapper 应用授权持久层
     * @param permissionService 权限服务
     * @param auditService 审计服务
     */
    public AuthorizationCheckService(OperationMapper operationMapper, AppAuthorizationMapper appAuthorizationMapper,
            PermissionService permissionService, AuditService auditService) {
        this.operationMapper = operationMapper;
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.permissionService = permissionService;
        this.auditService = auditService;
    }

    /**
     * 验证当前登录账号在目标应用中是否拥有指定操作。
     *
     * @param request 鉴权请求
     * @return 允许结果
     * @throws BusinessException 操作未登记、应用不可见或无该操作返回 40301，应用冻结或下线返回 40302
     */
    @Transactional
    public CheckResponse check(CheckRequest request) {
        AuthContext.AccountIdentity account = AuthContext.requireAccount();
        String operationCode = request.operationCode().trim();
        AuditAttributes.markTarget(operationCode, request.resourceId(), request.resourceType());

        OperationRecord operation = operationMapper.findByCode(operationCode);
        if (operation == null) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "操作未登记");
        }
        AppAuthorization app = appAuthorizationMapper.findByAppCode(operation.getAppCode());
        if (app == null) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION, "操作所属应用未登记");
        }
        if (!app.active()) {
            throw BusinessException.of(ErrorCode.SUBJECT_UNAVAILABLE,
                    "frozen".equals(app.getStatus()) ? "应用已冻结" : "应用已下线");
        }
        PermissionService.AccessDecision decision = permissionService.decide(account, app, operation.getId());
        if (!decision.allowed()) {
            throw BusinessException.of(ErrorCode.NO_PERMISSION,
                    decision.visible() ? "未授予该操作" : "应用对该账号不可见");
        }
        recordAllowance(account, app, operation, request);
        return new CheckResponse(true, operationCode, app.getAppCode(), Ids.of(account.id()));
    }

    private void recordAllowance(AuthContext.AccountIdentity account, AppAuthorization app, OperationRecord operation,
            CheckRequest request) {
        AuditLog log = new AuditLog();
        log.setTraceId(TraceContext.current());
        log.setAccountId(account.id());
        log.setAppCode(app.getAppCode());
        log.setOperationCode(operation.getOperationCode());
        log.setResourceId(request.resourceId());
        log.setResourceType(request.resourceType());
        log.setResult("success");
        log.setReason("授权通过");
        log.setLogLevel("info");
        // 本条记录是本次请求唯一的审计行（拦截器不再重复记录），因此必须补齐请求来源、正文与耗时，
        // 否则“谁从哪里发起了这次授权”无从追查。
        AuthContext.Authentication authentication = AuthContext.get();
        if (authentication != null) {
            log.setRequestIp(authentication.clientIp());
            log.setUserAgent(authentication.userAgent());
        }
        log.setCostMs(AuditAttributes.elapsedMillis());
        log.setRequestBody(Json.write(describeRequest(request)));
        log.setResponseBody(Json.write(Map.of("allowed", true, "operationCode", operation.getOperationCode(),
                "appCode", app.getAppCode(), "accountId", Ids.of(account.id()))));
        auditService.record(log);
        AuditAttributes.markSkip();
    }

    /**
     * 把鉴权请求整理为可入库的字段；空值不写入，避免出现 null 键。
     *
     * @param request 鉴权请求
     * @return 请求字段
     */
    private static Map<String, Object> describeRequest(CheckRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("operationCode", request.operationCode());
        if (request.resourceId() != null) {
            fields.put("resourceId", request.resourceId());
        }
        if (request.resourceType() != null) {
            fields.put("resourceType", request.resourceType());
        }
        return fields;
    }
}
