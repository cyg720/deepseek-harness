/** ACL/token-specific Win32 constants. */

/** OpenProcess access required to query the current process token.
 * @remarks 文件说明：文件职责：实现 sandbox/sandbox-windows-acl 中 win32 abi 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * sandbox/sandbox-windows-acl 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：PROCESS_QUERY_INFORMATION 用于处理
 * PROCESS_QUERY_INFORMATION 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PROCESS_QUERY_INFORMATION = 0x0400
/** Token right required by CreateProcessAsUserW.
 * @remarks 中文说明：常量说明：TOKEN_ASSIGN_PRIMARY 用于处理 TOKEN_ASSIGN_PRIMARY 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TOKEN_ASSIGN_PRIMARY = 0x0001
/** Token right required by DuplicateTokenEx.
 * @remarks 中文说明：常量说明：TOKEN_DUPLICATE 用于处理 TOKEN_DUPLICATE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TOKEN_DUPLICATE = 0x0002
/** Token right required to read token information.
 * @remarks 中文说明：常量说明：TOKEN_QUERY 用于处理 TOKEN_QUERY 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const TOKEN_QUERY = 0x0008
/** Token right required to replace the token default DACL.
 * @remarks 中文说明：常量说明：TOKEN_ADJUST_DEFAULT 用于处理 TOKEN_ADJUST_DEFAULT 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TOKEN_ADJUST_DEFAULT = 0x0080
/** Group attribute identifying the token logon SID.
 * @remarks 中文说明：常量说明：SE_GROUP_LOGON_ID 用于处理 SE_GROUP_LOGON_ID 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SE_GROUP_LOGON_ID = 0xC0000000
/** Standard-rights portion excluded from the write capability grant.
 * @remarks 中文说明：常量说明：STANDARD_RIGHTS_WRITE 用于处理 STANDARD_RIGHTS_WRITE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STANDARD_RIGHTS_WRITE = 0x00020000
/** Generic file write access bits.
 * @remarks 中文说明：常量说明：FILE_GENERIC_WRITE 用于处理 FILE_GENERIC_WRITE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_GENERIC_WRITE = 0x00120116
/** Delete or rename an object.
 * @remarks 中文说明：常量说明：DELETE 用于删除 DELETE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DELETE = 0x00010000
/** Delete or rename a directory child.
 * @remarks 中文说明：常量说明：FILE_DELETE_CHILD 用于处理 FILE_DELETE_CHILD 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_DELETE_CHILD = 0x0040
/**
 * Capability-SID access mask granting write, delete, and child deletion.
 * WRITE_DAC and WRITE_OWNER stay excluded so a confined child cannot rewrite
 * DACLs or take ownership to escape the allowlist.
 * @remarks 中文说明：常量说明：GRANT_MASK 用于处理 GRANT_MASK 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
export const GRANT_MASK = (FILE_GENERIC_WRITE | DELETE | FILE_DELETE_CHILD) & ~STANDARD_RIGHTS_WRITE
/** Full access used in the restricted token default DACL.
 * @remarks 中文说明：常量说明：FILE_ALL_ACCESS 用于处理 FILE_ALL_ACCESS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_ALL_ACCESS = 0x1F01FF
/** CreateRestrictedToken flag that disables maximum privileges.
 * @remarks 中文说明：常量说明：DISABLE_MAX_PRIVILEGE 用于处理 DISABLE_MAX_PRIVILEGE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DISABLE_MAX_PRIVILEGE = 0x1
/** CreateRestrictedToken limited-user flag.
 * @remarks 中文说明：常量说明：LUA_TOKEN 用于处理 LUA_TOKEN 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const LUA_TOKEN = 0x4
/** Restrict write access to the listed restricting SIDs.
 * @remarks 中文说明：常量说明：WRITE_RESTRICTED 用于写入 RESTRICTED 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const WRITE_RESTRICTED = 0x8
/** WELL_KNOWN_SID_TYPE value for Everyone.
 * @remarks 中文说明：常量说明：WinWorldSid 用于处理 WinWorldSid 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const WinWorldSid = 1
/** TOKEN_INFORMATION_CLASS value for token groups.
 * @remarks 中文说明：常量说明：TokenGroups 用于处理 TokenGroups 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const TokenGroups = 2
/** TOKEN_INFORMATION_CLASS value for the token default DACL.
 * @remarks 中文说明：常量说明：TokenDefaultDacl 用于处理 TokenDefaultDacl 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TokenDefaultDacl = 6
/** SECURITY_INFORMATION flag selecting the DACL.
 * @remarks 中文说明：常量说明：DACL_SECURITY_INFORMATION 用于处理
 * DACL_SECURITY_INFORMATION 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DACL_SECURITY_INFORMATION = 0x00000004
/** SE_OBJECT_TYPE value for filesystem objects.
 * @remarks 中文说明：常量说明：SE_FILE_OBJECT 用于处理 SE_FILE_OBJECT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SE_FILE_OBJECT = 1
/** TRUSTEE_TYPE value used when trustee classification is unknown.
 * @remarks 中文说明：常量说明：TRUSTEE_IS_UNKNOWN 用于处理 TRUSTEE_IS_UNKNOWN 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRUSTEE_IS_UNKNOWN = 0
/** TRUSTEE_FORM value indicating a SID pointer.
 * @remarks 中文说明：常量说明：TRUSTEE_IS_SID 用于处理 TRUSTEE_IS_SID 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRUSTEE_IS_SID = 0
/** Trustee record has no chained trustee.
 * @remarks 中文说明：常量说明：NO_MULTIPLE_TRUSTEE 用于处理 NO_MULTIPLE_TRUSTEE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const NO_MULTIPLE_TRUSTEE = 0
/** EXPLICIT_ACCESS mode that grants access.
 * @remarks 中文说明：常量说明：GRANT_ACCESS 用于处理 GRANT_ACCESS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const GRANT_ACCESS = 1
/** EXPLICIT_ACCESS mode that revokes access.
 * @remarks 中文说明：常量说明：REVOKE_ACCESS 用于处理 REVOKE_ACCESS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const REVOKE_ACCESS = 4
/** ACE inheritance flags for child containers and objects.
 * @remarks 中文说明：常量说明：SUB_CONTAINERS_AND_OBJECTS_INHERIT 用于处理
 * SUB_CONTAINERS_AND_OBJECTS_INHERIT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const SUB_CONTAINERS_AND_OBJECTS_INHERIT = 0x3
/** Legacy Win32 maximum path character count used by GetTempPathW.
 * @remarks 中文说明：常量说明：MAX_PATH 用于处理 MAX_PATH 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const MAX_PATH = 260
/** Successful Win32 status code.
 * @remarks 中文说明：常量说明：ERROR_SUCCESS 用于处理 ERROR_SUCCESS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ERROR_SUCCESS = 0
/** Win32 error reported when an immediate byte-range lock cannot be obtained.
 * @remarks 中文说明：常量说明：ERROR_LOCK_VIOLATION 用于处理 ERROR_LOCK_VIOLATION 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ERROR_LOCK_VIOLATION = 33
/** Generic read access bit.
 * @remarks 中文说明：常量说明：GENERIC_READ 用于处理 GENERIC_READ 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const GENERIC_READ = 0x80000000
/** Generic write access bit.
 * @remarks 中文说明：常量说明：GENERIC_WRITE 用于处理 GENERIC_WRITE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const GENERIC_WRITE = 0x40000000
/** CreateFile share-read flag.
 * @remarks 中文说明：常量说明：FILE_SHARE_READ 用于处理 FILE_SHARE_READ 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_SHARE_READ = 0x00000001
/** CreateFile share-write flag.
 * @remarks 中文说明：常量说明：FILE_SHARE_WRITE 用于处理 FILE_SHARE_WRITE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_SHARE_WRITE = 0x00000002
/** CreateFile share-delete flag.
 * @remarks 中文说明：常量说明：FILE_SHARE_DELETE 用于处理 FILE_SHARE_DELETE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FILE_SHARE_DELETE = 0x00000004
/** CreateFile disposition that opens or creates the file.
 * @remarks 中文说明：常量说明：OPEN_ALWAYS 用于打开 ALWAYS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const OPEN_ALWAYS = 4
/** LockFileEx exclusive-lock flag.
 * @remarks 中文说明：常量说明：LOCKFILE_EXCLUSIVE_LOCK 用于处理 LOCKFILE_EXCLUSIVE_LOCK
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const LOCKFILE_EXCLUSIVE_LOCK = 0x2
/** LockFileEx immediate-failure flag.
 * @remarks 中文说明：常量说明：LOCKFILE_FAIL_IMMEDIATELY 用于处理
 * LOCKFILE_FAIL_IMMEDIATELY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const LOCKFILE_FAIL_IMMEDIATELY = 0x1
/** ACE type for an allowed-access entry.
 * @remarks 中文说明：常量说明：ACCESS_ALLOWED_ACE_TYPE 用于处理 ACCESS_ALLOWED_ACE_TYPE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ACCESS_ALLOWED_ACE_TYPE = 0
/** Maximum SID sub-authority count.
 * @remarks 中文说明：常量说明：SID_MAX_SUB_AUTHORITIES 用于处理 SID_MAX_SUB_AUTHORITIES
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SID_MAX_SUB_AUTHORITIES = 15
/** ACE flag marking inherited entries.
 * @remarks 中文说明：常量说明：INHERITED_ACE 用于处理 INHERITED_ACE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const INHERITED_ACE = 0x10
/** Maximum SID allocation size in bytes.
 * @remarks 中文说明：常量说明：SECURITY_MAX_SID_SIZE 用于处理 SECURITY_MAX_SID_SIZE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SECURITY_MAX_SID_SIZE = 68
/** x64 SID_AND_ATTRIBUTES byte size.
 * @remarks 中文说明：常量说明：SID_AND_ATTRIBUTES_SIZE 用于处理 SID_AND_ATTRIBUTES_SIZE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const SID_AND_ATTRIBUTES_SIZE = 16
/** x64 TOKEN_GROUPS offset of the first group entry.
 * @remarks 中文说明：常量说明：TOKEN_GROUPS_OFFSET 用于处理 TOKEN_GROUPS_OFFSET 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TOKEN_GROUPS_OFFSET = 8
/** x64 EXPLICIT_ACCESS_W byte size.
 * @remarks 中文说明：常量说明：EXPLICIT_ACCESS_W_SIZE 用于处理 EXPLICIT_ACCESS_W_SIZE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const EXPLICIT_ACCESS_W_SIZE = 48
/** x64 offset of TRUSTEE_W inside EXPLICIT_ACCESS_W.
 * @remarks 中文说明：常量说明：TRUSTEE_W_OFFSET 用于处理 TRUSTEE_W_OFFSET 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRUSTEE_W_OFFSET = 16
/** x64 offset of ptstrName inside TRUSTEE_W.
 * @remarks 中文说明：常量说明：TRUSTEE_W_PTSTRNAME_OFFSET 用于处理
 * TRUSTEE_W_PTSTRNAME_OFFSET 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRUSTEE_W_PTSTRNAME_OFFSET = 24
