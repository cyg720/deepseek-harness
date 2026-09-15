package com.qs.authority.modules.appauthorization;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.QueryParams;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.CreateRequest;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.CreateResponse;
import com.qs.authority.modules.appauthorization.AppAuthorizationDtos.Detail;
import com.qs.authority.modules.permissiongroup.PermissionGroup;
import com.qs.authority.modules.permissiongroup.PermissionGroupMapper;
import com.qs.authority.security.AuthContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 应用授权服务：建立授权记录、配置可见权限组、受控同步应用状态。
 *
 * <p>应用编码唯一，重复注册返回 40902 且不改动原 AppKey。一个应用可关联多个可见权限组，命中
 * 任一组即可见；功能权限仍按用户实际取得组内的操作判断。授权中心不提供应用注册、冻结或下线的
 * 管理入口，状态只接受应用中心受控同步；下线或冻结只影响该应用的鉴权，不删除记录与关联。
 */
@Service
public class ApplicationAuthorizationService {

    /** 应用授权列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "appCode",
            "status");

    /** 配置可见权限组时允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "permissionGroupIds");

    private static final Set<String> STATUSES = Set.of("active", "frozen", "offline");

    /**
     * 6.1 状态机允许的状态迁移；同态重放允许，因为应用中心冲突后会重发当前期望状态。
     */
    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
            "active", Set.of("active", "frozen", "offline"),
            "frozen", Set.of("frozen", "active", "offline"),
            "offline", Set.of("offline", "active"));
    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "appCode", "app_code",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private static final String KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private final AppAuthorizationMapper appAuthorizationMapper;
    private final PermissionGroupMapper permissionGroupMapper;
    private final SecureRandom random = new SecureRandom();

    /**
     * 构造应用授权服务。
     *
     * @param appAuthorizationMapper 应用授权持久层
     * @param permissionGroupMapper 权限组持久层
     */
    public ApplicationAuthorizationService(AppAuthorizationMapper appAuthorizationMapper,
            PermissionGroupMapper permissionGroupMapper) {
        this.appAuthorizationMapper = appAuthorizationMapper;
        this.permissionGroupMapper = permissionGroupMapper;
    }

    /**
     * 应用授权列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 建立授权记录并返回应用凭据。
     *
     * @param request 建立请求
     * @return 含 AppKey 与一次性 AppSecret 的响应
     * @throws BusinessException 应用编码重复返回 40902
     */
    @Transactional
    public CreateResponse create(CreateRequest request) {
        String appCode = request.appCode().trim();
        if (appAuthorizationMapper.findByAppCode(appCode) != null) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "应用编码已存在，不能重复注册");
        }
        String appKey = "ak_" + randomToken(32);
        String appSecret = "sk_" + randomToken(48);

        AppAuthorization authorization = new AppAuthorization();
        authorization.setAppCode(appCode);
        authorization.setAppKey(appKey);
        // 只保存摘要：凭据明文仅在本次响应返回，之后无法从数据库还原。
        authorization.setAppSecret(digest(appSecret));
        authorization.setStatus("active");
        authorization.setSecretExpireAt(request.appSecretExpireAt() == null || request.appSecretExpireAt().isBlank()
                ? null
                : BeijingTime.parse(request.appSecretExpireAt(), "appSecretExpireAt"));
        authorization.setCreatedBy(AuthContext.operatorId());
        authorization.setUpdatedBy(AuthContext.operatorId());
        appAuthorizationMapper.insert(authorization);
        AppAuthorization stored = require(authorization.getId());
        return new CreateResponse(Ids.of(stored.getId()), stored.getAppCode(), stored.getAppKey(), appSecret,
                stored.getStatus(), Ids.of(stored.getVersion()));
    }

    /**
     * 配置应用可见权限组，整体替换集合。
     *
     * @param id 授权记录标识
     * @param body PATCH 请求体
     * @return 配置后的授权详情
     * @throws BusinessException 未知字段或权限组非法返回 40001，版本冲突返回 40901，目标不存在返回 40401
     */
    @Transactional
    public Detail configure(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        AppAuthorization current = require(id);
        var groupIds = body.idArray("permissionGroupIds", false, true);
        if (!groupIds.isPresent() || groupIds.getValue() == null) {
            throw BusinessException.invalidField("permissionGroupIds", "请提交可见权限组数组，空数组表示清空");
        }
        List<PermissionGroup> groups = groupIds.getValue().ids().isEmpty()
                ? List.of()
                : permissionGroupMapper.listByIds(groupIds.getValue().ids());
        if (groups.size() != groupIds.getValue().ids().size()) {
            throw BusinessException.invalidField("permissionGroupIds", "存在未登记的权限组");
        }
        // 集合按元素比较：顺序不同不算变更，没有变化时不推进版本。
        List<Long> currentGroupIds = appAuthorizationMapper.listPermissionGroupIds(id);
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(EffectiveChanges.idSetDiffers(groupIds.getValue().ids(), currentGroupIds));
        if (appAuthorizationMapper.touch(id, version, AuthContext.operatorId()) == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        appAuthorizationMapper.deletePermissionGroups(id);
        if (!groups.isEmpty()) {
            appAuthorizationMapper.replacePermissionGroups(id, groupIds.getValue().ids(), AuthContext.operatorId());
        }
        return toDetail(require(id));
    }

    /**
     * 应用中心受控同步应用状态。
     *
     * @param id 授权记录标识
     * @param status 目标状态
     * @param version 应用中心读取到的版本
     * @return 同步后的授权详情
     * @throws BusinessException 状态非法返回 40001，版本冲突返回 40901，目标不存在返回 40401
     */
    @Transactional
    public Detail stateSync(long id, String status, long version) {
        String target = status == null ? null : status.trim();
        if (target == null || !STATUSES.contains(target)) {
            throw BusinessException.invalidField("status", "请输入 active、frozen 或 offline");
        }
        AppAuthorization current = require(id);
        if (!ALLOWED_TRANSITIONS.getOrDefault(current.getStatus(), Set.of()).contains(target)) {
            throw BusinessException.of(ErrorCode.STATE_CONFLICT,
                    "不允许从 " + current.getStatus() + " 同步为 " + target);
        }
        if (appAuthorizationMapper.updateStatus(id, version, target, AuthContext.operatorId()) == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return toDetail(require(id));
    }

    /**
     * 授权详情。
     *
     * @param id 授权记录标识
     * @return 授权详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询授权记录。
     *
     * @param query 分页与排序参数
     * @param appCode 应用编码筛选，可为 null
     * @param status 状态筛选，可为 null
     * @return 分页结果
     */
    public Paged<AppAuthorizationDtos.ListItem> list(PageQuery query, String appCode, String status) {
        String normalizedStatus = QueryParams.enumValue("status", status, STATUSES);
        List<AppAuthorization> rows = appAuthorizationMapper.list(blankToNull(appCode), normalizedStatus,
                query.orderBy(), query.pageSize(), query.offset());
        long total = appAuthorizationMapper.count(blankToNull(appCode), normalizedStatus);
        return new Paged<>(rows.stream().map(this::toListItem).toList(), query.page(), query.pageSize(), total);
    }

    private AppAuthorizationDtos.ListItem toListItem(AppAuthorization authorization) {
        return new AppAuthorizationDtos.ListItem(Ids.of(authorization.getId()), authorization.getAppCode(),
                authorization.getStatus(), BeijingTime.format(authorization.getSecretExpireAt()),
                visibleGroupIds(authorization.getId()), BeijingTime.format(authorization.getCreatedAt()),
                BeijingTime.format(authorization.getUpdatedAt()), Ids.of(authorization.getCreatedBy()),
                Ids.of(authorization.getUpdatedBy()), Ids.of(authorization.getVersion()));
    }

    /**
     * 读取授权记录。
     *
     * @param id 授权记录标识
     * @return 授权记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public AppAuthorization require(long id) {
        AppAuthorization authorization = appAuthorizationMapper.findById(id);
        if (authorization == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return authorization;
    }

    private Detail toDetail(AppAuthorization authorization) {
        return new Detail(Ids.of(authorization.getId()), authorization.getAppCode(), authorization.getStatus(),
                BeijingTime.format(authorization.getSecretExpireAt()), visibleGroupIds(authorization.getId()),
                BeijingTime.format(authorization.getCreatedAt()), BeijingTime.format(authorization.getUpdatedAt()),
                Ids.of(authorization.getCreatedBy()), Ids.of(authorization.getUpdatedBy()),
                Ids.of(authorization.getVersion()));
    }

    private List<String> visibleGroupIds(long appAuthorizationId) {
        return appAuthorizationMapper.listPermissionGroupIds(appAuthorizationId).stream().map(Ids::of).toList();
    }

    private String randomToken(int length) {
        StringBuilder builder = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            builder.append(KEY_ALPHABET.charAt(random.nextInt(KEY_ALPHABET.length())));
        }
        return builder.toString();
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
        return value == null || value.isBlank() ? null : value.trim();
    }
}
