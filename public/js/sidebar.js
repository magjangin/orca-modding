// 왼쪽 대화 목록과 에이전트 설치 상태.
import { $, esc, state, AGENTS, LABEL, ICON, api, baseName, fmtAgo, isRunning, toast } from './core.js'
import { newConversation, openConversation, renderAll } from './main.js'

function convItemHtml(c) {
  const active = state.current && state.current.id === c.id
  const dots = c.agents.map((a) => `<span class="dot agent-${a}" title="${LABEL[a]}"></span>`).join('')
  return `<div class="conv-item${active ? ' active' : ''}" data-id="${c.id}" tabindex="0">
    <div class="conv-title">${isRunning(c.id) ? '<span class="spin"></span>' : ''}${esc(c.title)}</div>
    <div class="conv-sub">${dots}<span>${esc(baseName(c.cwd))}</span><span class="ago">${fmtAgo(c.updatedAt)}</span></div>
    <button class="conv-del" title="대화 삭제" aria-label="대화 삭제">×</button>
  </div>`
}

export function renderSidebar() {
  const list = $('#conv-list')
  list.innerHTML = state.conversations.length
    ? state.conversations.map(convItemHtml).join('')
    : '<div class="conv-empty">아직 대화가 없습니다</div>'
  renderAgentStatus()
}

export function renderAgentStatus() {
  $('#agent-status').innerHTML = AGENTS.map((a) => {
    const info = state.agents[a] || {}
    const ok = info.available
    return `<div class="agent-line agent-${a}" title="${esc(info.path || '설치되지 않음')}">
      <span class="avatar sm">${ICON[a]}</span><span>${LABEL[a]}</span>
      <span class="ver ${ok ? '' : 'missing'}">${ok ? esc(info.version || '확인 중…') : '찾을 수 없음'}</span>
    </div>`
  }).join('')
}

async function deleteConversation(id) {
  const c = state.conversations.find((x) => x.id === id)
  if (!c || !confirm(`"${c.title}" 대화를 삭제할까요? (에이전트 쪽 세션 기록은 남습니다)`)) return
  try {
    await api('DELETE', `/api/conversations/${id}`)
    if (state.current && state.current.id === id) {
      state.current = null
      renderAll()
    }
  } catch (err) {
    toast(err.message, 'error')
  }
}

export function bindSidebar() {
  const list = $('#conv-list')
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.conv-item')
    if (!item) return
    if (e.target.closest('.conv-del')) return deleteConversation(item.dataset.id)
    openConversation(item.dataset.id)
    document.body.classList.remove('sidebar-open')
  })
  list.addEventListener('keydown', (e) => {
    const item = e.target.closest('.conv-item')
    if (item && e.key === 'Enter' && e.target === item) openConversation(item.dataset.id)
  })
  $('#new-chat').addEventListener('click', newConversation)
  $('#toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'))
  $('#scrim').addEventListener('click', () => document.body.classList.remove('sidebar-open'))
}
