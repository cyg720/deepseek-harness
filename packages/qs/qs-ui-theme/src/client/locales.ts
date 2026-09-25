/** 主题与字号设置文案，不承诺 void 命令已经持久保存。 */
export const zh = { appearance: '外观', appearanceHint: '选择浅色、深色或跟随系统。', light: '浅色', dark: '深色', system: '跟随系统', fontSize: '正文字号（像素）', fontHint: '调整会话正文大小，小屏输入字号至少为 16 像素。', memory: '此连接的选择仅临时生效，不保存到 Host。' } as const
/** 英文与中文保持相同键。 */
export const en = { appearance: 'Appearance', appearanceHint: 'Choose light, dark, or follow the system.', light: 'Light', dark: 'Dark', system: 'System', fontSize: 'Content font size (px)', fontHint: 'Adjust conversation text size. Small-screen input stays at least 16 pixels.', memory: 'Selection is temporary on this connection and is not saved to the Host.' } satisfies Record<keyof typeof zh, string>
