// 위쪽 제목 줄: 대화 제목(두 번 클릭해 이름 바꾸기), 세션 배지, 작업 폴더.
import { $, esc, el, state, AGENTS, LABEL, ICON, api, baseName, currentCwd, toast } from './core.js'
import { openFolderDialog } from './dialogs.js'

export function renderHeader() {
  const conv = state.current
  $('#conv-title').textContent = conv ? conv.title : '새 대화'
  document.title = conv ? `${conv.title} — Orca Duo` : 'Orca Duo'
  const cwd = currentCwd()
  $('#folder-chip .folder-name').textContent = baseName(cwd) || '폴더 선택'
  $('#folder-chip').title = cwd || ''
  const sess = $('#session-badges')
  sess.innerHTML = ''
  if (!conv) return
  for (const a of AGENTS) {
    if (!conv.sessions[a]) continue
    sess.appendChild(el(`<span class="sess agent-${a}" title="${LABEL[a]} 세션 ${esc(conv.sessions[a])}">${ICON[a]}<span>세션</span></span>`))
  }
}

function bindTitleRename() {
  const title = $('#conv-title')
  title.addEventListener('dblclick', () => {
    if (!state.current) return
    title.contentEditable = 'true'
    title.focus()
    document.getSelection().selectAllChildren(title)
  })
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      title.blur()
    } else if (e.key === 'Escape') {
      title.textContent = state.current ? state.current.title : ''
      title.blur()
    }
  })
  title.addEventListener('blur', async () => {
    if (title.contentEditable !== 'true') return
    title.contentEditable = 'false'
    const next = title.textContent.trim()
    if (state.current && next && next !== state.current.title) {
      try {
        state.current = await api('PATCH', `/api/conversations/${state.current.id}`, { title: next })
        renderHeader()
      } catch (err) {
        toast(err.message, 'error')
      }
    } else renderHeader()
  })
}

export function bindHeader() {
  bindTitleRename()
  $('#folder-chip').addEventListener('click', openFolderDialog)
  $('#open-folder').addEventListener('click', () => {
    const p = currentCwd()
    if (p) api('POST', '/api/open-path', { path: p }).catch((err) => toast(err.message, 'error'))
  })
}
