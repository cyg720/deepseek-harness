package com.qs.authority.modules.parameter;

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
import com.qs.authority.modules.parameter.ParameterDtos.CreateRequest;
import com.qs.authority.modules.parameter.ParameterDtos.Detail;
import com.qs.authority.security.AuthContext;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 参数服务：授权中心自身参数的增改删查。
 *
 * <p>参数值以数据库 {@code TEXT} 列保存，可为文字或数值，去首尾空白后为空即拒绝；参数编码在
 * 单企业内唯一。服务不缓存参数，每次读取都直接查询数据库，因此保存成功后立即生效，消费方
 * 不需要重启或刷新。
 *
 * <p>参数值与参数编码全部经 MyBatis {@code #{}} 绑定为查询/写入参数，任何输入都不拼接到 SQL
 * 文本；排序字段只按 {@link #sortColumns()} 白名单映射为固定列名，未列入白名单的取值返回 40001，
 * 因此注入串既不能成为 SQL 片段，也不能成为列名。
 */
@Service
public class ParameterService {

    /** 参数列表允许的查询参数。 */
    public static final Set<String> LIST_PARAMS = Set.of("page", "pageSize", "sortBy", "sortOrder", "paramCode");

    /** 参数值上限；数据库为 TEXT 列，接口按此上限约束请求体大小。 */
    public static final int PARAM_VALUE_MAX_LENGTH = 65535;

    /** 参数 PATCH 允许写入的字段。 */
    private static final Set<String> PATCH_FIELDS = Set.of("version", "paramCode", "paramValue", "description");

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "id", "id",
            "paramCode", "param_code",
            "createdAt", "created_at",
            "updatedAt", "updated_at");

    private final ParameterMapper parameterMapper;

    /**
     * 构造参数服务。
     *
     * @param parameterMapper 参数持久层
     */
    public ParameterService(ParameterMapper parameterMapper) {
        this.parameterMapper = parameterMapper;
    }

    /**
     * 参数列表公布的排序字段。
     *
     * @return 排序字段到数据库列的映射
     */
    public static Map<String, String> sortColumns() {
        return SORT_COLUMNS;
    }

    /**
     * 新增参数。
     *
     * @param request 新增请求
     * @return 新增后的参数
     * @throws BusinessException 参数编码重复返回 40902，字段不合法返回 40001
     */
    @Transactional
    public Detail create(CreateRequest request) {
        String paramCode = request.paramCode().trim();
        requireUniqueCode(paramCode, null);

        SysParameter parameter = new SysParameter();
        parameter.setParamCode(paramCode);
        parameter.setParamValue(request.paramValue());
        parameter.setDescription(blankToNull(request.description()));
        parameter.setCreatedBy(AuthContext.operatorId());
        parameter.setUpdatedBy(AuthContext.operatorId());
        parameterMapper.insert(parameter);
        return toDetail(parameterMapper.findById(parameter.getId()));
    }

    /**
     * 参数详情。
     *
     * @param id 参数标识
     * @return 参数详情
     * @throws BusinessException 目标不存在返回 40401
     */
    public Detail detail(long id) {
        return toDetail(require(id));
    }

    /**
     * 分页查询参数。
     *
     * @param query 分页与排序参数
     * @param paramCode 参数编码精确筛选，可为 null
     * @return 分页结果
     */
    public Paged<Detail> list(PageQuery query, String paramCode) {
        String filter = blankToNull(paramCode);
        List<SysParameter> rows = parameterMapper.list(filter, query.orderBy(), query.pageSize(), query.offset());
        long total = parameterMapper.count(filter);
        return new Paged<>(rows.stream().map(ParameterService::toDetail).toList(), query.page(), query.pageSize(),
                total);
    }

    /**
     * 编辑参数。
     *
     * <p>提交的字段与当前值完全相同视为没有有效变更，返回 40001 且不落库，版本保持不变。
     *
     * @param id 参数标识
     * @param body PATCH 请求体
     * @return 编辑后的参数
     * @throws BusinessException 未知字段、没有有效变更返回 40001，目标不存在返回 40401，版本冲突返回 40901，
     *         参数编码重复返回 40902
     */
    @Transactional
    public Detail update(long id, PatchBody body) {
        body.rejectUnknown(PATCH_FIELDS);
        long version = body.requireVersion();
        if (!body.hasBusinessField()) {
            throw BusinessException.invalidField("version", "请至少提交一个可修改字段");
        }
        SysParameter current = require(id);

        PatchValue<String> paramCode = body.text("paramCode", true, 64);
        if (paramCode.isPresent()) {
            paramCode = PatchValue.of(paramCode.getValue().trim());
            requireUniqueCode(paramCode.getValue(), id);
        }
        PatchValue<String> paramValue = body.text("paramValue", true, PARAM_VALUE_MAX_LENGTH);
        PatchValue<String> description = body.text("description", false, 512);

        // 平台公约：版本不一致优先返回 40901，其次才判定有效变更。
        VersionCheck.requireMatch(current.getVersion(), version);
        EffectiveChanges.requireAny(isChanged(paramCode, current.getParamCode())
                || isChanged(paramValue, current.getParamValue())
                || isChanged(description, current.getDescription()));
        int rows = parameterMapper.update(id, version, paramCode, paramValue, description, AuthContext.operatorId());
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
        return detail(id);
    }

    /**
     * 物理删除参数；参数没有引用表，删除不需要引用校验。
     *
     * @param id 参数标识
     * @param version 读取时版本
     * @throws BusinessException 目标不存在或重复删除返回 40401，版本冲突返回 40901
     */
    @Transactional
    public void delete(long id, long version) {
        require(id);
        int rows = parameterMapper.delete(id, version);
        if (rows == 0) {
            require(id);
            throw BusinessException.of(ErrorCode.VERSION_CONFLICT);
        }
    }

    /**
     * 读取参数，不存在时返回 40401。
     *
     * @param id 参数标识
     * @return 参数记录
     * @throws BusinessException 目标不存在返回 40401
     */
    private SysParameter require(long id) {
        SysParameter parameter = parameterMapper.findById(id);
        if (parameter == null) {
            throw BusinessException.of(ErrorCode.NOT_FOUND);
        }
        return parameter;
    }

    private void requireUniqueCode(String paramCode, Long excludeId) {
        if (parameterMapper.countByCode(paramCode, excludeId) > 0) {
            throw BusinessException.of(ErrorCode.DUPLICATE, "参数编码已存在");
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
     * @param parameter 参数记录
     * @return 参数响应字段
     */
    public static Detail toDetail(SysParameter parameter) {
        return new Detail(Ids.of(parameter.getId()), parameter.getParamCode(), parameter.getParamValue(),
                parameter.getDescription(), BeijingTime.format(parameter.getCreatedAt()),
                BeijingTime.format(parameter.getUpdatedAt()), Ids.of(parameter.getCreatedBy()),
                Ids.of(parameter.getUpdatedBy()), Ids.of(parameter.getVersion()));
    }
}
