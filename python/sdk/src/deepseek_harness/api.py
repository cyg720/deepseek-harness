# 文件职责：实现 api.py 覆盖的Python SDK 与捆绑运行时职责。
# 技术维度：使用 Python、异步 I/O、JSON-RPC、构建后端或标准库文件与进程接口。
# 产品维度：保障 Agent 的Python SDK 与捆绑运行时能力可安装、可调用且可诊断。
# 逻辑维度：解析参数或数据，执行核心调用或校验，再返回结果并处理资源清理。
# 关键边界：外部进程与文件不可信；版本和平台条件必须显式；敏感环境变量不得泄露。
# 新手阅读建议：先看导入和公开类型，再读主流程，最后关注异常、平台差异和清理。
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .client import HarnessClient, HarnessConfig
from .errors import SdkProtocolError
from .models import JsonObject, Notification


@dataclass(slots=True)
# 中文说明：类 DeepSeekHarnessConfig 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class DeepSeekHarnessConfig:
    """Configuration for launching the local DeepSeek Harness SDK runtime.

    The runtime inherits the caller's environment by default, so existing
    DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL settings keep working. Use ``env`` to
    intentionally override or inject variables for a subprocess.
    """

    # 中文说明：变量 provider 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    provider: str = "deepseek-official"
    # 中文说明：变量 model 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    model: str = "deepseek-v4-flash"
    # 中文说明：变量 max_tokens 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    max_tokens: int | None = None
    # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    cwd: str | None = None
    # 中文说明：变量 runtime_cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_cwd: str | None = None
    # 中文说明：变量 session_root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    session_root: str | None = None
    # 中文说明：变量 cordis 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    cordis: str | None = None
    # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    env: dict[str, str] = field(default_factory=dict)
    # 中文说明：变量 runtime_bin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    runtime_bin: str | None = None
    # 中文说明：变量 launch_args_override 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    launch_args_override: tuple[str, ...] | None = None
    # 中文说明：变量 request_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    request_timeout_seconds: float | None = None
    # 中文说明：变量 shutdown_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    shutdown_timeout_seconds: float | None = 1.0
    # 中文说明：变量 base_url 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    base_url: str | None = None
    # 中文说明：变量 api_key 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    api_key: str | None = None


@dataclass(slots=True)
# 中文说明：类 RunResult 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class RunResult:
    session_id: str
    final_response: str
    finish_reason: str | None
    events: list[JsonObject]
    notifications: list[Notification]
    # 中文说明：变量 session_root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    session_root: str | None = None


# 中文说明：类 DeepSeekHarness 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class DeepSeekHarness:
    """Reusable synchronous SDK for running DeepSeek Harness agent turns.

    The runtime subprocess starts lazily and remains owned by this instance
    across calls to :meth:`run`. Use the instance as a context manager, or call
    :meth:`close` explicitly when finished, so the subprocess is always reaped.
    """

    # 中文说明：函数 __init__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __init__(self, config: DeepSeekHarnessConfig | None = None, **kwargs: object) -> None:
        if config is not None and kwargs:
            raise TypeError("pass either DeepSeekHarnessConfig or keyword options, not both")
        self.config = config or DeepSeekHarnessConfig(**kwargs)
        # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        cwd = str(Path(self.config.cwd or Path.cwd()).resolve())
        # 中文说明：变量 runtime_cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        runtime_cwd = str(Path(self.config.runtime_cwd).resolve()) if self.config.runtime_cwd is not None else cwd
        self._cwd = cwd
        # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        env = dict(self.config.env)
        if self.config.session_root is not None:
            env["DSH_SESSION_ROOT"] = self.config.session_root
        if self.config.cordis is not None:
            env["DSH_CORDIS_CONFIG"] = self.config.cordis
        env["DSH_CWD"] = cwd
        if self.config.base_url is not None:
            env["DEEPSEEK_BASE_URL"] = self.config.base_url
        if self.config.api_key is not None:
            env["DEEPSEEK_API_KEY"] = self.config.api_key

        self._client = HarnessClient(
            HarnessConfig(
                # 中文说明：变量 runtime_bin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                runtime_bin=self.config.runtime_bin,
                # 中文说明：变量 launch_args_override 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                launch_args_override=self.config.launch_args_override,
                # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                cwd=runtime_cwd,
                # 中文说明：变量 env 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                env=env,
                # 中文说明：变量 request_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                request_timeout_seconds=self.config.request_timeout_seconds,
                # 中文说明：变量 shutdown_timeout_seconds 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                shutdown_timeout_seconds=self.config.shutdown_timeout_seconds,
            )
        )
        self._initialized = False

    # 中文说明：函数 __enter__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __enter__(self) -> "DeepSeekHarness":
        self.start()
        return self

    # 中文说明：函数 __exit__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @property
    # 中文说明：函数 client 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def client(self) -> HarnessClient:
        return self._client

    # 中文说明：函数 start 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def start(self) -> None:
        if self._initialized:
            return
        self._client.start()
        self._client.initialize(
            # 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            cwd=self._cwd,
            # 中文说明：变量 provider 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            provider=self.config.provider,
            # 中文说明：变量 model 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            model=self.config.model,
            # 中文说明：变量 max_tokens 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            max_tokens=self.config.max_tokens,
        )
        self._initialized = True

    # 中文说明：函数 close 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def close(self) -> None:
        self._client.close()
        self._initialized = False

    # 中文说明：函数 start_session 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def start_session(self, session_id: str | None = None) -> "Session":
        self.start()
        return Session(self, session_id or f"session-{uuid.uuid4().hex}")

    # 中文说明：函数 run 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def run(
        self,
        input: str | list[JsonObject],
        *,
        # 中文说明：变量 session_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        session_id: str | None = None,
        # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        return self.start_session(session_id).run(input, on_notification=on_notification)


# 中文说明：类 Session 封装本模块所需的数据和行为，用于表达Python SDK 与捆绑运行时场景。
class Session:
    # 中文说明：函数 __init__ 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def __init__(self, harness: DeepSeekHarness, session_id: str) -> None:
        self.harness = harness
        self.id = session_id

    # 中文说明：函数 run 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
    def run(
        self,
        input: str | list[JsonObject],
        *,
        # 中文说明：变量 on_notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        # 中文说明：变量 content_blocks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        content_blocks = normalize_input(input)
        # 中文说明：变量 notifications 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        notifications: list[Notification] = []
        # 中文说明：变量 events 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        events: list[JsonObject] = []

        # 中文说明：函数 collect 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
        def collect(notification: Notification) -> None:
            notifications.append(notification)
            if on_notification is not None:
                on_notification(notification)
            if (
                notification.method == "session.event"
                and notification.payload.get("sessionId") == self.id
            ):
                # 中文说明：变量 event 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                event = notification.payload.get("event")
                if isinstance(event, dict):
                    events.append(event)

        with self.harness.client.subscribe_session_notifications(self.id) as subscription:
            # 中文说明：变量 message_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            message_id = self.harness.client.session_prompt(
                self.id,
                content_blocks,
                # 中文说明：变量 notification_subscription 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                notification_subscription=subscription,
            )

            # 中文说明：变量 received 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            received = False
            while True:
                # 中文说明：变量 notification 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                notification = subscription.next()
                if not received:
                    if not _is_inbox_receipt(notification, self.id, message_id):
                        continue
                    # 中文说明：变量 received 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
                    received = True
                collect(notification)
                if (
                    notification.method == "session.status"
                    and notification.payload.get("sessionId") == self.id
                    and notification.payload.get("status") == "idle"
                ):
                    break

        return RunResult(
            # 中文说明：变量 session_id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_id=self.id,
            # 中文说明：变量 final_response 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            final_response=final_response(events),
            # 中文说明：变量 finish_reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            finish_reason=finish_reason(events),
            # 中文说明：变量 events 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            events=events,
            # 中文说明：变量 notifications 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            notifications=notifications,
            # 中文说明：变量 session_root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
            session_root=self.harness.config.session_root,
        )


# 中文说明：函数 _is_inbox_receipt 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def _is_inbox_receipt(notification: Notification, session_id: str, message_id: str) -> bool:
    if notification.method != "session.event" or notification.payload.get("sessionId") != session_id:
        return False
    # 中文说明：变量 event 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    event = notification.payload.get("event")
    if not isinstance(event, dict) or event.get("type") != "agent/inbox/spliced":
        return False
    # 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    data = event.get("data")
    # 中文说明：变量 inserted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
    inserted = data.get("inserted") if isinstance(data, dict) else None
    return isinstance(inserted, list) and any(
        isinstance(message, dict) and message.get("id") == message_id for message in inserted
    )


# 中文说明：函数 normalize_input 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def normalize_input(input: str | list[JsonObject]) -> list[JsonObject]:
    if isinstance(input, str):
        return [{"type": "text", "text": input}]
    return input


# 中文说明：函数 final_response 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def final_response(events: list[JsonObject]) -> str:
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for event in reversed(events):
        if event.get("type") != "assistant/message":
            continue
        # 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        # 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        message = data.get("message")
        # 中文说明：变量 content_owner 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        content_owner = message if isinstance(message, dict) else data
        # 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        content = content_owner.get("content")
        if not isinstance(content, list):
            continue
        # 中文说明：变量 parts 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        parts: list[str] = []
        # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "".join(parts)
    return ""


# 中文说明：函数 finish_reason 承担本模块的处理步骤；参数按签名传入，返回值供调用方使用；示例见本文件调用。
def finish_reason(events: list[JsonObject]) -> str | None:
    """Return the last turn-ending kind.

    The input must contain root-session events from one owned run interval.

    Raises:
        SdkProtocolError: The last ``turn/end`` has no string reason kind.
    """
    # 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。
    for event in reversed(events):
        if event.get("type") != "turn/end":
            continue
        # 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        data = event.get("data")
        # 中文说明：变量 reason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        reason = data.get("reason") if isinstance(data, dict) else None
        # 中文说明：变量 kind 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。
        kind = reason.get("kind") if isinstance(reason, dict) else None
        if not isinstance(kind, str):
            raise SdkProtocolError("turn/end event requires a string data.reason.kind")
        return kind
    return None
