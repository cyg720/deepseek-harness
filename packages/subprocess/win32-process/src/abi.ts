/** Generic Win32 process, stdio, and Job Object constants verified on x64. */

/** STARTUPINFOW uses the standard input, output, and error handles.
 * @remarks 文件说明：文件职责：实现 subprocess/win32-process 中 abi 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subprocess/win32-process 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：STARTF_USESTDHANDLES 用于处理 STARTF_USESTDHANDLES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STARTF_USESTDHANDLES = 0x00000100
/** HandleInformation flag that permits child inheritance.
 * @remarks 中文说明：常量说明：HANDLE_FLAG_INHERIT 用于处理 FLAG INHERIT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const HANDLE_FLAG_INHERIT = 0x1
/** Infinite WaitForSingleObject timeout.
 * @remarks 中文说明：常量说明：INFINITE 用于处理 INFINITE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const INFINITE = 0xFFFFFFFF
/** CreateProcess flag that prevents user code from running before resume.
 * @remarks 中文说明：常量说明：CREATE_SUSPENDED 用于创建 SUSPENDED 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CREATE_SUSPENDED = 0x4
/** GetStdHandle selector for standard input.
 * @remarks 中文说明：常量说明：STD_INPUT_HANDLE 用于处理 STD_INPUT_HANDLE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STD_INPUT_HANDLE = -10
/** GetStdHandle selector for standard output.
 * @remarks 中文说明：常量说明：STD_OUTPUT_HANDLE 用于处理 STD_OUTPUT_HANDLE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STD_OUTPUT_HANDLE = -11
/** GetStdHandle selector for standard error.
 * @remarks 中文说明：常量说明：STD_ERROR_HANDLE 用于处理 STD_ERROR_HANDLE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STD_ERROR_HANDLE = -12
/** FormatMessage reads the operating system message table.
 * @remarks 中文说明：常量说明：FORMAT_MESSAGE_FROM_SYSTEM 用于格式化 MESSAGE FROM SYSTEM
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000
/** FormatMessage leaves insertion placeholders uninterpreted.
 * @remarks 中文说明：常量说明：FORMAT_MESSAGE_IGNORE_INSERTS 用于格式化 MESSAGE IGNORE
 * INSERTS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200
/** Win32 code reporting a caller-provided buffer is too small.
 * @remarks 中文说明：常量说明：ERROR_INSUFFICIENT_BUFFER 用于处理
 * ERROR_INSUFFICIENT_BUFFER 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ERROR_INSUFFICIENT_BUFFER = 122
/** Win32 code reporting that the other pipe end closed.
 * @remarks 中文说明：常量说明：ERROR_BROKEN_PIPE 用于处理 ERROR_BROKEN_PIPE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ERROR_BROKEN_PIPE = 109
/** Win32 code reporting that a pipe has no remaining data.
 * @remarks 中文说明：常量说明：ERROR_NO_DATA 用于处理 ERROR_NO_DATA 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ERROR_NO_DATA = 232
/** Job limit that terminates every member when the final Job handle closes.
 * @remarks 中文说明：常量说明：JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 用于处理
 * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
/** SetInformationJobObject class for JOBOBJECT_EXTENDED_LIMIT_INFORMATION.
 * @remarks 中文说明：常量说明：JobObjectExtendedLimitInformation 用于处理
 * JobObjectExtendedLimitInformation 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const JobObjectExtendedLimitInformation = 9
/** x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION byte size.
 * @remarks 中文说明：常量说明：JOBOBJECT_EXTENDED_LIMIT_SIZE 用于处理
 * JOBOBJECT_EXTENDED_LIMIT_SIZE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const JOBOBJECT_EXTENDED_LIMIT_SIZE = 144
/** Byte offset of BasicLimitInformation.LimitFlags in the extended Job record.
 * @remarks 中文说明：常量说明：JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET 用于处理
 * JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET = 16
/** x64 STARTUPINFOW byte size verified by the native probe.
 * @remarks 中文说明：常量说明：STARTUPINFOW_SIZE 用于处理 STARTUPINFOW_SIZE 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STARTUPINFOW_SIZE = 104
/** x64 PROCESS_INFORMATION byte size verified by the native probe.
 * @remarks 中文说明：常量说明：PROCESS_INFORMATION_SIZE 用于处理
 * PROCESS_INFORMATION_SIZE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PROCESS_INFORMATION_SIZE = 24
