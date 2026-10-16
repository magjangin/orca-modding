// 서버 이벤트 스트림(SSE): 대화 목록·메시지 조각·실행 상태를 받아 화면에 반영한다.
import { $, state, OTHER, api, eventsUrl, isRunning, toast } from './core.js'
import { renderAll } from './main.js'
import { renderAgentStatus, renderSidebar } from './sidebar.js'
import { renderHeader } from './header.js'
import { renderMessages, upsertMessage } from './messages.js'
import { renderComposer, setTarget } from './composer.js'

export function applyState(s) {
  state.conversations = s.conversations
  state.agents = s.agents
  state.settings = s.settings
  state.dataDir = s.dataDir
  state.running = {}
  for (const [id, agent] of Object.entries(s.running || {})) state.running[id] = agent || 'relay'
  if (!state.draftCwd) state.draftCwd = s.settings.lastCwd
}

async function resync() {
  try {
    applyState(await api('GET', '/api/state'))
    if (state.current) state.current = await api('GET', `/api/conversations/${state.current.id}`).catch(() => null)
    renderAll()
  } catch {}
}

function onRunning(ev) {
  const cur = state.current
  const wasRunning = isRunning(ev.convId)
  if (ev.agent || ev.pendingRelay) state.running[ev.convId] = ev.agent || 'relay'
  else delete state.running[ev.convId]
  // Why: 핑퐁으로 이어진 턴까지 모두 끝나면, 다음 차례는 마지막으로 답한 쪽의 상대가 되게 맞춘다.
  if (cur && ev.convId === cur.id && wasRunning && !isRunning(cur.id) && state.autoAlternate && !$('#input').value.trim()) {
    const lastReply = [...cur.messages].reverse().find((m) => m.role === 'assistant')
    if (lastReply && lastReply.status === 'done') setTarget(OTHER[lastReply.agent])
  }
  renderComposer()
  renderSidebar()
  if (cur && ev.convId === cur.id) renderHeader()
}

function handleEvent(ev) {
  const cur = state.current
  switch (ev.type) {
    case 'conv-list':
      state.conversations = ev.conversations
      renderSidebar()
      if (cur) {
        const s = ev.conversations.find((c) => c.id === cur.id)
        if (s && s.title !== cur.title) {
          cur.title = s.title
          renderHeader()
        }
      }
      return
    case 'message':
      if (cur && ev.convId === cur.id) upsertMessage(ev.message)
      return
    case 'parts': {
      if (!cur || ev.convId !== cur.id) return
      const msg = cur.messages.find((m) => m.id === ev.msgId)
      if (!msg) return
      for (const [i, part] of ev.patches) msg.parts[i] = part
      if (ev.meta) msg.meta = ev.meta
      upsertMessage(msg)
      return
    }
    case 'running':
      onRunning(ev)
      return
    case 'conversation':
      if (cur && ev.conversation.id === cur.id) {
        state.current = ev.conversation
        renderHeader()
        renderMessages()
      }
      return
    case 'agents':
      state.agents = ev.agents
      renderAgentStatus()
      renderComposer()
      if (!cur || !cur.messages.length) renderMessages()
      return
    case 'toast':
      toast(ev.message, ev.level || 'info')
      return
    default:
  }
}

export function connectEvents() {
  const es = new EventSource(eventsUrl())
  let wasDown = false
  es.onopen = () => {
    if (wasDown) {
      wasDown = false
      resync()
    }
    document.body.classList.remove('offline')
  }
  es.onerror = () => {
    wasDown = true
    document.body.classList.add('offline')
  }
  es.onmessage = (e) => {
    let ev
    try {
      ev = JSON.parse(e.data)
    } catch {
      return
    }
    handleEvent(ev)
  }
}
