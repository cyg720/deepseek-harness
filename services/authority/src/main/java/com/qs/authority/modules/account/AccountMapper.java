package com.qs.authority.modules.account;

import com.qs.authority.modules.account.AccountUpdate;
import java.time.LocalDateTime;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 账号持久层。
 *
 * <p>所有 SQL 使用绑定参数；排序片段由服务层按白名单拼装后传入，用户输入不直接进入 SQL。
 */
@Mapper
public interface AccountMapper {

    /**
     * 按主键查询。
     *
     * @param id 账号标识
     * @return 账号记录，不存在时为 null
     */
    Account findById(@Param("id") long id);

    /**
     * 按用户名查询。
     *
     * @param username 用户名
     * @return 账号记录，不存在时为 null
     */
    Account findByUsername(@Param("username") String username);

    /**
     * 按用户名查询并锁定该行，用于登录：与并发的改密、冻结形成互斥，避免旧口令在校验之后仍签发令牌。
     *
     * @param username 用户名
     * @return 账号记录，不存在时为 null
     */
    Account findByUsernameForUpdate(@Param("username") String username);

    /**
     * 查询内置超级管理员。
     *
     * @return 超级管理员账号，尚未初始化时为 null
     */
    Account findSuperAdmin();

    /**
     * 初始化超级管理员数量。
     *
     * @return 记录数，最大为 1
     */
    long countSuperAdmins();

    /**
     * 统计用户名占用。
     *
     * @param username 用户名
     * @param excludeId 需要排除的账号标识，可为 null
     * @return 占用数量
     */
    long countByUsername(@Param("username") String username, @Param("excludeId") Long excludeId);

    /**
     * 统计手机号占用。
     *
     * @param phone 手机号
     * @param excludeId 需要排除的账号标识，可为 null
     * @return 占用数量
     */
    long countByPhone(@Param("phone") String phone, @Param("excludeId") Long excludeId);

    /**
     * 统计邮箱占用。
     *
     * @param email 邮箱
     * @param excludeId 需要排除的账号标识，可为 null
     * @return 占用数量
     */
    long countByEmail(@Param("email") String email, @Param("excludeId") Long excludeId);

    /**
     * 分页查询账号。
     *
     * @param username 用户名筛选，可为 null
     * @param status 状态筛选，可为 null
     * @param accountType 账号类型筛选，可为 null
     * @param orderBy 白名单排序片段
     * @param limit 每页条数
     * @param offset 偏移量
     * @return 账号列表
     */
    List<Account> list(@Param("username") String username, @Param("status") String status,
            @Param("accountType") String accountType, @Param("orderBy") String orderBy, @Param("limit") int limit,
            @Param("offset") long offset);

    /**
     * 统计符合条件的账号总数。
     *
     * @param username 用户名筛选，可为 null
     * @param status 状态筛选，可为 null
     * @param accountType 账号类型筛选，可为 null
     * @return 总数
     */
    long count(@Param("username") String username, @Param("status") String status,
            @Param("accountType") String accountType);

    /**
     * 新增账号。
     *
     * @param account 账号记录，成功回填 id
     * @return 影响行数
     */
    int insert(Account account);

    /**
     * 按 version 条件更新账号。
     *
     * @param update 更新参数
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int update(AccountUpdate update);

    /**
     * 按 version 条件物理删除账号。
     *
     * @param id 账号标识
     * @param version 读取时版本
     * @return 影响行数；0 表示版本冲突或目标不存在
     */
    int delete(@Param("id") long id, @Param("version") long version);

    /**
     * 写入最后登录时间；该列不在版本触发器范围内，不影响其他管理员的 version。
     *
     * @param id 账号标识
     * @param at 登录时间
     * @return 影响行数
     */
    int touchLastLogin(@Param("id") long id, @Param("at") LocalDateTime at);

    /**
     * 统计账号的引用总数（组织、用户组、权限组、令牌）。
     *
     * @param id 账号标识
     * @return 引用数量
     */
    long countReferences(@Param("id") long id);

    /**
     * 统计账号与组织的关联数。
     *
     * @param id 账号标识
     * @return 关联数
     */
    long countOrganizationLinks(@Param("id") long id);

    /**
     * 统计账号的用户组成员关系数。
     *
     * @param id 账号标识
     * @return 关联数
     */
    long countUserGroupLinks(@Param("id") long id);

    /**
     * 统计账号的权限组关联数。
     *
     * @param id 账号标识
     * @return 关联数
     */
    long countPermissionGroupLinks(@Param("id") long id);

    /**
     * 统计账号的令牌数（含已撤销）。
     *
     * @param id 账号标识
     * @return 令牌数
     */
    long countTokens(@Param("id") long id);
}
