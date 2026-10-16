// Orca Duo 화면 진입점 (빌드 도구 없는 바닐라 JS ES 모듈). 각 영역은 같은 폴더의 모듈이 맡는다.
import { $, state, api, isRunning, loadPrefs, recall, remember, toast } from './core.js'
import { closeDropdowns } from './dropdown.js'
import { bindSidebar, renderSidebar } from './sidebar.js'
import { bindHeader, renderHeader } from './header.js'
import { bindMessages, renderMessages } from './messages.js'
import { bindComposer, renderComposer, stop } from './composer.js'
import { bindDialogs } from './dialogs.js'
import { bindStatus } from './status.js'
import { applyState, connectEvents } from './events.js'

export function renderAll() {
  renderSidebar()
  renderHeader()
  renderMessages()
  renderComposer()
}

export async function openConversation(id) {
  try {
    state.current = await api('GET', `/api/conversations/${id}`)
    remember('duo.lastConv', id)
    renderAll()
    $('#input').focus()
  } catch (err) {
    toast(err.message, 'error')
  }
}

/** 지워진 대화를 화면과 '마지막으로 연 대화' 기억에서 뺀다. */
export function dropConversation(id) {
  if (recall('duo.lastConv') === id) remember('duo.lastConv', '')
  if (state.current && state.current.id === id) {
    state.current = null
    renderAll()
  }
}

export function newConversation() {
  state.current = null
  state.draftCwd = state.settings.lastCwd || state.draftCwd
  remember('duo.lastConv', '')
  renderAll()
  $('#input').focus()
  document.body.classList.remove('sidebar-open')
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeDropdowns()) {
      e.preventDefault()
    } else if (e.key === 'Escape' && state.current && isRunning(state.current.id) && !document.querySelector('dialog[open]')) {
      e.preventDefault()
      stop()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
      e.preventDefault()
      newConversation()
    }
  })
}

async function boot() {
  loadPrefs()
  bindGlobalKeys()
  bindSidebar()
  bindHeader()
  bindMessages()
  bindComposer()
  bindDialogs()
  bindStatus()
  try {
    const s = await api('GET', '/api/state')
    applyState(s)
    const last = recall('duo.lastConv')
    if (last && s.conversations.some((c) => c.id === last)) {
      state.current = await api('GET', `/api/conversations/${last}`)
    }
  } catch (err) {
    toast(err.message, 'error')
  }
  renderAll()
  connectEvents()
  $('#input').focus()
}

boot()
