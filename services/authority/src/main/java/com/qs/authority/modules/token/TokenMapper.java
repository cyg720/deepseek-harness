package com.qs.authority.modules.token;

import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 令牌持久层：签发、按摘要核验、按登录实例或账号撤销。 */
@Mapper
public interface TokenMapper {

    /**
     * 新增令牌记录。
     *
     * @param token 令牌记录，成功回填 id
     * @return 影响行数
     */
    int insert(TokenRecord token);

    /**
     * 按摘要查询。
     *
     * @param digest 令牌摘要
     * @return 令牌记录，不存在时为 null
     */
    TokenRecord findByDigest(@Param("digest") String digest);

    /**
     * 撤销指定令牌；已撤销时不再匹配，保证重复换发只有一次成功。
     *
     * @param id 令牌标识
     * @return 影响行数；0 表示该令牌已被撤销
     */
    int revokeById(@Param("id") long id);

    /**
     * 撤销某个登录实例下全部未撤销令牌。
     *
     * @param sessionId 登录实例标识
     * @return 撤销数量
     */
    int revokeBySession(@Param("sessionId") String sessionId);

    /**
     * 撤销某个账号全部未撤销令牌。
     *
     * @param accountId 账号标识
     * @return 撤销数量
     */
    int revokeByAccount(@Param("accountId") long accountId);

    /**
     * 统计账号当前有效（未撤销且未到期）令牌数。
     *
     * @param accountId 账号标识
     * @param now 当前北京时间
     * @return 有效令牌数
     */
    long countActive(@Param("accountId") long accountId, @Param("now") LocalDateTime now);
}
