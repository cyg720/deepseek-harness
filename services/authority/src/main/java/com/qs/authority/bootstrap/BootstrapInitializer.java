package com.qs.authority.bootstrap;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.config.AuthorityProperties;
import com.qs.authority.modules.account.Account;
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.appauthorization.AppAuthorization;
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.operation.OperationMapper;
import com.qs.authority.modules.operation.OperationRecord;
import com.qs.authority.security.CenterOperations;
import com.qs.authority.security.PasswordService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 受控初始化：内置超级管理员、授权中心自身应用与操作、应用中心受控身份。
 *
 * <p>初始化可重复执行：每一类对象都先按唯一键查询，已存在时保持原值，不覆盖有效账号、不重置
 * 凭据、不重建 AppKey。缺失的必填凭据直接使启动失败，而不是生成一个无人知晓的秘密。
 *
 * <p>初始化建立的账号、应用与操作都不构成通用绕过入口：超级管理员仍要通过 AppKey、令牌、
 * 冻结与首次改密检查；管理接口仍按已登记操作鉴权。
 */
@Component
public class BootstrapInitializer implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(BootstrapInitializer.class);

    private final AuthorityProperties properties;
    private final AccountMapper accountMapper;
    private final AppAuthorizationMapper appAuthorizationMapper;
    private final OperationMapper operationMapper;
    private final PasswordService passwordService;
    private final SecureRandom random = new SecureRandom();

    /**
     * 构造初始化器。
     *
     * @param properties 部署配置
     * @param accountMapper 账号持久层
     * @param appAuthorizationMapper 应用授权持久层
     * @param operationMapper 操作持久层
     * @param passwordService 口令服务
     */
    public BootstrapInitializer(AuthorityProperties properties, AccountMapper accountMapper,
            AppAuthorizationMapper appAuthorizationMapper, OperationMapper operationMapper,
            PasswordService passwordService) {
        this.properties = properties;
        this.accountMapper = accountMapper;
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.operationMapper = operationMapper;
        this.passwordService = passwordService;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!properties.bootstrap().enabled()) {
            LOG.info("初始化引导已关闭，跳过内置身份建立");
            return;
        }
        ensureSelfApplication();
        ensureCenterOperations();
        ensureAppCenterApplication();
        ensureSuperAdmin();
    }

    private void ensureSelfApplication() {
        if (appAuthorizationMapper.findByAppCode(properties.selfAppCode()) != null) {
            return;
        }
        String appKey = requireConfigured(properties.selfAppKey(), "AUTH_SELF_APP_KEY",
                "初始化授权中心自身应用需要配置 AppKey");
        AppAuthorization authorization = new AppAuthorization();
        authorization.setAppCode(properties.selfAppCode());
        authorization.setAppKey(appKey);
        authorization.setAppSecret(digest(randomSecret()));
        authorization.setStatus("active");
        appAuthorizationMapper.insert(authorization);
        LOG.info("已建立授权中心自身应用授权记录 appCode={}", properties.selfAppCode());
    }

    private void ensureCenterOperations() {
        int created = 0;
        for (String suffix : CenterOperations.all()) {
            String operationCode = CenterOperations.full(properties.selfAppCode(), suffix);
            if (operationMapper.findByCode(operationCode) != null) {
                continue;
            }
            OperationRecord operation = new OperationRecord();
            operation.setAppCode(properties.selfAppCode());
            operation.setOperationCode(operationCode);
            operation.setOperationName(suffix.substring(suffix.indexOf('.') + 1));
            operation.setOperationDesc("授权中心管理操作：" + suffix);
            operationMapper.insert(operation);
            created++;
        }
        if (created > 0) {
            LOG.info("已登记授权中心自身管理操作 {} 个", created);
        }
    }

    private void ensureAppCenterApplication() {
        if (appAuthorizationMapper.findByAppCode(properties.appCenterAppCode()) != null) {
            return;
        }
        String appKey = requireConfigured(properties.appCenterAppKey(), "AUTH_APP_CENTER_KEY",
                "初始化应用中心受控身份需要配置 AppKey");
        AppAuthorization authorization = new AppAuthorization();
        authorization.setAppCode(properties.appCenterAppCode());
        authorization.setAppKey(appKey);
        authorization.setAppSecret(digest(randomSecret()));
        authorization.setStatus("active");
        appAuthorizationMapper.insert(authorization);
        LOG.info("已建立应用中心受控身份授权记录 appCode={}", properties.appCenterAppCode());
    }

    private void ensureSuperAdmin() {
        if (accountMapper.countSuperAdmins() > 0) {
            return;
        }
        String username = properties.bootstrap().superUsername();
        Account existing = accountMapper.findByUsername(username);
        if (existing != null) {
            throw new IllegalStateException("用户名 " + username + " 已被非内置账号占用，无法建立内置超级管理员");
        }
        String initialPassword = requireConfigured(properties.bootstrap().superPassword(), "AUTH_SUPER_PASSWORD",
                "初始化内置超级管理员需要配置初始密码");
        try {
            passwordService.requireComplex(initialPassword, "password");
        } catch (BusinessException exception) {
            throw new IllegalStateException("初始化超级管理员密码不满足复杂度要求：" + exception.getMessage(), exception);
        }
        Account account = new Account();
        account.setUsername(username);
        account.setPassword(passwordService.encode(initialPassword));
        account.setPhone(blankToNull(properties.bootstrap().superPhone()));
        account.setAccountType("person");
        account.setStatus("normal");
        account.setIpWhitelist("[]");
        account.setMustChangePassword(Boolean.TRUE);
        account.setIsSuperAdmin(Boolean.TRUE);
        accountMapper.insert(account);
        LOG.info("已建立内置超级管理员 username={}，首次登录必须修改初始密码", username);
    }

    private String requireConfigured(String value, String variable, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(message + "；请设置环境变量 " + variable + " 后重新启动");
        }
        return value.trim();
    }

    private String randomSecret() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String digest(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行环境缺少 SHA-256", exception);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
