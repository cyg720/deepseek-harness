# 文件职责：定义 Python SDK 使用的 JSON 值别名、入站消息数据类和初始化响应模型。
# 技术维度：结合 TypeAlias、带 slots 的 dataclass 和 Pydantic BaseModel 表达协议数据。
# 产品维度：为 Python 用户提供有类型提示的通知、请求和服务器信息对象。
# 逻辑维度：先声明递归 JSON 类型，再定义通知与请求数据类，最后定义服务器初始化模型。
# 关键边界：payload 必须是字符串键的 JSON 对象；ServerInfo 字段允许服务器省略。
# 新手阅读建议：先理解 JsonValue 的递归结构，再比较 Notification 与 IncomingRequest 的字段差异。
from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from pydantic import BaseModel

# JsonScalar：JSON 允许的标量值，不包括列表和对象。
JsonScalar: TypeAlias = str | int | float | bool | None
# JsonValue：任意 JSON 值，可递归包含字符串键对象或列表。
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
# JsonObject：协议消息使用的顶层 JSON 对象，键始终为字符串。
JsonObject: TypeAlias = dict[str, JsonValue]


# Notification：表示无需响应的服务器通知；使用 slots 限制实例只能保存声明字段。
@dataclass(slots=True)
class Notification:
    # method：通知方法名，取值由 SDK 协议定义。
    method: str
    # payload：通知参数对象；没有字段时使用空字典。
    payload: JsonObject


# IncomingRequest：表示服务器发来的、需要客户端回应的请求。
@dataclass(slots=True)
class IncomingRequest:
    # id：请求关联标识，可为 JSON-RPC 字符串或整数。
    id: str | int
    # method：请求方法名，决定调用方应执行的处理逻辑。
    method: str
    # payload：请求参数的 JSON 对象。
    payload: JsonObject


# ServerInfo：Pydantic 服务器身份模型，用于校验可选名称和版本字段。
class ServerInfo(BaseModel):
    # name：服务器名称；响应未提供时为 None。
    name: str | None = None
    # version：服务器版本文本；响应未提供时为 None。
    version: str | None = None


# InitializeResponse：SDK 初始化响应模型，封装可选的服务器信息。
class InitializeResponse(BaseModel):
    # serverInfo：远端服务器身份；旧实现或精简响应省略时为 None。
    serverInfo: ServerInfo | None = None
