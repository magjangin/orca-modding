// 입력창: 보낼 대상, 모델·노력·권한·핑퐁 메뉴, 보내기/멈추기.
import { $, state, AGENTS, LABEL, OTHER, EFFORT_LABEL, api, isRunning, remember, savePrefs, toast } from './core.js'
import { createDropdown } from './dropdown.js'
import { parseMention } from './mention.js'
import { renderAll } from './main.js'

const PERMISSIONS = [
  { id: 'plan', label: '읽기 전용', hint: '파일을 바꾸지 않고 계획·분석만 합니다', tone: 'ok' },
  { id: 'edit', label: '편집 허용', hint: '파일 편집은 자동 승인, 명령 실행은 막힙니다' },
  { id: 'full', label: '전체 자동', hint: '확인 없이 명령까지 실행합니다 (주의)', tone: 'danger' }
]
const RELAY_ITEMS = [0, 1, 2, 3, 5].map((n) => ({ id: String(n), label: n ? `핑퐁 ${n}회` : '핑퐁 끔' }))

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
const ICONS = {
  model: svg('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
  effort: svg('<path d="M4.5 16.5a7.5 7.5 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m12 16.5 3.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.3" fill="currentColor"/>'),
  perm: svg('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
  relay: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
}
const SEND_ICON = svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
const STOP_ICON = svg('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>')

let menus = null

export function setTarget(agent) {
  state.target = agent
  savePrefs()
  renderComposer()
  document.querySelectorAll('.agent-card').forEach((c) => c.classList.toggle('selected', c.dataset.agent === agent))
}

// 서버가 보낸 모델 목록 ({ id, label, hint?, efforts, variants?, defaultEffort? }).
function modelsOf(agent) {
  const info = state.agents[agent] || {}
  const models = info.models && info.models.length ? info.models.slice() : [{ id: 'default', label: '기본값', efforts: [] }]
  // Why: 저장된 모델이 목록에서 빠졌어도 그대로 보여야, 모르는 사이 다른 모델로 바뀌지 않는다.
  const saved = state.prefs[agent].model
  if (!models.some((m) => m.id === saved)) models.push({ id: saved, label: saved, efforts: [] })
  return models
}

// Why: 예전에는 agy 모델을 노력 단계별 ID(`gemini-x-low`)로 저장했다. 지금은 계열 + 노력으로 나눠 저장한다.
function migrateVariantPrefs() {
  for (const agent of AGENTS) {
    const pref = state.prefs[agent]
    const models = (state.agents[agent] || {}).models || []
    if (models.some((m) => m.id === pref.model)) continue
    for (const m of models) {
      const level = m.variants && Object.keys(m.variants).find((l) => m.variants[l] === pref.model)
      if (!level) continue
      pref.model = m.id
      pref.effort = level
      savePrefs()
      break
    }
  }
}

// 노력 칸: 모델이 지원하는 단계만. agy 계열처럼 단계가 모델 자체를 고르는 경우엔 '기본값'이 없다.
function effortItems(model) {
  const levels = (model.efforts || []).map((id) => ({ id, label: EFFORT_LABEL[id] || id }))
  if (!levels.length || model.variants) return levels
  return [{ id: 'default', label: '기본값', hint: 'CLI 설정의 노력 단계를 그대로 씁니다' }, ...levels]
}
function effectiveEffort(model, items, wanted) {
  return items.some((i) => i.id === wanted) ? wanted : model.defaultEffort || 'default'
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

  migrateVariantPrefs()
  const models = modelsOf(t)
  const model = models.find((m) => m.id === pref.model)
  const efforts = effortItems(model)
  menus.model.render(models, pref.model)
  menus.effort.render(efforts, effectiveEffort(model, efforts, pref.effort))
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

async function send() {
  const input = $('#input')
  let text = input.value.trim()
  if (!text) return
  if (state.current && isRunning(state.current.id)) {
    toast('아직 응답 중이에요. 멈추거나 끝난 뒤에 보내세요', 'warn')
    return
  }
  let target = state.target
  const mention = parseMention(text)
  if (mention) {
    target = mention.agent
    text = mention.text
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

function setPref(key, value) {
  state.prefs[state.target][key] = value
  savePrefs()
  renderComposer()
}

export function bindComposer() {
  menus = {
    model: createDropdown('model', { icon: ICONS.model, title: '모델', onPick: (id) => setPref('model', id) }),
    effort: createDropdown('effort', {
      icon: ICONS.effort,
      title: '노력 — 높을수록 더 오래 생각합니다',
      prefix: '노력',
      onPick: (id) => setPref('effort', id)
    }),
    perm: createDropdown('perm', {
      icon: ICONS.perm,
      title: '권한',
      onPick: (id) => {
        for (const a of AGENTS) state.prefs[a].permission = id
        savePrefs()
        renderComposer()
        if (id === 'full') toast('Claude와 Antigravity 모두 확인 없이 명령까지 실행합니다', 'warn')
      }
    }),
    relay: createDropdown('relay', {
      icon: ICONS.relay,
      title: '답변이 끝나면 상대 에이전트에게 자동으로 넘겨 검토시킵니다',
      alignRight: true,
      onPick: (id) => {
        state.relayRounds = Number(id) || 0
        renderComposer()
        if (state.relayRounds) toast(`답변이 끝나면 상대에게 ${state.relayRounds}번 자동으로 넘겨 검토시킵니다`)
      }
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
