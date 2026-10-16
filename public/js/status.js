// 사용량 · MCP 창: 에이전트별 남은 사용 한도(쿼터)와 쓸 수 있는 MCP 서버 목록.
import { $, esc, state, AGENTS, LABEL, ICON, api, currentCwd, fmtUntil } from './core.js'

const MCP_STATUS = {
  connected: ['연결됨', 'good'],
  failed: ['연결 실패', 'danger'],
  'needs-auth': ['인증 필요', 'warn'],
  pending: ['연결 중', 'muted'],
  enabled: ['켜짐', 'good'],
  disabled: ['꺼짐', 'muted']
}
// agy는 `mcp list`에서 연결을 확인하지 않고 설정 상태만 알려 준다.
const MCP_NOTE = { antigravity: '설정에서 켜고 끈 상태만 보여 줍니다 (연결 확인 없음)' }

let loadSeq = 0

const tone = (pct) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok')
const fmtPct = (pct) => `${Math.round(pct * 10) / 10}%`
const loadingHtml = () => '<p class="status-empty"><span class="spin"></span>확인 중…</p>'
const emptyHtml = (text) => `<p class="status-empty">${esc(text)}</p>`
const errorHtml = (text) => `<p class="status-error">${esc(text)}</p>`

function windowHtml(w) {
  const pct = Math.max(0, Math.min(100, Number(w.usedPercent) || 0))
  const reset = w.resetsAt
    ? `<span class="quota-reset" title="${esc(new Date(w.resetsAt).toLocaleString('ko-KR'))}">${fmtUntil(w.resetsAt)} 초기화</span>`
    : ''
  return `<div class="quota">
    <div class="quota-top"><span>${esc(w.label)}</span><span class="quota-pct tone-${tone(pct)}">${fmtPct(pct)} 사용</span></div>
    <div class="quota-bar"><i class="tone-${tone(pct)}" style="width:${pct}%"></i></div>
    ${reset}
  </div>`
}

function usageHtml(u) {
  if (u.error) return errorHtml(u.error)
  const groups = u.groups
    .map((g) => (g.name ? `<div class="quota-group"${g.hint ? ` title="${esc(g.hint)}"` : ''}>${esc(g.name)}</div>` : '') + g.windows.map(windowHtml).join(''))
    .join('')
  const notes = u.notes.map((n) => `<p class="status-note">${esc(n)}</p>`).join('')
  return groups || notes ? groups + notes : emptyHtml('한도 정보가 없습니다')
}

function mcpHtml(agent, m) {
  if (m.error) return errorHtml(m.error)
  if (!m.servers.length) return emptyHtml('설정된 MCP 서버가 없습니다')
  const rows = m.servers
    .map((s) => {
      const [label, t] = MCP_STATUS[s.status] || [s.status, 'muted']
      return `<li title="${esc(s.target)}">
        <span class="mcp-dot tone-${t}"></span><span class="mcp-name">${esc(s.name)}</span>
        <span class="mcp-type">${esc(s.type)}</span><span class="mcp-state tone-${t}">${label}</span>
        <small class="mcp-target">${esc(s.target)}</small>
        ${s.detail ? `<small class="mcp-detail" title="${esc(s.detail)}">${esc(s.detail)}</small>` : ''}
      </li>`
    })
    .join('')
  return `<ul class="mcp-list">${rows}</ul>${MCP_NOTE[agent] ? `<p class="status-note">${MCP_NOTE[agent]}</p>` : ''}`
}

const PLUGIN_STATUS = {
  enabled: ['켜짐', 'good'],
  loaded: ['로드됨', 'good'],
  active: ['활성', 'good'],
  disabled: ['꺼짐', 'muted']
}

function pluginsHtml(p) {
  if (p.error) return errorHtml(p.error)
  if (!p.plugins || !p.plugins.length) return emptyHtml('설치된 플러그인이 없습니다')
  const rows = p.plugins
    .map((item) => {
      const [label, t] = PLUGIN_STATUS[item.status] || [item.status, 'good']
      return `<li>
        <span class="mcp-dot tone-${t}"></span>
        <span class="plugin-name">${esc(item.name)}</span>
        ${item.version ? `<span class="plugin-ver">${esc(item.version)}</span>` : ''}
        <span class="mcp-state tone-${t}">${label}</span>
        ${item.detail ? `<small class="plugin-detail">${esc(item.detail)}</small>` : ''}
      </li>`
    })
    .join('')
  return `<ul class="plugin-list">${rows}</ul>`
}

function columnHtml(agent) {
  return `<section class="status-col agent-${agent}" data-agent="${agent}">
    <header class="status-col-head"><span class="avatar sm">${ICON[agent]}</span><b>${LABEL[agent]}</b><span class="status-plan"></span></header>
    <h4>남은 사용량</h4>
    <div class="status-usage"></div>
    <h4>MCP 서버 <span class="status-count"></span></h4>
    <div class="status-mcp"></div>
    <h4>플러그인 · 스킬 <span class="status-plugin-count"></span></h4>
    <div class="status-plugins"></div>
  </section>`
}

async function fetchOr(url) {
  try {
    return await api('GET', url)
  } catch (err) {
    return { error: err.message }
  }
}

/** 두 에이전트의 사용량·MCP·플러그인을 동시에 불러와, 오는 대로 칸을 채운다. force면 서버 캐시를 건너뛴다. */
function load(force) {
  const seq = ++loadSeq
  const refresh = force ? 'refresh=1' : ''
  const cwd = encodeURIComponent(currentCwd() || '')
  for (const agent of AGENTS) {
    const col = $(`#status-grid [data-agent="${agent}"]`)
    const usageBox = col.querySelector('.status-usage')
    const mcpBox = col.querySelector('.status-mcp')
    const pluginBox = col.querySelector('.status-plugins')
    if (!(state.agents[agent] || {}).available) {
      usageBox.innerHTML = mcpBox.innerHTML = pluginBox.innerHTML = emptyHtml('CLI를 찾을 수 없습니다')
      continue
    }
    usageBox.innerHTML = mcpBox.innerHTML = pluginBox.innerHTML = loadingHtml()
    col.querySelector('.status-count').textContent = ''
    col.querySelector('.status-plugin-count').textContent = ''
    fetchOr(`/api/agents/${agent}/usage?${refresh}`).then((u) => {
      if (seq !== loadSeq) return
      usageBox.innerHTML = usageHtml(u)
      col.querySelector('.status-plan').textContent = u.plan || ''
    })
    fetchOr(`/api/agents/${agent}/mcp?cwd=${cwd}&${refresh}`).then((m) => {
      if (seq !== loadSeq) return
      mcpBox.innerHTML = mcpHtml(agent, m)
      if (m.servers) col.querySelector('.status-count').textContent = String(m.servers.length)
    })
    fetchOr(`/api/agents/${agent}/plugins?${refresh}`).then((p) => {
      if (seq !== loadSeq) return
      pluginBox.innerHTML = pluginsHtml(p)
      if (p.plugins) col.querySelector('.status-plugin-count').textContent = String(p.plugins.length)
    })
  }
}

export function openStatusDialog() {
  $('#status-grid').innerHTML = AGENTS.map(columnHtml).join('')
  $('#status-dialog').showModal()
  load(false)
}

export function bindStatus() {
  $('#open-status').addEventListener('click', openStatusDialog)
  $('#status-refresh').addEventListener('click', () => load(true))
}
