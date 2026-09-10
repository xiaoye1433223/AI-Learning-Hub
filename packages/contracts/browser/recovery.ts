export interface RecoveryText { id: string; route: string; savedAt: string; text: string; status: '尚未同步' }
const memory = new Map<string, RecoveryText[]>()
const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
export function recoveryTexts(client: string, userId: string): RecoveryText[] {
  const prefix = `${client}-recovery:${userId}:`, entries = new Map<string, RecoveryText>()
  const append = (rows: RecoveryText[]) => rows.forEach(row => entries.set(row.id, row))
  try {
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) append(JSON.parse(localStorage.getItem(key) || '[]')) }
  } catch { /* 浏览器存储不可用时仍保留本页恢复文字。 */ }
  for (const [key, rows] of memory) if (key.startsWith(prefix)) append(rows)
  return [...entries.values()]
}
/** 退出前保存可见编辑文字；密码、MFA、文件与隐藏字段不进入恢复副本。 */
export function preserveVisibleText(client: string, userId: string) {
  const fields = [...document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [data-slate-editor], input:not([type]), input[type="text"]')]
  const texts = fields.filter(element => {
    if (!element.getClientRects().length || element.closest('[data-session-recovery], .login-page') || element.getAttribute('readonly') !== null) return false
    if (element.tagName === 'INPUT') return /标题|名称|简介|描述/.test(element.closest('label')?.textContent || element.getAttribute('placeholder') || '') && !/password|secret|token|one-time-code|username/i.test(element.outerHTML)
    return true
  }).map(element => ('value' in element ? String(element.value) : element.textContent || '').trim()).filter(Boolean)
  if (!texts.length) return
  const text = [...new Set(texts)].join('\n\n'), route = location.pathname + location.search
  const key = `${client}-recovery:${userId}:${tabId}`, existing = memory.get(key) || []
  if (existing.some(row => row.route === route && row.text === text)) return
  const rows = [...existing, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, route, savedAt: new Date().toISOString(), text, status: '尚未同步' as const }]
  memory.set(key, rows)
  localStorage.setItem(key, JSON.stringify(rows))
}
