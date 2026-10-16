// 대화 본문: 메시지 그리기, 스트리밍 갱신, 경과 시간, 코드 복사·파일 링크.
import { $, esc, el, state, AGENTS, LABEL, OTHER, ICON, EFFORT_LABEL, api, fmtDuration, currentCwd, toast } from './core.js'
import { renderMarkdown } from './markdown.js'
import { autosize, setTarget } from './composer.js'

// 사용자가 펼친 도구·생각 블록. 스트리밍으로 다시 그려도 펼침을 유지한다.
const openDetails = new Set()

// CLI가 알려 준 실제 모델 ID(`claude-opus-5-5`, `gemini-4-argon-low`)도 목록의 표시 이름(`Opus 5.5`)으로 바꾼다.
function modelLabel(agent, id) {
  const models = (state.agents[agent] || {}).models || []
  const found = models.find(
    (m) => m.id !== 'default' && (m.id === id || m.resolved === id || (m.variants && Object.values(m.variants).includes(id)))
  )
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

function partHtml(msg, part, index) {
  const key = `${msg.id}:${index}`
  const open = openDetails.has(key) ? ' open' : ''
  if (part.kind === 'text') {
    return `<div class="md">${renderMarkdown(part.text)}</div>`
  }
  if (part.kind === 'thinking') {
    if (!part.text.trim()) return ''
    return `<details class="thinking" data-key="${key}"${open}><summary>생각 과정</summary><div class="md">${renderMarkdown(part.text)}</div></details>`
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
  const model = m.resolvedModel || (m.model !== 'default' && m.model)
  if (model) bits.push(esc(modelLabel(msg.agent, model)))
  if (m.effort) bits.push(`노력 ${EFFORT_LABEL[m.effort] || esc(m.effort)}`)
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

function userMessageEl(msg) {
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

function assistantMessageEl(msg) {
  const body = msg.parts.map((p, i) => partHtml(msg, p, i)).join('')
  const waiting =
    msg.status === 'streaming' && !msg.parts.some((p) => (p.kind === 'text' && p.text.trim()) || p.kind === 'tool')
      ? `<div class="waiting"><span class="pulse"></span>${LABEL[msg.agent]}가 응답하는 중…</div>`
      : ''
  const error = msg.status === 'error' ? `<div class="error-box"><b>오류</b><pre>${esc(msg.error || '')}</pre></div>` : ''
  const blank =
    msg.status === 'done' && !msg.parts.some((p) => (p.kind === 'text' && p.text.trim()) || p.kind === 'tool')
      ? '<div class="blank-reply">(답변 텍스트 없음)</div>'
      : ''
  const denied =
    msg.meta && msg.meta.deniedTools && msg.meta.deniedTools.length
      ? `<div class="warn-box">권한이 없어 막힌 도구: <b>${esc(msg.meta.deniedTools.join(', '))}</b> — 권한을 ‘전체 자동’으로 바꾸고 다시 요청하세요.</div>`
      : ''
  const other = OTHER[msg.agent]
  const actions =
    msg.status === 'streaming'
      ? ''
      : `<div class="actions">
          <button class="act copy" title="답변 복사">복사</button>
          <button class="act pass agent-${other}" title="${LABEL[other]}에게 이 답변 검토 맡기기">↪ ${LABEL[other]}에게 넘기기</button>
        </div>`
  return el(
    `<div class="msg assistant agent-${msg.agent} ${msg.status}" data-id="${msg.id}">
      <div class="msg-head"><span class="avatar">${ICON[msg.agent]}</span><span class="name">${LABEL[msg.agent]}</span></div>
      <div class="msg-body">${body}${waiting}${blank}${error}${denied}${msg.status === 'streaming' && !waiting ? '<span class="cursor"></span>' : ''}</div>
      <div class="msg-foot"><span class="meta">${metaHtml(msg)}</span>${actions}</div>
    </div>`
  )
}

// 답변 아래 버튼: 복사, 상대에게 검토 맡기기.
function onMessageAction(btn) {
  const id = btn.closest('.msg').dataset.id
  const msg = state.current && state.current.messages.find((m) => m.id === id)
  if (!msg) return
  if (btn.classList.contains('copy')) {
    const text = msg.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n')
    navigator.clipboard.writeText(text).then(() => toast('복사했습니다'))
  } else if (btn.classList.contains('pass')) {
    setTarget(OTHER[msg.agent])
    const input = $('#input')
    input.value = `위 ${LABEL[msg.agent]}의 답변을 검토하고, 틀리거나 빠진 부분은 바로잡아서 이어서 진행해줘.`
    autosize()
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }
}

function messageEl(msg) {
  if (msg.role === 'system') {
    return el(`<div class="msg system" data-id="${msg.id}"><span>${esc(msg.text)}</span></div>`)
  }
  return msg.role === 'user' ? userMessageEl(msg) : assistantMessageEl(msg)
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
  return el(
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
}

function nearBottom() {
  const box = $('#messages')
  return box.scrollHeight - box.scrollTop - box.clientHeight < 160
}
function scrollToBottom() {
  const box = $('#messages')
  box.scrollTop = box.scrollHeight
}

export function renderMessages() {
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

export function upsertMessage(msg) {
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

function openFileLink(link) {
  let p = decodeURIComponent(link.getAttribute('href').replace(/^file:\/\/\/?/i, ''))
  p = p.replace(/#.*$/, '')
  if (/^[a-z]:\//i.test(p)) p = p.replace(/\//g, '\\')
  api('POST', '/api/open-path', { path: p, cwd: currentCwd() }).catch((err) => toast(err.message, 'error'))
}

export function bindMessages() {
  setInterval(tickElapsed, 1000)
  const box = $('#messages')
  box.addEventListener(
    'toggle',
    (e) => {
      const d = e.target
      if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return
      if (d.open) openDetails.add(d.dataset.key)
      else openDetails.delete(d.dataset.key)
    },
    true
  )
  // Why: 스트리밍 중에는 메시지 노드를 계속 새로 그리므로, 버튼 이벤트는 노드마다 달지 않고 여기서 한 번에 받는다.
  box.addEventListener('click', (e) => {
    const card = e.target.closest('.agent-card')
    if (card) {
      setTarget(card.dataset.agent)
      $('#input').focus()
      return
    }
    const act = e.target.closest('.act')
    if (act) return onMessageAction(act)
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
      openFileLink(fileLink)
    }
  })
}
