package com.qs.authority.common.web;

import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import java.util.Objects;

/**
 * PATCH 的版本前置校验。
 *
 * <p>平台公约同时规定「version 过旧返回 40901」与「没有有效变更返回 40001」。当两个条件同时成立
 * （用旧版本提交与当前完全相同的值）时，先判定版本：客户端读取的数据已经过时，必须让它重新读取
 * 并确认，不能以「没有变化」打发。写入仍然由 {@code UPDATE ... WHERE version = ?} 条件更新兜底。
 */
public final class VersionCheck {

    private VersionCheck() {
    }

    /**
     * 校验提交的版本与当前记录一致。
     *
     * @param currentVersion 数据库中当前版本，可为 null
     * @param submittedVersion 请求提交的版本
     * @throws BusinessException 版本不一致时抛出 40901
     */
    public static void requireMatch(Long currentVersion, long submittedVersion) {
        if (!Objects.equals(currentVersion, submittedVersion)) {
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }
}
