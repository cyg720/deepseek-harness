package com.qs.authority.modules.usergroup;

import com.qs.authority.common.api.ApiResponse.Paged;
import com.qs.authority.common.error.BusinessException;
import com.qs.authority.common.error.ErrorCode;
import com.qs.authority.common.error.ErrorData.ReferenceItem;
import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.support.Ids;
import com.qs.authority.common.web.EffectiveChanges;
import com.qs.authority.common.web.PageQuery;
import com.qs.authority.common.web.PatchBody;
import com.qs.authority.common.web.PatchValue;
import com.qs.authority.common.web.VersionCheck;
import com.qs.authority.modules.usergroup.UserGroupDtos.CreateRequest;
import com.qs.authority.modules.usergroup.UserGroupDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 用户组服务：用户组增改删查。
 *
 * <p>用户组只维护跨部门人员集合，不授予权限：组的成员身份既不带权限组，也不带任何操作权限；
 * 删除用户组不连带删除账号，有成员时不删除任何数据并返回 40903。
 */
@Service
public class UserGroupService {

    /** 用户组列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "groupCode");

    /** 用户组 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "groupCode", "groupName", "description");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "groupCode", "group_code",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final UserGroupMapper userGroupMapper;

    /**
     * 构造用户组服务。
     *
     * @param userGroupMapper 用户组持久层
     */
    public UserGroupService(UserGroupMapper userGroupMapper) {
        this.userGroupMapper = userGroupMapper;
    }

    /**
     * 用户组列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增用户组。
     *
     * @param request 新增请求
     * @return 新增后的用户组
     * @throws BusinessException 用户组编码重复返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        String groupCode = request.groupCode().trim();
        requireUniqueGroupCode(groupCode, null);
        UserGroup group = new UserGroup();
        group.setGroupCode(groupCode);
        group.setGroupName(request.groupName().trim());
        group.setDescription(blankToNull(request.description()));
        group.setCreatedBy(AuthContext.operatorId());
        group.setUpdatedBy(AuthContext.operatorId());
        userGroupMapper.insert(group);
        return toDetail(require(group.getId()));
    }

    /**
     * 用户组详情。
     *
     * @param id 用户组标识
     * @return 用户组详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询用户组。
     *
     * @param query 分页与排序参数
     * @param groupCode 用户组编码精确筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String groupCode) {
        String normalizedCode = blankToNull(groupCode);
        List<UserGroup> rows = userGroupMapper.list(normalizedCode, query.orderBy(), query.pageSize(),
                query.offset());
        long total = userGroupMapper.count(normalizedCode);
        return new Paged<>(rows.stream().map(UserGroupService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑用户组。
     *
     * <p>提交的字段与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 用户组标识
     * @param body PATCH 请求体
     * @return 编辑后的用户组
     * @throws BusinessException 未知字段、没有有效变更返回 40001，用户组编码重复返回 40902，版本冲突返回 40901
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        UserGroup current = require(id);
        UserGroupUpdate update = new UserGroupUpdate();
        update.setId(id);
        update.setVersion(version);
        update.setUpdatedBy(AuthContext.operatorId());
        update.setGroupCode(body.text("groupCode", true, 64));
        update.setGroupName(body.text("groupName", true, 128));
        update.setDescription(body.text("description", false, 512));

        if (update.getGroupCode().isPresent()) {
            requireUniqueGroupCode(update.getGroupCode().getValue(), id);
        }
        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(update.getGroupCode(), current.getGroupCode())
                || isChanged(update.getGroupName(), current.getGroupName())
                || isChanged(update.getDescription(), current.getDescription()));
        applyUpdate(update);
        return toDetail(require(id));
    }

    /**
     * 物理删除用户组；仍有成员时不删除任何数据并返回 40903。
     *
     * @param id 用户组标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在返回 40401，版本冲突返回 40901，有成员返回 40903
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        long members = userGroupMapper.countMembers(id);
        if (members > 0) {
            throw BusinessException.referenced(List.of(new ReferenceItem("userGroupMember", null,
                    "存在 " + members + " 条用户组成员关系")));
        }
        int rows = userGroupMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取用户组，不存在时返回 40401。
     *
     * @param id 用户组标识
     * @return 用户组记录
     * @throws BusinessException 目标不存在返回 40401
     */
    public UserGroup require(long id) {
        UserGroup group = userGroupMapper.findById(id);
        if (group == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return group;
    }

    private void applyUpdate(UserGroupUpdate update) {
        int rows = userGroupMapper.update(update);
        if (rows == 0) {
            require(update.getId());
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    private void requireUniqueGroupCode(String groupCode, Long excludeId) {
        if (userGroupMapper.countByGroupCode(groupCode, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "用户组编码已存在");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 提交的字段与当前值是否不同；未提交的字段不参与比较。
     *
     * <p>三态语义下显式 null 与当前非 null 属于变更。
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
     * @param group 用户组记录
     * @return 用户组响应字段
     */
    public static Detail toDetail(UserGroup group) {
        return new Detail(Ids.of(group.getId()), group.getGroupCode(), group.getGroupName(), group.getDescription(),
                BeijingTime.format(group.getCreatedAt()), BeijingTime.format(group.getUpdatedAt()),
                Ids.of(group.getCreatedBy()), Ids.of(group.getUpdatedBy()), Ids.of(group.getVersion()));
    }
}
