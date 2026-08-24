# 文件职责：定义 Python SDK 对调用方公开的异常层级和 JSON-RPC 错误信息。
# 技术维度：使用 Python 异常继承和带类型标注的初始化方法保存结构化错误字段。
# 产品维度：帮助 SDK 用户区分传输中断、协议违规和远端 JSON-RPC 业务错误。
# 逻辑维度：HarnessError 作为根异常，三个子类按故障来源细分，其中 JsonRpcError 保存响应详情。
# 关键边界：异常类只描述错误，不执行重试或恢复；data 可以是任意对象或 None。
# 新手阅读建议：先从 HarnessError 看继承关系，再重点阅读 JsonRpcError 的三个公开属性。
from __future__ import annotations


class HarnessError(Exception):
    """Base exception for SDK and runtime failures."""
    # SDK 与运行时故障的基础异常；调用方可捕获它统一处理所有 Harness 相关错误。


class TransportClosedError(HarnessError):
    """Raised when the runtime subprocess exits or closes stdout."""
    # 运行时子进程退出或关闭标准输出时抛出；通常表示当前连接不能继续使用。


class SdkProtocolError(HarnessError):
    """Raised when the runtime sends data outside the SDK protocol."""
    # 运行时返回不符合 SDK 协议的数据时抛出；不应把这类数据继续当作正常响应处理。


class JsonRpcError(HarnessError):
    """Raised when the runtime returns a JSON-RPC error response."""
    # 运行时返回 JSON-RPC 错误响应时抛出，并保留错误码、消息与可选附加数据。

    # 功能描述：用 JSON-RPC 错误字段初始化异常，并把 message 传给 Python 基础异常。
    # 参数说明：code 是整数错误码或 None；message 是可读错误文本；data 是可选附加对象。
    # 返回值解释：初始化方法不返回值；创建后的实例可通过 code、message、data 读取详情。
    # 使用示例：JsonRpcError(-32601, "method not found", {"method": "run"})。
    def __init__(self, code: int | None, message: str, data: object | None = None) -> None:
        super().__init__(message)
        # code：JSON-RPC 整数错误码；协议未提供错误码时为 None。
        self.code = code
        # message：面向调用方的错误文本，同时也是 Exception 的显示消息。
        self.message = message
        # data：远端附带的任意诊断对象；没有附加信息时为 None。
        self.data = data
