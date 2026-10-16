// Orca Duo 화면 로직 (빌드 도구 없는 바닐라 JS).
;(function () {
  'use strict'

  const TOKEN = document.querySelector('meta[name="duo-token"]').content
  const AGENTS = ['claude', 'antigravity']
  const LABEL = { claude: 'Claude', antigravity: 'Antigravity' }
  const OTHER = { claude: 'antigravity', antigravity: 'claude' }
  const ICON = {
    claude:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/></g></svg>',
    antigravity:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5 12 5l7.5 14.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15.2" r="2.1" fill="currentColor"/></svg>'
  }
  const PERMISSIONS = [
    { id: 'plan', label: '읽기 전용', hint: '파일을 바꾸지 않고 계획·분석만 합니다' },
    { id: 'edit', label: '편집 허용', hint: '파일 편집은 자동 승인, 명령 실행은 막힙니다' },
    { id: 'full', label: '전체 자동', hint: '확인 없이 명령까지 실행합니다 (주의)' }
  ]
  const esc = window.escapeHtml
  const $ = (sel) => document.querySelector(sel)

  // ── 상태 ──────────────────────────────────────────────
  const state = {
    agents: {},
    conversations: [],
    settings: {},
    running: {},
    current: null,
    draftCwd: '',
    dataDir: '',
    target: 'claude',
    prefs: {
      claude: { model: 'default', permission: 'edit' },
      antigravity: { model: 'default', permission: 'edit' }
    },
    autoAlternate: true,
    relayRounds: 0
  }
  const openDetails = new Set()

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem('duo.prefs') || 'null')
      if (saved) {
        if (AGENTS.includes(saved.target)) state.target = saved.target
        for (const a of AGENTS) if (saved.prefs && saved.prefs[a]) Object.assign(state.prefs[a], saved.prefs[a])
        if (typeof saved.autoAlternate === 'boolean') state.autoAlternate = saved.autoAlternate
      }
    } catch {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(
        'duo.prefs',
        JSON.stringify({ target: state.target, prefs: state.prefs, autoAlternate: state.autoAlternate })
      )
    } catch {}
  }
  function remember(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {}
  }
  function recall(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  // ── API ───────────────────────────────────────────────
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'x-duo-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || res.statusText)
    return data
  }

  // ── 유틸 ──────────────────────────────────────────────
  function el(html) {
    const t = document.createElement('template')
    t.innerHTML = html.trim()
    return t.content.firstElementChild
  }
  function baseName(p) {
    if (!p) return ''
    const parts = String(p).split(/[\\/]/).filter(Boolean)
    return parts[parts.length - 1] || p
  }
  function fmtDuration(ms) {
    if (ms == null) return ''
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)}초`
    return `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`
  }
  function fmtAgo(ts) {
    const d = (Date.now() - ts) / 1000
    if (d < 60) return '방금'
    if (d < 3600) return `${Math.floor(d / 60)}분 전`
    if (d < 86400) return `${Math.floor(d / 3600)}시간 전`
    if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`
    return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }
  function toast(message, level = 'info') {
    const t = el(`<div class="toast ${level}">${esc(message)}</div>`)
    $('#toasts').appendChild(t)
    setTimeout(() => t.classList.add('hide'), 4200)
    setTimeout(() => t.remove(), 4700)
  }
  function isRunning(convId) {
    return Boolean(convId && state.running[convId])
  }
  function modelLabel(agent, id) {
    const info = state.agents[agent]
    const found = info && info.models && info.models.find((m) => m.id === id)
    return found ? found.label : id
  }
  function toolSummary(input) {
    if (input == null) return ''
    if (typeof input !== 'object') return String(input)
    const keys = ['command', 'CommandLine', 'file_path', 'AbsolutePath', 'TargetFile', 'path', 'Path', 'pattern', 'Query', 'query', 'url', 'Url', 'description', 'prompt']
    for (const k of keys) if (typeof input[k] === 'string' && input[k]) return input[k]
    for (const v of Object.values(input)) if (typeof v === 'string' && v) return v
    return ''
  }

  // ── 사이드바 ──────────────────────────────────────────
  function renderSidebar() {
    const list = $('#conv-list')
    list.innerHTML = ''
    if (!state.conversations.length) {
      list.appendChild(el('<div class="conv-empty">아직 대화가 없습니다</div>'))
    }
    for (const c of state.conversations) {
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
      list.appendChild(item)
    }
    renderAgentStatus()
  }

  function renderAgentStatus() {
    const box = $('#agent-status')
    box.innerHTML = AGENTS.map((a) => {
      const info = state.agents[a] || {}
      const ok = info.available
      return `<div class="agent-line agent-${a}" title="${esc(info.path || '설치되지 않음')}">
        <span class="avatar sm">${ICON[a]}</span><span>${LABEL[a]}</span>
        <span class="ver ${ok ? '' : 'missing'}">${ok ? esc(info.version || '확인 중…') : '찾을 수 없음'}</span>
      </div>`
    }).join('')
  }

  // ── 헤더 ──────────────────────────────────────────────
  function currentCwd() {
    return state.current ? state.current.cwd : state.draftCwd
  }
  function renderHeader() {
    const conv = state.current
    $('#conv-title').textContent = conv ? conv.title : '새 대화'
    document.title = conv ? `${conv.title} — Orca Duo` : 'Orca Duo'
    const cwd = currentCwd()
    $('#folder-chip .folder-name').textContent = baseName(cwd) || '폴더 선택'
    $('#folder-chip').title = cwd || ''
    const sess = $('#session-badges')
    sess.innerHTML = ''
    if (conv) {
      for (const a of AGENTS) {
        if (conv.sessions[a]) {
          sess.appendChild(
            el(`<span class="sess agent-${a}" title="${LABEL[a]} 세션 ${esc(conv.sessions[a])}">${ICON[a]}<span>세션</span></span>`)
          )
        }
      }
    }
  }

  // ── 메시지 ────────────────────────────────────────────
  function partHtml(msg, part, index) {
    const key = `${msg.id}:${index}`
    const open = openDetails.has(key) ? ' open' : ''
    if (part.kind === 'text') {
      return `<div class="md">${window.renderMarkdown(part.text)}</div>`
    }
    if (part.kind === 'thinking') {
      if (!part.text.trim()) return ''
      return `<details class="thinking" data-key="${key}"${open}><summary>생각 과정</summary><div class="md">${window.renderMarkdown(part.text)}</div></details>`
    }
    if (part.kind === 'tool') {
      const summary = toolSummary(part.input)
      const input = part.input == null ? '' : JSON.stringify(part.input, null, 2)
      return `<details class="tool ${part.status}" data-key="${key}"${open}>
        <summary><span class="tool-state"></span><span class="tool-name">${esc(part.name || 'tool')}</span><span class="tool-arg">${esc(summary.slice(0, 140))}</span></summary>
        <div class="tool-body">
          ${input ? `<div class="tool-label">입력</div><pre>${esc(input)}</pre>` : ''}
          ${part.output ? `<div class="tool-label">결과</div><pre>${esc(part.output)}</pre>` : ''}
        </div>
      </details>`
    }
    return ''
  }

  function metaHtml(msg) {
    const m = msg.meta || {}
    const bits = []
    const model = m.resolvedModel || (m.model && m.model !== 'default' ? modelLabel(msg.agent, m.model) : '')
    if (model) bits.push(esc(model))
    if (msg.status === 'streaming') {
      bits.push(`<span class="elapsed" data-started="${msg.createdAt}"></span>`)
    } else {
      if (m.durationMs) bits.push(fmtDuration(m.durationMs))
      if (m.tokens) bits.push(`${Number(m.tokens).toLocaleString('ko-KR')} 토큰`)
      if (m.costUsd) bits.push(`$${Number(m.costUsd).toFixed(4)}`)
      if (msg.status === 'stopped') bits.push('<span class="tag">멈춤</span>')
    }
    return bits.join('<span class="sep">·</span>')
  }

  function messageEl(msg) {
    if (msg.role === 'system') {
      return el(`<div class="msg system" data-id="${msg.id}"><span>${esc(msg.text)}</span></div>`)
    }
    if (msg.role === 'user') {
      const handoff = msg.handoffCount
        ? `<div class="handoff">↪ ${LABEL[OTHER[msg.agent]]} 쪽 대화 ${msg.handoffCount}개를 함께 전달</div>`
        : ''
      if (msg.auto) {
        const key = `${msg.id}:auto`
        return el(
          `<div class="msg relay agent-${msg.agent}" data-id="${msg.id}">
            <details data-key="${key}"${openDetails.has(key) ? ' open' : ''}>
              <summary><span class="relay-pill">⇄ 자동 핑퐁 → ${LABEL[msg.agent]}</span></summary>
              <div class="relay-text">${esc(msg.text)}</div>
            </details>
            ${handoff}
          </div>`
        )
      }
      return el(
        `<div class="msg user agent-${msg.agent}" data-id="${msg.id}">
          <div class="to-pill"><span class="avatar xs">${ICON[msg.agent]}</span>${LABEL[msg.agent]}에게</div>
          <div class="bubble">${esc(msg.text)}</div>
          ${handoff}
        </div>`
      )
    }
    // assistant
    const body = msg.parts.map((p, i) => partHtml(msg, p, i)).join('')
    const waiting =
      msg.status === 'streaming' && !msg.parts.some((p) => (p.kind === 'text' && p.text.trim()) || p.kind === 'tool')
        ? `<div class="waiting"><span class="pulse"></span>${LABEL[msg.agent]}가 응답하는 중…</div>`
        : ''
    const error = msg.status === 'error' ? `<div class="error-box"><b>오류</b><pre>${esc(msg.error || '')}</pre></div>` : ''
    const blank =
      msg.status === 'done' && !msg.parts.some((p) => p.kind === 'text' && p.text.trim())
        ? '<div class="blank-reply">(답변 텍스트 없음)</div>'
        : ''
    const denied =
      msg.meta && msg.meta.deniedTools && msg.meta.deniedTools.length
        ? `<div class="warn-box">권한이 없어 막힌 도구: <b>${esc(msg.meta.deniedTools.join(', '))}</b> — 권한을 ‘전체 자동’으로 바꾸고 다시 요청하세요.</div>`
        : ''
    const actions =
      msg.status === 'streaming'
        ? ''
        : `<div class="actions">
            <button class="act copy" title="답변 복사">복사</button>
            <button class="act pass agent-${OTHER[msg.agent]}" title="${LABEL[OTHER[msg.agent]]}에게 이 답변 검토 맡기기">↪ ${LABEL[OTHER[msg.agent]]}에게 넘기기</button>
          </div>`
    const node = el(
      `<div class="msg assistant agent-${msg.agent} ${msg.status}" data-id="${msg.id}">
        <div class="msg-head"><span class="avatar">${ICON[msg.agent]}</span><span class="name">${LABEL[msg.agent]}</span></div>
        <div class="msg-body">${body}${waiting}${blank}${error}${denied}${msg.status === 'streaming' && !waiting ? '<span class="cursor"></span>' : ''}</div>
        <div class="msg-foot"><span class="meta">${metaHtml(msg)}</span>${actions}</div>
      </div>`
    )
    const copy = node.querySelector('.act.copy')
    if (copy) {
      copy.addEventListener('click', () => {
        const text = msg.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n')
        navigator.clipboard.writeText(text).then(() => toast('복사했습니다'))
      })
    }
    const pass = node.querySelector('.act.pass')
    if (pass) {
      pass.addEventListener('click', () => {
        setTarget(OTHER[msg.agent])
        const input = $('#input')
        input.value = `위 ${LABEL[msg.agent]}의 답변을 검토하고, 틀리거나 빠진 부분은 바로잡아서 이어서 진행해줘.`
        autosize()
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      })
    }
    return node
  }

  function emptyStateEl() {
    const cards = AGENTS.map((a) => {
      const info = state.agents[a] || {}
      return `<button class="agent-card agent-${a}${state.target === a ? ' selected' : ''}${info.available ? '' : ' missing'}" data-agent="${a}">
        <span class="avatar lg">${ICON[a]}</span>
        <span class="card-name">${LABEL[a]}</span>
        <span class="card-sub">${info.available ? esc(info.version || '') : 'CLI를 찾을 수 없음'}</span>
      </button>`
    }).join('<span class="swap">⇄</span>')
    const node = el(
      `<div class="empty">
        <h1>누구에게 먼저 물어볼까요?</h1>
        <p class="lead">한 대화창에서 Claude와 Antigravity에게 번갈아 보낼 수 있어요.<br>상대 에이전트가 나눈 대화는 다음 차례에 자동으로 전달됩니다.</p>
        <div class="agent-cards">${cards}</div>
        <div class="tips">
          <span><kbd>Tab</kbd> 대상 전환</span>
          <span><kbd>@agy</kbd> <kbd>@claude</kbd> 로 바로 지정</span>
          <span>⇄ 자동 번갈기 · 핑퐁으로 서로 검토</span>
        </div>
      </div>`
    )
    node.querySelectorAll('.agent-card').forEach((b) =>
      b.addEventListener('click', () => {
        setTarget(b.dataset.agent)
        $('#input').focus()
      })
    )
    return node
  }

  function nearBottom() {
    const box = $('#messages')
    return box.scrollHeight - box.scrollTop - box.clientHeight < 160
  }
  function scrollToBottom() {
    const box = $('#messages')
    box.scrollTop = box.scrollHeight
  }

  function renderMessages() {
    const box = $('#messages')
    box.innerHTML = ''
    const conv = state.current
    if (!conv || !conv.messages.length) {
      box.appendChild(emptyStateEl())
      return
    }
    const inner = el('<div class="thread"></div>')
    for (const m of conv.messages) inner.appendChild(messageEl(m))
    box.appendChild(inner)
    scrollToBottom()
    tickElapsed()
  }

  function upsertMessage(msg) {
    const conv = state.current
    const idx = conv.messages.findIndex((m) => m.id === msg.id)
    if (idx === -1) conv.messages.push(msg)
    else conv.messages[idx] = msg
    const thread = $('#messages .thread')
    if (!thread) return renderMessages()
    const stick = nearBottom()
    const existing = thread.querySelector(`[data-id="${msg.id}"]`)
    const node = messageEl(msg)
    if (existing) existing.replaceWith(node)
    else thread.appendChild(node)
    if (stick || idx === -1) scrollToBottom()
    tickElapsed()
  }

  function tickElapsed() {
    document.querySelectorAll('.elapsed[data-started]').forEach((n) => {
      const s = Math.max(0, Math.floor((Date.now() - Number(n.dataset.started)) / 1000))
      n.textContent = s < 60 ? `${s}초째` : `${Math.floor(s / 60)}분 ${s % 60}초째`
    })
  }
  setInterval(tickElapsed, 1000)

  // ── 입력창 ────────────────────────────────────────────
  function setTarget(agent) {
    state.target = agent
    savePrefs()
    renderComposer()
    document.querySelectorAll('.agent-card').forEach((c) => c.classList.toggle('selected', c.dataset.agent === agent))
  }

  function renderComposer() {
    const t = state.target
    const composer = $('#composer')
    composer.dataset.agent = t
    document.querySelectorAll('#target-switch button').forEach((b) => {
      const on = b.dataset.agent === t
      b.classList.toggle('on', on)
      b.setAttribute('aria-checked', String(on))
    })
    $('#input').placeholder = `${LABEL[t]}에게 메시지 보내기…`

    const info = state.agents[t] || {}
    const models = (info.models && info.models.length ? info.models : [{ id: 'default', label: '기본값' }]).slice()
    const pref = state.prefs[t]
    if (!models.some((m) => m.id === pref.model)) models.push({ id: pref.model, label: pref.model })
    $('#model-select').innerHTML = models
      .map((m) => `<option value="${esc(m.id)}"${m.id === pref.model ? ' selected' : ''}>${esc(m.label)}</option>`)
      .join('')
    $('#perm-select').innerHTML = PERMISSIONS.map(
      (p) => `<option value="${p.id}"${p.id === pref.permission ? ' selected' : ''} title="${esc(p.hint)}">${p.label}</option>`
    ).join('')
    $('#perm-select').dataset.level = pref.permission
    $('#perm-select').title = (PERMISSIONS.find((p) => p.id === pref.permission) || {}).hint || ''

    $('#alt-toggle').classList.toggle('on', state.autoAlternate)
    $('#alt-toggle').setAttribute('aria-pressed', String(state.autoAlternate))
    $('#relay-select').value = String(state.relayRounds)

    const running = state.current && isRunning(state.current.id)
    const btn = $('#send')
    btn.classList.toggle('stop', Boolean(running))
    btn.title = running ? '멈추기 (Esc)' : '보내기 (Enter)'
    btn.setAttribute('aria-label', btn.title)
    btn.innerHTML = running
      ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    $('#composer-status').innerHTML = running
      ? `<span class="pulse"></span>${state.running[state.current.id] === 'relay' ? '핑퐁 넘기는 중' : `${LABEL[state.running[state.current.id]] || ''} 응답 중`}`
      : ''
  }

  function autosize() {
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

  async function stop() {
    if (!state.current) return
    try {
      await api('POST', `/api/conversations/${state.current.id}/stop`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // ── 대화 열기 / 새 대화 ────────────────────────────────
  async function openConversation(id) {
    try {
      state.current = await api('GET', `/api/conversations/${id}`)
      remember('duo.lastConv', id)
      renderAll()
      $('#input').focus()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function newConversation() {
    state.current = null
    state.draftCwd = state.settings.lastCwd || state.draftCwd
    remember('duo.lastConv', '')
    renderAll()
    $('#input').focus()
    document.body.classList.remove('sidebar-open')
  }

  function renderAll() {
    renderSidebar()
    renderHeader()
    renderMessages()
    renderComposer()
  }

  // ── 폴더 ──────────────────────────────────────────────
  async function browseFolder(initial) {
    if (window.duoDesktop && window.duoDesktop.pickFolder) return window.duoDesktop.pickFolder(initial)
    const res = await api('POST', '/api/pick-folder', { initial })
    return res.path
  }

  function openFolderDialog() {
    const dlg = $('#folder-dialog')
    const input = $('#folder-input')
    input.value = currentCwd() || ''
    const recent = [...new Set(state.conversations.map((c) => c.cwd).filter(Boolean))].slice(0, 8)
    $('#folder-recent').innerHTML = recent.length
      ? '<div class="recent-label">최근 폴더</div>' +
        recent.map((p) => `<button type="button" class="recent" data-path="${esc(p)}" title="${esc(p)}"><b>${esc(baseName(p))}</b><span>${esc(p)}</span></button>`).join('')
      : ''
    $('#folder-recent').querySelectorAll('.recent').forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.dataset.path
      })
    )
    $('#folder-warn').hidden = !(state.current && state.current.messages.length)
    dlg.showModal()
    input.focus()
    input.select()
  }

  async function applyFolder() {
    const raw = $('#folder-input').value.trim()
    if (!raw) return
    const check = await api('POST', '/api/check-folder', { path: raw })
    if (!check.ok) {
      toast(`폴더가 없어요: ${check.path}`, 'error')
      return false
    }
    if (state.current) {
      if (check.path !== state.current.cwd) {
        state.current = await api('PATCH', `/api/conversations/${state.current.id}`, { cwd: check.path })
      }
    } else {
      state.draftCwd = check.path
    }
    renderAll()
    return true
  }

  // ── 설정 ──────────────────────────────────────────────
  function openSettings() {
    $('#set-relay').value = state.settings.relayPrompt || ''
    $('#set-claude').value = state.settings.claudePath || ''
    $('#set-agy').value = state.settings.antigravityPath || ''
    $('#set-failover').checked = state.settings.autoFailover !== false
    $('#set-claude').placeholder = (state.agents.claude || {}).path || '자동 감지 (PATH의 claude)'
    $('#set-agy').placeholder = (state.agents.antigravity || {}).path || '자동 감지 (PATH의 agy)'
    $('#set-datadir').textContent = state.dataDir
    $('#settings-dialog').showModal()
  }

  async function saveSettings() {
    try {
      const res = await api('POST', '/api/settings', {
        relayPrompt: $('#set-relay').value,
        claudePath: $('#set-claude').value,
        antigravityPath: $('#set-agy').value,
        autoFailover: $('#set-failover').checked
      })
      state.settings = res.settings
      state.agents = res.agents
      renderAll()
      toast('설정을 저장했습니다')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // ── 이벤트 스트림 ─────────────────────────────────────
  function connectEvents() {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`)
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
      case 'running': {
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
        return
      }
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

  async function resync() {
    try {
      const s = await api('GET', '/api/state')
      applyState(s)
      if (state.current) state.current = await api('GET', `/api/conversations/${state.current.id}`).catch(() => null)
      renderAll()
    } catch {}
  }

  function applyState(s) {
    state.conversations = s.conversations
    state.agents = s.agents
    state.settings = s.settings
    state.dataDir = s.dataDir
    state.running = {}
    for (const [id, agent] of Object.entries(s.running || {})) state.running[id] = agent || 'relay'
    if (!state.draftCwd) state.draftCwd = s.settings.lastCwd
  }

  // ── 바인딩 ────────────────────────────────────────────
  function bind() {
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.current && isRunning(state.current.id) && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        stop()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault()
        newConversation()
      }
    })
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
    $('#model-select').addEventListener('change', (e) => {
      state.prefs[state.target].model = e.target.value
      savePrefs()
    })
    $('#perm-select').addEventListener('change', (e) => {
      state.prefs[state.target].permission = e.target.value
      savePrefs()
      renderComposer()
      if (e.target.value === 'full') toast(`${LABEL[state.target]}가 확인 없이 명령까지 실행합니다`, 'warn')
    })
    $('#alt-toggle').addEventListener('click', () => {
      state.autoAlternate = !state.autoAlternate
      savePrefs()
      renderComposer()
      toast(state.autoAlternate ? '보낼 때마다 대상이 자동으로 바뀝니다' : '자동 번갈기를 껐습니다')
    })
    $('#relay-select').addEventListener('change', (e) => {
      state.relayRounds = Number(e.target.value) || 0
      if (state.relayRounds) toast(`답변이 끝나면 상대에게 ${state.relayRounds}번 자동으로 넘겨 검토시킵니다`)
    })
    $('#new-chat').addEventListener('click', newConversation)
    $('#toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'))
    $('#scrim').addEventListener('click', () => document.body.classList.remove('sidebar-open'))
    $('#folder-chip').addEventListener('click', openFolderDialog)
    $('#folder-browse').addEventListener('click', async () => {
      try {
        const picked = await browseFolder($('#folder-input').value || currentCwd())
        if (picked) $('#folder-input').value = picked
      } catch (err) {
        toast(err.message, 'error')
      }
    })
    $('#folder-form').addEventListener('submit', async (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return
      e.preventDefault()
      try {
        if (await applyFolder()) $('#folder-dialog').close()
      } catch (err) {
        toast(err.message, 'error')
      }
    })
    $('#open-settings').addEventListener('click', openSettings)
    $('#settings-form').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return
      saveSettings()
    })
    $('#open-folder').addEventListener('click', () => {
      const p = currentCwd()
      if (p) api('POST', '/api/open-path', { path: p }).catch((err) => toast(err.message, 'error'))
    })

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

    // 접힘 상태 기억, 코드 복사, 파일 링크
    $('#messages').addEventListener(
      'toggle',
      (e) => {
        const d = e.target
        if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return
        if (d.open) openDetails.add(d.dataset.key)
        else openDetails.delete(d.dataset.key)
      },
      true
    )
    $('#messages').addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-code')
      if (copyBtn) {
        const code = copyBtn.closest('.code').querySelector('code').textContent
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '복사됨'
          setTimeout(() => (copyBtn.textContent = '복사'), 1200)
        })
        return
      }
      const fileLink = e.target.closest('a.file-link')
      if (fileLink) {
        e.preventDefault()
        let p = decodeURIComponent(fileLink.getAttribute('href').replace(/^file:\/\/\/?/i, ''))
        p = p.replace(/#.*$/, '')
        if (/^[a-z]:\//i.test(p)) p = p.replace(/\//g, '\\')
        api('POST', '/api/open-path', { path: p }).catch((err) => toast(err.message, 'error'))
      }
    })
    window.addEventListener('resize', autosize)
  }

  // ── 시작 ──────────────────────────────────────────────
  async function boot() {
    loadPrefs()
    bind()
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
})()
