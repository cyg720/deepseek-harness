/**
 * 文件职责：实现 subprocess/win32-process 中 abi probe 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用C/C++ 原生接口、显式资源管理与平台能力适配，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 subprocess/win32-process 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
#include <Windows.h>
#include <cstdio>
#include <cstddef>

/**
 * 常量说明：宏 P 统一打印 Windows ABI 表达式名称及其无符号整数值，用于人工核对探针输出。
 * 取值依据：表达式由调用处传入，输出格式固定；仅用于验证程序，不可在产品运行路径中依赖该宏。
 */
#define P(expr) printf("%-52s = %llu\n", #expr, (unsigned long long)(expr))

/**
 * 函数说明：执行 Windows 进程与作业对象相关结构体尺寸、字段偏移和系统常量探测，并运行编译期 ABI 断言。
 * 参数说明：该入口函数不接收命令行参数。
 * 返回值：全部探测与断言通过后返回 0；编译期断言失败时不会生成可执行文件。
 * 使用示例：构建并运行探针程序，读取标准输出中的表达式名称和值。
 */
int wmain()
{
  P(sizeof(void*));
  P(sizeof(HANDLE));
  P(sizeof(STARTUPINFOW));
  P(offsetof(STARTUPINFOW, dwFlags));
  P(offsetof(STARTUPINFOW, hStdInput));
  P(offsetof(STARTUPINFOW, hStdOutput));
  P(offsetof(STARTUPINFOW, hStdError));
  P(sizeof(PROCESS_INFORMATION));
  P(offsetof(PROCESS_INFORMATION, hProcess));
  P(offsetof(PROCESS_INFORMATION, hThread));
  P(offsetof(PROCESS_INFORMATION, dwProcessId));
  P(CREATE_SUSPENDED);
  P(STARTF_USESTDHANDLES);
  P(HANDLE_FLAG_INHERIT);
  P(INFINITE);
  P(STD_INPUT_HANDLE);
  P(STD_OUTPUT_HANDLE);
  P(STD_ERROR_HANDLE);
  P(FORMAT_MESSAGE_FROM_SYSTEM);
  P(FORMAT_MESSAGE_IGNORE_INSERTS);
  P(ERROR_INSUFFICIENT_BUFFER);
  P(ERROR_BROKEN_PIPE);
  P(ERROR_NO_DATA);
  P(sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
  P(offsetof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, BasicLimitInformation) + offsetof(JOBOBJECT_BASIC_LIMIT_INFORMATION, LimitFlags));
  P((int)JobObjectExtendedLimitInformation);
  P(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);

  static_assert(sizeof(STARTUPINFOW) == 104, "STARTUPINFOW size");
  static_assert(sizeof(PROCESS_INFORMATION) == 24, "PROCESS_INFORMATION size");
  static_assert(CREATE_SUSPENDED == 0x4, "suspended process flag");
  static_assert(STARTF_USESTDHANDLES == 0x100, "std handles flag");
  static_assert(HANDLE_FLAG_INHERIT == 0x1, "inherit flag");
  static_assert(sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) == 144, "job extended limit size");
  static_assert(offsetof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, BasicLimitInformation) + offsetof(JOBOBJECT_BASIC_LIMIT_INFORMATION, LimitFlags) == 16, "job LimitFlags offset");
  static_assert(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE == 0x2000, "kill on job close flag");
  static_assert(JobObjectExtendedLimitInformation == 9, "extended limit class");
  printf("\nstatic_asserts passed\n");
  return 0;
}
