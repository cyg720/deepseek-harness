package com.qs.authority.modules.operation;

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
import com.qs.authority.modules.appauthorization.AppAuthorizationMapper;
import com.qs.authority.modules.operation.OperationDtos.CreateRequest;
import com.qs.authority.modules.operation.OperationDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 操作服务：应用功能操作的上报登记与改名。
 *
 * <p>操作必须挂在一条已存在的应用授权记录下，完整操作码全平台唯一并必须以所属应用编码加英文
 * 句点开头。这里只校验前缀与全局唯一，不校验“恰好三段”这类组成细节：分隔符、转义与长度仍是
 * 未决项 Q-18，点号示例不代表已确认格式。改名与改完整码都只更新原记录，稳定 id 不变，引用该
 * 操作的权限组集合无需重写，因此既有授权关系在改名后继续有效。本模块不提供删除接口：操作被
 * 权限组引用后删除会静默改变他人权限，删除语义留给后续确认。
 *
 * <p>操作码、应用编码等输入全部经 MyBatis {@code #{}} 绑定；排序字段只按 {@link #sortColumns()}
 * 白名单映射为固定列名，未列入白名单的取值返回 40001。
 */
@Service
public class OperationService {

    /** 操作列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "appCode",
            "operationCode");

    /** 操作 PATCH 允许写入的字段；app_code 是操作的归属，不可通过编辑接口变更。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "operationCode", "operationName",
            "operationDesc", "resourceType");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "appCode", "app_code",
            "operationCode", "operation_code",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final OperationMapper operationMapper;
    private final AppAuthorizationMapper appAuthorizationMapper;

    /**
     * 构造操作服务。
     *
     * @param operationMapper 操作持久层
     * @param appAuthorizationMapper 应用授权持久层，用于校验应用编码已存在
     */
    public OperationService(OperationMapper operationMapper, AppAuthorizationMapper appAuthorizationMapper) {
        this.operationMapper = operationMapper;
        this.appAuthorizationMapper = appAuthorizationMapper;
    }

    /**
     * 操作列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 登记操作。
     *
     * @param request 登记请求
     * @return 登记后的操作
     * @throws BusinessException 应用编码无授权记录、操作码前缀不符或字段不合法返回 40001，
     *         完整操作码重复返回 40902
     */
    @Transactional
    public Detail create(CreateRequest request) {
        String appCode = request.appCode().trim();
        requireAuthorizedApp(appCode);
        String operationCode = request.operationCode().trim();
        requirePrefix(operationCode, appCode);
        requireUniqueCode(operationCode, null);

        OperationRecord record = new OperationRecord();
        record.setAppCode(appCode);
        record.setOperationCode(operationCode);
        record.setOperationName(request.operationName());
        record.setOperationDesc(blankToNull(request.operationDesc()));
        record.setResourceType(blankToNull(request.resourceType()));
        record.setCreatedBy(AuthContext.operatorId());
        record.setUpdatedBy(AuthContext.operatorId());
        operationMapper.insert(record);
        return toDetail(operationMapper.findById(record.getId()));
    }

    /**
     * 操作详情。
     *
     * @param id 操作标识
     * @return 操作详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询操作。
     *
     * @param query 分页与排序参数
     * @param appCode 应用编码精确筛选，可为 null
     * @param operationCode 完整操作码精确筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String appCode, String operationCode) {
        String appFilter = blankToNull(appCode);
        String codeFilter = blankToNull(operationCode);
        List<OperationRecord> rows = operationMapper.list(appFilter, codeFilter, query.orderBy(), query.pageSize(),
                query.offset());
        long total = operationMapper.count(appFilter, codeFilter);
        return new Paged<>(rows.stream().map(OperationService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑操作：改名或改完整码，保留稳定 id，已有权限组引用不变。
     *
     * <p>提交的字段与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 操作标识
     * @param body PATCH 请求体
     * @return 编辑后的操作
     * @throws BusinessException 未知字段、操作码前缀不符、字段不合法或没有有效变更返回 40001，目标不存在返回 40401，
     *         版本冲突返回 40901，完整操作码重复返回 40902
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        OperationRecord current = require(id);

        PatchValue<String> operationCode = body.text("operationCode", true, 128);
        if (operationCode.isPresent()) {
            String code = operationCode.getValue().trim();
            requirePrefix(code, current.getAppCode());
            requireUniqueCode(code, id);
            operationCode = PatchValue.of(code);
        }
        PatchValue<String> operationName = body.text("operationName", true, 128);
        PatchValue<String> operationDesc = body.text("operationDesc", false, 512);
        PatchValue<String> resourceType = body.text("resourceType", false, 64);

        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(operationCode, current.getOperationCode())
                || isChanged(operationName, current.getOperationName())
                || isChanged(operationDesc, current.getOperationDesc())
                || isChanged(resourceType, current.getResourceType()));
        int rows = operationMapper.update(id, version, operationCode, operationName, operationDesc, resourceType,
                AuthContext.operatorId());
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return detail(id);
    }

    /**
     * 读取操作，不存在时返回 40401。
     *
     * @param id 操作标识
     * @return 操作记录
     * @throws BusinessException 目标不存在返回 40401
     */
    private OperationRecord require(long id) {
        OperationRecord record = operationMapper.findById(id);
        if (record == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return record;
    }

    private void requireAuthorizedApp(String appCode) {
        if (appAuthorizationMapper.findByAppCode(appCode) == null) {
            throw BusinessException.invalidField("appCode", "应用编码没有授权记录，请先由应用中心建立授权记录");
        }
    }

    private static void requirePrefix(String operationCode, String appCode) {
        if (!operationCode.startsWith(appCode + ".")) {
            throw BusinessException.invalidField("operationCode", "操作码必须以所属应用编码加英文句点开头");
        }
    }

    private void requireUniqueCode(String operationCode, Long excludeId) {
        OperationRecord existing = operationMapper.findByCode(operationCode);
        if (existing != null && (excludeId == null || !excludeId.equals(existing.getId()))) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "完整操作码已存在");
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
     * @param record 操作记录
     * @return 操作响应字段
     */
    public static Detail toDetail(OperationRecord record) {
        return new Detail(Ids.of(record.getId()), record.getAppCode(), record.getOperationCode(),
                record.getOperationName(), record.getOperationDesc(), record.getResourceType(),
                BeijingTime.format(record.getCreatedAt()), BeijingTime.format(record.getUpdatedAt()),
                Ids.of(record.getCreatedBy()), Ids.of(record.getUpdatedBy()), Ids.of(record.getVersion()));
    }
}
