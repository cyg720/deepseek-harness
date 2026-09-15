package com.qs.authority.modules.audit;

import com.qs.authority.common.support.BeijingTime;
import com.qs.authority.common.trace.TraceContext;
import com.qs.authority.config.AuthorityProperties;
import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 审计服务：追加自身事件、按保留期物理清理。
 *
 * <p>日志只追加，普通接口不能写入或删除。每个字段在写入前按数据库列长度截断，因此超长请求头等
 * 输入不会造成审计写失败。
 *
 * <p>写失败的语义分两类：授权判定在返回许可前于同一事务内写入审计，写失败即回滚且不返回许可；
 * 其余请求的业务已经提交，审计失败只记录错误日志并保留真实响应，不改判为失败，避免客户端按
 * “失败”重试已经生效的写入。
 */
@Service
public class AuditService {

    private static final Logger LOG = LoggerFactory.getLogger(AuditService.class);

    /** 审计列长度，与建表脚本一致；截断按列进行，避免超长输入造成写入失败。 */
    private static final int APP_CODE_LENGTH = 64;
    private static final int OPERATION_CODE_LENGTH = 128;
    private static final int RESOURCE_ID_LENGTH = 128;
    private static final int RESOURCE_TYPE_LENGTH = 64;
    private static final int REQUEST_IP_LENGTH = 64;
    private static final int USER_AGENT_LENGTH = 512;
    private static final int LOG_LEVEL_LENGTH = 16;
    private static final int RESULT_LENGTH = 16;

    private final AuditLogMapper auditLogMapper;
    private final AuditMasker masker;
    private final AuthorityProperties properties;

    /**
     * 构造审计服务。
     *
     * @param auditLogMapper 审计持久层
     * @param masker 脱敏器
     * @param properties 部署配置
     */
    public AuditService(AuditLogMapper auditLogMapper, AuditMasker masker, AuthorityProperties properties) {
        this.auditLogMapper = auditLogMapper;
        this.masker = masker;
        this.properties = properties;
    }

    /**
     * 追加一条审计事件。
     *
     * @param log 日志记录；traceId、脱敏与截断在此补齐
     * @throws com.qs.authority.common.error.BusinessException 审计写失败且配置为阻断时抛出 50001
     */
    public void record(AuditLog log) {
        if (log.getTraceId() == null) {
            log.setTraceId(TraceContext.current());
        }
        log.setAppCode(masker.truncate(log.getAppCode(), APP_CODE_LENGTH));
        log.setOperationCode(masker.truncate(log.getOperationCode(), OPERATION_CODE_LENGTH));
        log.setResourceId(masker.truncate(log.getResourceId(), RESOURCE_ID_LENGTH));
        log.setResourceType(masker.truncate(log.getResourceType(), RESOURCE_TYPE_LENGTH));
        log.setRequestIp(masker.truncate(log.getRequestIp(), REQUEST_IP_LENGTH));
        log.setUserAgent(masker.truncate(log.getUserAgent(), USER_AGENT_LENGTH));
        log.setReason(masker.truncateReason(log.getReason()));
        log.setLogLevel(masker.truncate(log.getLogLevel(), LOG_LEVEL_LENGTH));
        log.setResult(masker.truncate(log.getResult(), RESULT_LENGTH));
        log.setRequestBody(masker.mask(log.getRequestBody()));
        log.setResponseBody(masker.mask(log.getResponseBody()));
        auditLogMapper.insert(log);
    }

    /**
     * 物理删除超过保留期的日志。
     *
     * @return 删除行数
     */
    public long cleanup() {
        LocalDateTime cutoff = BeijingTime.now().minusDays(properties.audit().retentionDays());
        int deleted = auditLogMapper.deleteOlderThan(cutoff);
        LOG.info("审计日志清理完成 cutoff={} deleted={}", cutoff, deleted);
        return deleted;
    }

    /**
     * 审计保留期截点。
     *
     * @return 当前北京时间减保留天数
     */
    public LocalDateTime retentionCutoff() {
        return BeijingTime.now().minusDays(properties.audit().retentionDays());
    }

    /**
     * 分页查询日志。
     *
     * @param accountId 账号筛选，可为 null
     * @param appCode 应用筛选，可为 null
     * @param result 结果筛选，可为 null
     * @param createdAtFrom 起始时间，可为 null
     * @param createdAtTo 结束时间，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 日志列表
     */
    public java.util.List<AuditLog> list(Long accountId, String appCode, String result, LocalDateTime createdAtFrom,
            LocalDateTime createdAtTo, String orderBy, int limit, long offset) {
        return auditLogMapper.list(accountId, appCode, result, createdAtFrom, createdAtTo, orderBy, limit, offset);
    }

    /**
     * 统计符合条件的日志总数。
     *
     * @param accountId 账号筛选，可为 null
     * @param appCode 应用筛选，可为 null
     * @param result 结果筛选，可为 null
     * @param createdAtFrom 起始时间，可为 null
     * @param createdAtTo 结束时间，可为 null
     * @return 总数
     */
    public long count(Long accountId, String appCode, String result, LocalDateTime createdAtFrom,
            LocalDateTime createdAtTo) {
        return auditLogMapper.count(accountId, appCode, result, createdAtFrom, createdAtTo);
    }

    /**
     * 按复合主键查询日志。
     *
     * @param id 日志标识
     * @param createdAt 创建时间
     * @return 日志记录，不存在时为 null
     */
    public AuditLog findById(long id, LocalDateTime createdAt) {
        return auditLogMapper.findById(id, createdAt);
    }
}
