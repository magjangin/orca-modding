// 화면 모듈들이 함께 쓰는 상수·상태·저장·API·작은 도우미.
import { escapeHtml } from './markdown.js'

export const esc = escapeHtml
export const $ = (sel) => document.querySelector(sel)

const TOKEN = document.querySelector('meta[name="duo-token"]').content
export const AGENTS = ['claude', 'antigravity']
export const LABEL = { claude: 'Claude', antigravity: 'Antigravity' }
export const OTHER = { claude: 'antigravity', antigravity: 'claude' }
export const ICON = {
  claude:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/></g></svg>',
  antigravity:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5 12 5l7.5 14.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15.2" r="2.1" fill="currentColor"/></svg>'
}
// 노력(effort) 단계 — 서버 agents/shared.js의 EFFORT_LEVELS와 같은 순서.
export const EFFORT_LABEL = { low: '낮음', medium: '중간', high: '높음', xhigh: '엑스트라', max: '최대' }

// ── 상태 ──────────────────────────────────────────────
export const state = {
  agents: {},
  conversations: [],
  settings: {},
  running: {},
  current: null,
  draftCwd: '',
  dataDir: '',
  target: 'claude',
  prefs: {
    claude: { model: 'default', effort: 'default', permission: 'edit' },
    antigravity: { model: 'default', effort: 'default', permission: 'edit' }
  },
  autoAlternate: true,
  relayRounds: 0
}

export function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('duo.prefs') || 'null')
    if (saved) {
      if (AGENTS.includes(saved.target)) state.target = saved.target
      for (const a of AGENTS) if (saved.prefs && saved.prefs[a]) Object.assign(state.prefs[a], saved.prefs[a])
      if (typeof saved.autoAlternate === 'boolean') state.autoAlternate = saved.autoAlternate
    }
  } catch {}
}
export function savePrefs() {
  try {
    localStorage.setItem(
      'duo.prefs',
      JSON.stringify({ target: state.target, prefs: state.prefs, autoAlternate: state.autoAlternate })
    )
  } catch {}
}
export function remember(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
export function recall(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function isRunning(convId) {
  return Boolean(convId && state.running[convId])
}
export function currentCwd() {
  return state.current ? state.current.cwd : state.draftCwd
}

// ── API ───────────────────────────────────────────────
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'x-duo-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}
export function eventsUrl() {
  return `/api/events?token=${encodeURIComponent(TOKEN)}`
}

// ── 유틸 ──────────────────────────────────────────────
export function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}
export function baseName(p) {
  if (!p) return ''
  const parts = String(p).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}
export function fmtDuration(ms) {
  if (ms == null) return ''
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}초`
  return `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`
}
export function fmtAgo(ts) {
  const d = (Date.now() - ts) / 1000
  if (d < 60) return '방금'
  if (d < 3600) return `${Math.floor(d / 60)}분 전`
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}
export function toast(message, level = 'info') {
  const t = el(`<div class="toast ${level}">${esc(message)}</div>`)
  $('#toasts').appendChild(t)
  setTimeout(() => t.classList.add('hide'), 4200)
  setTimeout(() => t.remove(), 4700)
}
