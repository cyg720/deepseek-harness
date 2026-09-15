package com.qs.authority.modules.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 审计日志保留期清理任务。
 *
 * <p>超过保留天数（默认 90 天）的日志被物理删除，恰好等于保留期的日志保留。任务失败会记录
 * 错误日志并告警，下一次调度自然重试，不会因为失败而永久保留超期数据。
 */
@Component
public class AuditCleanupJob {

    private static final Logger LOG = LoggerFactory.getLogger(AuditCleanupJob.class);

    private final AuditService auditService;

    /**
     * 构造清理任务。
     *
     * @param auditService 审计服务
     */
    public AuditCleanupJob(AuditService auditService) {
        this.auditService = auditService;
    }

    /** 按配置的 cron 执行物理清理。 */
    @Scheduled(cron = "${authority.audit.cleanup-cron:0 30 3 * * *}")
    public void cleanup() {
        try {
            long deleted = auditService.cleanup();
            LOG.info("审计日志清理任务结束 deleted={}", deleted);
        } catch (RuntimeException exception) {
            LOG.error("审计日志清理任务失败，将在下次调度重试", exception);
        }
    }
}
