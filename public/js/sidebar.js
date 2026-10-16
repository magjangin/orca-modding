// 왼쪽 대화 목록과 에이전트 설치 상태.
import { $, esc, el, state, AGENTS, LABEL, ICON, api, baseName, fmtAgo, isRunning, toast } from './core.js'
import { newConversation, openConversation, renderAll } from './main.js'

function convItemEl(c) {
  const active = state.current && state.current.id === c.id
  const dots = c.agents.map((a) => `<span class="dot agent-${a}" title="${LABEL[a]}"></span>`).join('')
  const item = el(
    `<div class="conv-item${active ? ' active' : ''}" data-id="${c.id}" tabindex="0">
      <div class="conv-title">${isRunning(c.id) ? '<span class="spin"></span>' : ''}${esc(c.title)}</div>
      <div class="conv-sub">${dots}<span>${esc(baseName(c.cwd))}</span><span class="ago">${fmtAgo(c.updatedAt)}</span></div>
      <button class="conv-del" title="대화 삭제" aria-label="대화 삭제">×</button>
    </div>`
  )
  item.addEventListener('click', (e) => {
    if (e.target.closest('.conv-del')) return
    openConversation(c.id)
    document.body.classList.remove('sidebar-open')
  })
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openConversation(c.id)
  })
  item.querySelector('.conv-del').addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!confirm(`"${c.title}" 대화를 삭제할까요? (에이전트 쪽 세션 기록은 남습니다)`)) return
    try {
      await api('DELETE', `/api/conversations/${c.id}`)
      if (state.current && state.current.id === c.id) {
        state.current = null
        renderAll()
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  })
  return item
}

export function renderSidebar() {
  const list = $('#conv-list')
  list.innerHTML = ''
  if (!state.conversations.length) {
    list.appendChild(el('<div class="conv-empty">아직 대화가 없습니다</div>'))
  }
  for (const c of state.conversations) list.appendChild(convItemEl(c))
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

export function bindSidebar() {
  $('#new-chat').addEventListener('click', newConversation)
  $('#toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'))
  $('#scrim').addEventListener('click', () => document.body.classList.remove('sidebar-open'))
}
