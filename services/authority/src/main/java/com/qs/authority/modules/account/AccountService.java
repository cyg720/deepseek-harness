package com.qs.authority.modules.account;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.error.ErrorData.ReferenceItem;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.support.IpRules;
import com.qs.authority.common.support.Json;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.account.AccountDtos.CreateRequest;
import com.qs.authority.modules.account.AccountDtos.Detail;
import com.qs.authority.modules.account.AccountDtos.PasswordResetResponse;
import com.qs.authority.security.AuthContext;
import com.qs.authority.security.PasswordService;
import com.qs.authority.security.TokenService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 账号服务：增改删查、冻结解冻与随机重置密码。
 *
 * <p>账号名、非空手机与邮箱在单企业内唯一；删除账号不连带删除任何关联，有引用时返回 40903；
 * 内置超级管理员不可删除，也不能通过编辑接口改变身份。密码只走专用流程且只保存散列。
 */
@Service
public class AccountService {

    /** 账号列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "username",
            "status", "accountType");

    /** 账号 PATCH 允许写入的字段；status 由冻结/解冻动作维护，accountType 与密码不通过编辑接口写入。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "username", "phone", "email", "logo", "remark",
            "ipWhitelist");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "username", "username",
            "status", "status",
            "accountType", "account_type",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    /**
     * 账号列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    private static final Set<String> ACCOUNT_TYPES = Set.of("person", "service");
    private static final Set<String> ACCOUNT_STATUSES = Set.of("normal", "frozen");

    private final AccountMapper accountMapper;
    private final PasswordService passwordService;
    private final TokenService tokenService;

    /**
     * 构造账号服务。
     *
     * @param accountMapper 账号持久层
     * @param passwordService 口令服务
     * @param tokenService 令牌服务
     */
    public AccountService(AccountMapper accountMapper, PasswordService passwordService, TokenService tokenService) {
        this.accountMapper = accountMapper;
        this.passwordService = passwordService;
        this.tokenService = tokenService;
    }

    /**
     * 新增账号。
     *
     * @param request 新增请求
     * @return 新增后的账号
     * @throws BusinessException 唯一值重复返回 40902，字段不合法返回 40001
     */
    @Transactional
    public Detail create(CreateRequest request) {
        String accountType = normalizeEnum("accountType", request.accountType(), ACCOUNT_TYPES, "person");
        String username = request.username().trim();
        requireUniqueUsername(username, null);
        String phone = blankToNull(request.phone());
        String email = blankToNull(request.email());
        requireUniquePhone(phone, null);
        requireUniqueEmail(email, null);

        Account account = new Account();
        account.setUsername(username);
        account.setPhone(phone);
        account.setEmail(email);
        account.setLogo(blankToNull(request.logo()));
        account.setRemark(blankToNull(request.remark()));
        account.setAccountType(accountType);
        account.setStatus("normal");
        // 内置身份只能由受控初始化建立，管理接口一律写入 false。
        account.setIsSuperAdmin(Boolean.FALSE);
        account.setCreatedBy(AuthContext.operatorId());
        account.setUpdatedBy(AuthContext.operatorId());

        List<String> whitelist = validateWhitelist(request.ipWhitelist());
        if ("service".equals(accountType)) {
            if (request.password() != null && !request.password().isBlank()) {
                throw BusinessException.invalidField("password", "服务账号只能通过凭据登录，不得设置密码");
            }
            if (whitelist.isEmpty()) {
                throw BusinessException.invalidField("ipWhitelist", "服务账号必须配置 IP 白名单");
            }
            account.setPassword(null);
            account.setMustChangePassword(Boolean.FALSE);
        } else {
            if (request.password() == null || request.password().isBlank()) {
                throw BusinessException.invalidField("password", "请输入初始密码");
            }
            passwordService.requireComplex(request.password(), "password");
            account.setPassword(passwordService.encode(request.password()));
            account.setMustChangePassword(Boolean.TRUE);
        }
        account.setIpWhitelist(PatchBody.StringArray.toJson(whitelist));
        accountMapper.insert(account);
        // 创建时间、更新时间与 version 由数据库默认值和触发器产生，回读后才是最终值。
        return toDetail(require(account.getId()));
    }

    /**
     * 账号详情。
     *
     * @param id 账号标识
     * @return 账号详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询账号。
     *
     * @param query 分页与排序参数
     * @param username 用户名筛选，可为 null
     * @param status 状态筛选，可为 null
     * @param accountType 账号类型筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String username, String status, String accountType) {
        String normalizedStatus = QueryParams.enumValue("status", status, ACCOUNT_STATUSES);
        String normalizedType = QueryParams.enumValue("accountType", accountType, ACCOUNT_TYPES);
        String normalizedUsername = blankToNull(username);
        List<Account> rows = accountMapper.list(normalizedUsername, normalizedStatus, normalizedType, query.orderBy(),
                query.pageSize(), query.offset());
        long total = accountMapper.count(normalizedUsername, normalizedStatus, normalizedType);
        return new Paged<>(rows.stream().map(AccountService::toDetail).toList(), query.page(), query.pageSize(), total);
    }

    /**
     * 编辑账号。
     *
     * @param id 账号标识
     * @param body PATCH 请求体
     * @return 编辑后的账号
     * @throws BusinessException 未知字段返回 40001，版本冲突返回 40901，唯一值重复返回 40902
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        Account current = require(id);

        AccountUpdate update = new AccountUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUpdatedBy(AuthContext.operatorId());
        update.setUsername(body.text("username", true, 64));
        update.setPhone(body.text("phone", false, 20));
        update.setEmail(body.text("email", false, 128));
        update.setLogo(body.text("logo", false, 512));
        update.setRemark(body.text("remark", false, 512));
        update.setIpWhitelist(toWhitelistPatch(body, current));

        if (update.getUsername().isPresent()) {
            requireUniqueUsername(update.getUsername().getValue(), id);
        }
        if (update.getPhone().isPresent()) {
            requireUniquePhone(update.getPhone().getValue(), id);
        }
        if (update.getEmail().isPresent()) {
            requireUniqueEmail(update.getEmail().getValue(), id);
        }
        // 平台公约：提交内容与当前值完全相同时不写入、不递增版本。
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(hasEffectiveChange(update, current));
        applyUpdate(update);
        return toDetail(require(id));
    }

    /**
     * 物理删除账号；有引用时不删除任何数据并返回 40903。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901，有引用返回 40903
     */
    @Transactional
    public void delete(long id, long version) {
        Account current = require(id);
        if (current.superAdmin()) {
            throw BusinessException.referenced(List.of(new ReferenceItem("builtinSuperAdmin", null,
                    "内置超级管理员不可删除")));
        }
        List<ReferenceItem> references = describeReferences(id);
        if (!references.isEmpty()) {
            throw BusinessException.referenced(references);
        }
        int rows = accountMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 冻结账号；保留令牌摘要但鉴权拒绝。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @return 冻结后的账号
     */
    @Transactional
    public Detail freeze(long id, long version) {
        return changeStatus(id, version, "frozen");
    }

    /**
     * 解冻账号；未到期未撤销的令牌恢复可用，已过期或已撤销的不会恢复。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @return 解冻后的账号
     */
    @Transactional
    public Detail unfreeze(long id, long version) {
        return changeStatus(id, version, "normal");
    }

    /**
     * 随机重置目标账号密码：口令更新、强制改密标记与全部旧令牌撤销原子完成。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @return 只包含本次初始密码的响应
     * @throws BusinessException 服务账号或版本冲突时拒绝
     */
    @Transactional
    public PasswordResetResponse resetPassword(long id, long version) {
        Account current = require(id);
        if (!current.person()) {
            throw BusinessException.invalidField("accountId", "服务账号不使用密码流程");
        }
        String initialPassword = passwordService.generateRandom();
        AccountUpdate update = new AccountUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUpdatedBy(AuthContext.operatorId());
        update.setPassword(PatchValue.of(passwordService.encode(initialPassword)));
        update.setMustChangePassword(com.qs.authority.common.web.PatchValue.of(Boolean.TRUE));
        applyUpdate(update);
        tokenService.revokeAccount(id);
        return new PasswordResetResponse(Ids.of(id), initialPassword, true);
    }

    /**
     * 读取账号，不存在时返回 40401。
     *
     * @param id 账号标识
     * @return 账号记录
     */
    public Account require(long id) {
        Account account = accountMapper.findById(id);
        if (account == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return account;
    }

    private Detail changeStatus(long id, long version, String status) {
        AccountUpdate update = new AccountUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUpdatedBy(AuthContext.operatorId());
        update.setStatus(PatchValue.of(status));
        require(id);
        applyUpdate(update);
        return toDetail(require(id));
    }

    private boolean hasEffectiveChange(AccountUpdate update, Account current) {
        return changed(update.getUsername(), current.getUsername())
                || changed(update.getPhone(), current.getPhone())
                || changed(update.getEmail(), current.getEmail())
                || changed(update.getLogo(), current.getLogo())
                || changed(update.getRemark(), current.getRemark())
                || whitelistChanged(update.getIpWhitelist(), current.getIpWhitelist());
    }

    private static boolean changed(PatchValue<String> submitted, String current) {
        return submitted != null && submitted.isPresent() && EffectiveChanges.differs(submitted.getValue(), current);
    }

    /**
     * 白名单是地址字符串集合：按元素比较，顺序不同不算变更。
     *
     * @param submitted 提交的白名单 JSON 文本
     * @param current 当前的白名单 JSON 文本
     * @return 元素集合不同时为 true
     */
    private static boolean whitelistChanged(PatchValue<String> submitted, String current) {
        if (submitted == null || !submitted.isPresent()) {
            return false;
        }
        return EffectiveChanges.textSetDiffers(Json.stringList(submitted.getValue()), Json.stringList(current));
    }

    private void applyUpdate(AccountUpdate update) {
        int rows = accountMapper.update(update);
        if (rows == 0) {
            require(update.getId());
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    private PatchValue<String> toWhitelistPatch(PatchBody body, Account current) {
        PatchValue<PatchBody.StringArray> patch = body.stringArray("ipWhitelist", false, true, 64);
        if (!patch.isPresent()) {
            return PatchValue.absent();
        }
        if (patch.getValue() == null) {
            if (!current.person()) {
                throw BusinessException.invalidField("ipWhitelist", "服务账号必须配置 IP 白名单");
            }
            return PatchValue.of(null);
        }
        validateWhitelist(patch.getValue().values());
        if (!current.person() && patch.getValue().values().isEmpty()) {
            throw BusinessException.invalidField("ipWhitelist", "服务账号必须配置 IP 白名单");
        }
        return PatchValue.of(patch.getValue().json());
    }

    private List<String> validateWhitelist(List<String> values) {
        if (values == null) {
            return List.of();
        }
        for (String value : values) {
            if (!IpRules.isAddressOrCidr(value)) {
                throw BusinessException.invalidField("ipWhitelist", "白名单元素必须是 IP 地址或网段");
            }
        }
        return values.stream().map(String::trim).toList();
    }

    private List<ReferenceItem> describeReferences(long accountId) {
        List<ReferenceItem> references = new ArrayList<>();
        long organizations = accountMapper.countOrganizationLinks(accountId);
        if (organizations > 0) {
            references.add(new ReferenceItem("accountOrganization", null,
                    "存在 " + organizations + " 条账号与组织关联"));
        }
        long userGroups = accountMapper.countUserGroupLinks(accountId);
        if (userGroups > 0) {
            references.add(new ReferenceItem("userGroupMember", null, "存在 " + userGroups + " 条用户组成员关系"));
        }
        long permissionGroups = accountMapper.countPermissionGroupLinks(accountId);
        if (permissionGroups > 0) {
            references.add(new ReferenceItem("permissionGroupAccount", null,
                    "存在 " + permissionGroups + " 条用户权限组关联"));
        }
        long tokens = accountMapper.countTokens(accountId);
        if (tokens > 0) {
            references.add(new ReferenceItem("token", null, "存在 " + tokens + " 条登录令牌摘要"));
        }
        return references;
    }

    private void requireUniqueUsername(String username, Long excludeId) {
        if (accountMapper.countByUsername(username, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "用户名已存在");
        }
    }

    private void requireUniquePhone(String phone, Long excludeId) {
        if (phone != null && accountMapper.countByPhone(phone, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "手机号已存在");
        }
    }

    private void requireUniqueEmail(String email, Long excludeId) {
        if (email != null && accountMapper.countByEmail(email, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "邮箱已存在");
        }
    }

    private static String normalizeEnum(String field, String value, Set<String> allowed, String fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        String trimmed = value.trim();
        if (!allowed.contains(trimmed)) {
            throw BusinessException.invalidField(field, "不支持的取值");
        }
        return trimmed;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 转换为响应模型；不包含密码散列等秘密。
     *
     * @param account 账号记录
     * @return 账号响应字段
     */
    public static Detail toDetail(Account account) {
        return new Detail(Ids.of(account.getId()), account.getUuid(),
                account.getUsername(), account.getPhone(), account.getEmail(), account.getLogo(), account.getRemark(),
                account.getAccountType(), account.getStatus(), Json.stringList(account.getIpWhitelist()),
                BeijingTime.format(account.getLastLoginAt()), BeijingTime.format(account.getCreatedAt()),
                BeijingTime.format(account.getUpdatedAt()), Ids.of(account.getCreatedBy()),
                Ids.of(account.getUpdatedBy()), Ids.of(account.getVersion()),
                Boolean.TRUE.equals(account.getMustChangePassword()), account.superAdmin());
    }
}
