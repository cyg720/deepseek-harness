package com.qs.authority.modules.password;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.modules.account.Account;
import com.qs.authority.modules.account.AccountMapper;
import com.qs.authority.modules.account.AccountUpdate;
import com.qs.authority.security.PasswordService;
import com.qs.authority.security.TokenService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 密码维护：本人改密与首次登录强制改密。
 *
 * <p>两条流程都要求新密码满足复杂度，并在同一事务内完成口令更新与“该账号全部旧令牌失效”；
 * 任一环节失败都不产生半完成状态。改密成功后必须重新登录，因为当前设备令牌也已被撤销。
 */
@Service
public class PasswordChangeService {

    private final AccountMapper accountMapper;
    private final PasswordService passwordService;
    private final TokenService tokenService;

    /**
     * 构造密码维护服务。
     *
     * @param accountMapper 账号持久层
     * @param passwordService 口令服务
     * @param tokenService 令牌服务
     */
    public PasswordChangeService(AccountMapper accountMapper, PasswordService passwordService,
            TokenService tokenService) {
        this.accountMapper = accountMapper;
        this.passwordService = passwordService;
        this.tokenService = tokenService;
    }

    /**
     * 本人修改密码，必须验证原密码。
     *
     * @param accountId 当前账号标识
     * @param oldPassword 原密码
     * @param newPassword 新密码
     * @throws BusinessException 原密码不正确返回 40101，新密码不满足复杂度返回 40001
     */
    @Transactional
    public void changeOwnPassword(long accountId, String oldPassword, String newPassword) {
        Account account = requireAccount(accountId);
        if (!passwordService.matches(oldPassword, account.getPassword())) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL, "原密码不正确");
        }
        applyNewPassword(account, newPassword, "newPassword");
    }

    /**
     * 首次登录修改初始密码；仅限仍处于强制改密状态的账号。
     *
     * @param accountId 当前账号标识
     * @param newPassword 新密码
     * @throws BusinessException 当前不需要改密返回 40904，新密码不满足复杂度返回 40001
     */
    @Transactional
    public void changeInitialPassword(long accountId, String newPassword) {
        Account account = requireAccount(accountId);
        if (!Boolean.TRUE.equals(account.getMustChangePassword())) {
            throw BusinessException.of(ErrorCode.STATE_CONFLICT, "当前账号不需要修改初始密码");
        }
        applyNewPassword(account, newPassword, "newPassword");
    }

    private void applyNewPassword(Account account, String newPassword, String field) {
        passwordService.requireComplex(newPassword, field);
        if (passwordService.matches(newPassword, account.getPassword())) {
            throw BusinessException.invalidField(field, "新密码不能与原密码相同");
        }
        AccountUpdate update = new AccountUpdate();
        update.setId(account.getId());
        update.setVersion(account.getVersion());
        update.setUpdatedBy(account.getId());
        update.setPassword(PatchValue.of(passwordService.encode(newPassword)));
        update.setMustChangePassword(PatchValue.of(Boolean.FALSE));
        if (accountMapper.update(update) == 0) {
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT, "账号已被他人修改，请重新登录后再试");
        }
        tokenService.revokeAccount(account.getId());
    }

    private Account requireAccount(long accountId) {
        Account account = accountMapper.findById(accountId);
        if (account == null) {
            throw BusinessException.of(ErrorCode.INVALID_CREDENTIAL);
        }
        return account;
    }
}
