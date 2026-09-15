package com.qs.authority.common.web;

import com.qs.authority.common.error.BusinessException;
import java.util.Map;

/**
 * 平台公约分页与排序参数。
 *
 * <p>page 从 1 开始省略为 1；pageSize 省略为 20、范围 1 至 100，越界返回 40001 而不改成最大值；
 * sortBy 只接受模块公布的白名单字段，sortOrder 只接受 asc/desc，默认 desc。排序片段由白名单拼装，
 * 用户输入不会直接进入 SQL。
 */
public final class PageQuery {

    /** 默认页码。 */
    public static final int DEFAULT_PAGE = 1;
    /** 默认每页条数。 */
    public static final int DEFAULT_PAGE_SIZE = 20;
    /** 最大每页条数。 */
    public static final int MAX_PAGE_SIZE = 100;

    private final int page;
    private final int pageSize;
    private final String orderBy;

    private PageQuery(int page, int pageSize, String orderBy) {
        this.page = page;
        this.pageSize = pageSize;
        this.orderBy = orderBy;
    }

    /**
     * 解析分页与排序参数。
     *
     * @param page 页码，可为空
     * @param pageSize 每页条数，可为空
     * @param sortBy 排序字段，可为空
     * @param sortOrder 排序方向，可为空
     * @param sortColumns 允许的排序字段到数据库列的映射
     * @param defaultSort 默认排序字段
     * @param defaultOrder 默认排序方向
     * @return 分页参数
     * @throws BusinessException 参数非法时抛出 40001
     */
    public static PageQuery of(String page, String pageSize, String sortBy, String sortOrder,
            Map<String, String> sortColumns, String defaultSort, String defaultOrder) {
        int resolvedPage = page == null || page.isBlank() ? DEFAULT_PAGE : parsePositive(page, "page");
        int resolvedPageSize = pageSize == null || pageSize.isBlank() ? DEFAULT_PAGE_SIZE : parsePositive(pageSize,
                "pageSize");
        if (resolvedPageSize > MAX_PAGE_SIZE) {
            throw BusinessException.invalidField("pageSize", "请输入 1 至 100 的整数");
        }
        String resolvedSort = sortBy == null || sortBy.isBlank() ? defaultSort : sortBy.trim();
        String column = sortColumns.get(resolvedSort);
        if (column == null) {
            throw BusinessException.invalidField("sortBy", "不支持的排序字段");
        }
        String resolvedOrder = sortOrder == null || sortOrder.isBlank() ? defaultOrder : sortOrder.trim();
        if (!"asc".equalsIgnoreCase(resolvedOrder) && !"desc".equalsIgnoreCase(resolvedOrder)) {
            throw BusinessException.invalidField("sortOrder", "请输入 asc 或 desc");
        }
        String direction = "asc".equalsIgnoreCase(resolvedOrder) ? "ASC" : "DESC";
        String secondary = sortColumns.get("id");
        String orderBy = column + " " + direction + ", " + secondary + " " + direction;
        return new PageQuery(resolvedPage, resolvedPageSize, orderBy);
    }

    private static int parsePositive(String text, String field) {
        try {
            int value = Integer.parseInt(text.trim());
            if (value < 1) {
                throw BusinessException.invalidField(field, "请输入大于 0 的整数");
            }
            return value;
        } catch (NumberFormatException exception) {
            throw BusinessException.invalidField(field, "请输入大于 0 的整数");
        }
    }

    /**
     * 页码。
     *
     * @return 页码，从 1 开始
     */
    public int page() {
        return page;
    }

    /**
     * 每页条数。
     *
     * @return 每页条数
     */
    public int pageSize() {
        return pageSize;
    }

    /**
     * SQL 偏移量。
     *
     * @return 偏移量
     */
    public long offset() {
        return (long) (page - 1) * pageSize;
    }

    /**
     * 白名单拼装的排序片段，可直接用于 {@code ORDER BY}。
     *
     * @return 形如 {@code created_at DESC, id DESC} 的片段
     */
    public String orderBy() {
        return orderBy;
    }
}
