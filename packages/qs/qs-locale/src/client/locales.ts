/** 语言选项名称来自官方目录，此处只拥有表单文案。 */
export const zh = { language: '语言', hint: '界面语言立即生效。', memory: '此连接的语言选择仅临时生效，不保存到 Host。' } as const
/** 英文与中文保持相同键。 */
export const en = { language: 'Language', hint: 'The interface language changes immediately.', memory: 'Language selection is temporary on this connection and is not saved to the Host.' } satisfies Record<keyof typeof zh, string>
