// 입력창: 보낼 대상, 모델·권한·핑퐁 메뉴, 보내기/멈추기.
import { $, state, LABEL, OTHER, PERMISSIONS, RELAY_ROUNDS, api, isRunning, remember, savePrefs, toast } from './core.js'
import { createDropdown } from './dropdown.js'
import { renderAll } from './main.js'

const SEND_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>'
const RELAY_ITEMS = RELAY_ROUNDS.map((n) => ({ id: String(n), label: n ? `핑퐁 ${n}회` : '핑퐁 끔' }))

let menus = null

export function setTarget(agent) {
  state.target = agent
  savePrefs()
  renderComposer()
  document.querySelectorAll('.agent-card').forEach((c) => c.classList.toggle('selected', c.dataset.agent === agent))
}

function modelItems(agent) {
  const info = state.agents[agent] || {}
  const models = info.models && info.models.length ? info.models.slice() : [{ id: 'default', label: '기본값' }]
  // Why: 저장된 모델이 목록에서 빠졌어도 그대로 보여야, 모르는 사이 다른 모델로 바뀌지 않는다.
  const saved = state.prefs[agent].model
  if (!models.some((m) => m.id === saved)) models.push({ id: saved, label: saved })
  return models
}

export function renderComposer() {
  const t = state.target
  const pref = state.prefs[t]
  $('#composer').dataset.agent = t
  document.querySelectorAll('#target-switch button').forEach((b) => {
    const on = b.dataset.agent === t
    b.classList.toggle('on', on)
    b.setAttribute('aria-checked', String(on))
  })
  $('#input').placeholder = `${LABEL[t]}에게 메시지 보내기…`

  menus.model.render(modelItems(t), pref.model)
  menus.perm.render(PERMISSIONS, pref.permission)
  menus.relay.render(RELAY_ITEMS, String(state.relayRounds))
  $('#alt-toggle').classList.toggle('on', state.autoAlternate)
  $('#alt-toggle').setAttribute('aria-pressed', String(state.autoAlternate))

  const running = state.current && state.running[state.current.id]
  const btn = $('#send')
  btn.classList.toggle('stop', Boolean(running))
  btn.title = running ? '멈추기 (Esc)' : '보내기 (Enter)'
  btn.setAttribute('aria-label', btn.title)
  btn.innerHTML = running ? STOP_ICON : SEND_ICON
  $('#composer-status').innerHTML = running
    ? `<span class="pulse"></span>${running === 'relay' ? '핑퐁 넘기는 중' : `${LABEL[running] || ''} 응답 중`}`
    : ''
}

export function autosize() {
  const input = $('#input')
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px'
}

const MENTION = /^@(claude|클로드|agy|antigravity|안티그래비티|안티)\b[\s,:]*/i
async function send() {
  const input = $('#input')
  let text = input.value.trim()
  if (!text) return
  if (state.current && isRunning(state.current.id)) {
    toast('아직 응답 중이에요. 멈추거나 끝난 뒤에 보내세요', 'warn')
    return
  }
  let target = state.target
  const m = text.match(MENTION)
  if (m) {
    target = /claude|클로드/i.test(m[1]) ? 'claude' : 'antigravity'
    text = text.slice(m[0].length).trim()
    if (!text) return
  }
  if (!(state.agents[target] || {}).available) {
    toast(`${LABEL[target]} CLI를 찾을 수 없어요. 설정에서 경로를 지정하세요`, 'error')
    return
  }
  const saved = input.value
  input.value = ''
  autosize()
  try {
    if (!state.current) {
      const conv = await api('POST', '/api/conversations', { cwd: state.draftCwd })
      state.current = conv
      remember('duo.lastConv', conv.id)
      renderAll()
    }
    await api('POST', `/api/conversations/${state.current.id}/send`, {
      agent: target,
      text,
      prefs: state.prefs,
      relayRounds: state.relayRounds
    })
    if (state.autoAlternate) setTarget(OTHER[target])
    else if (target !== state.target) setTarget(target)
  } catch (err) {
    input.value = saved
    autosize()
    toast(err.message, 'error')
  }
}

export async function stop() {
  if (!state.current) return
  try {
    await api('POST', `/api/conversations/${state.current.id}/stop`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

export function bindComposer() {
  menus = {
    model: createDropdown('model', (id) => {
      state.prefs[state.target].model = id
      savePrefs()
      renderComposer()
    }),
    perm: createDropdown('perm', (id) => {
      state.prefs[state.target].permission = id
      savePrefs()
      renderComposer()
      if (id === 'full') toast(`${LABEL[state.target]}가 확인 없이 명령까지 실행합니다`, 'warn')
    }),
    relay: createDropdown('relay', (id) => {
      state.relayRounds = Number(id) || 0
      renderComposer()
      if (state.relayRounds) toast(`답변이 끝나면 상대에게 ${state.relayRounds}번 자동으로 넘겨 검토시킵니다`)
    })
  }

  const input = $('#input')
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (state.current && isRunning(state.current.id)) return
      send()
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      setTarget(OTHER[state.target])
    }
  })
  window.addEventListener('resize', autosize)
  $('#send').addEventListener('click', () => {
    if (state.current && isRunning(state.current.id)) stop()
    else send()
  })
  document.querySelectorAll('#target-switch button').forEach((b) =>
    b.addEventListener('click', () => {
      setTarget(b.dataset.agent)
      input.focus()
    })
  )
  $('#alt-toggle').addEventListener('click', () => {
    state.autoAlternate = !state.autoAlternate
    savePrefs()
    renderComposer()
    toast(state.autoAlternate ? '보낼 때마다 대상이 자동으로 바뀝니다' : '자동 번갈기를 껐습니다')
  })
}
