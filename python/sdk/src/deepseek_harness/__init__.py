# 文件职责：汇总并公开 DeepSeek Harness Python SDK 的稳定顶层 API。
# 技术维度：使用 Python 包相对导入和 __all__ 控制 from deepseek_harness import * 的导出集合。
# 产品维度：让 Python 用户从一个入口创建 Harness、连接服务器、管理会话并处理协议错误。
# 逻辑维度：依次导入高级 API、底层客户端、错误类型和协议模型，再统一列入公开名称清单。
# 关键边界：这里只重导出符号，不执行连接或启动逻辑；新增公共 API 时必须同步维护 __all__。
# 新手阅读建议：先从 DeepSeekHarness 和 Session 开始，再按需阅读 HarnessClient 与协议模型。
from .api import DeepSeekHarness, DeepSeekHarnessConfig, RunResult, Session
from .client import HarnessClient, HarnessConfig
from .errors import SdkProtocolError
from .models import IncomingRequest, InitializeResponse, JsonObject, Notification, ServerInfo

# __all__：Python SDK 顶层允许公开导入的名称白名单；字符串必须与上方已导入符号完全一致。
__all__ = [
    "DeepSeekHarness",
    "DeepSeekHarnessConfig",
    "Session",
    "RunResult",
    "HarnessClient",
    "HarnessConfig",
    "SdkProtocolError",
    "IncomingRequest",
    "InitializeResponse",
    "JsonObject",
    "Notification",
    "ServerInfo",
]
