import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { expect, it, vi } from 'vitest'
import RichEditPanel from '../src/community/coop/RichEditPanel.vue'

const state = vi.hoisted(() => ({ editor: { form: {} as Record<string, unknown>, blocks: [], saving: false } }))
vi.mock('../src/community/composables/useCommunityDraft', () => ({ useCommunityDraft: () => state.editor }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => ({ composerOpen: true }) }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => true }) }))
vi.mock('../src/components/base/AppDialog.vue', () => ({ default: { setup: (_: unknown, { slots }: { slots: { default: () => unknown } }) => () => h('section', slots.default()) } }))
vi.mock('../src/community/coop/BaseRichEditor.vue', () => ({ default: { render: () => null } }))
vi.mock('../src/community/CommunityDraftConflict.vue', () => ({ default: { render: () => null } }))
vi.mock('../src/community/ResourceContributionFields.vue', () => ({ default: { render: () => null } }))
vi.mock('../src/community/CommunityCoverField.vue', () => ({ default: { render: () => h('div', { 'data-cover-field': '' }) } }))

it.each([undefined, 'article', 'video', 'document'])('仅教程图文显示封面，%s 不产生门户授权控件或改写旧数据', async (kind) => {
  state.editor.form = { title: '', visibility: 'public', coverFileId: 'old-community-cover', portalConsent: true, ...(kind ? { contribution: { kind, coverFileId: 'tutorial-cover' } } : {}) }
  const before = JSON.stringify(state.editor.form)
  const html = await renderToString(createSSRApp(RichEditPanel))
  expect(html.includes('data-cover-field')).toBe(kind === 'article')
  expect(html).not.toContain('允许未登录门户')
  expect(html).not.toContain('type="checkbox"')
  expect(JSON.stringify(state.editor.form)).toBe(before)
})
