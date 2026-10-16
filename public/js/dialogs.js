// 작업 폴더 대화상자와 설정 대화상자.
import { $, esc, state, api, baseName, currentCwd, toast } from './core.js'
import { renderAll } from './main.js'

// ── 작업 폴더 ─────────────────────────────────────────
let allRepos = []

async function browseFolder(initial) {
  if (window.duoDesktop && window.duoDesktop.pickFolder) return window.duoDesktop.pickFolder(initial)
  const res = await api('POST', '/api/pick-folder', { initial })
  return res.path
}

async function loadReposList() {
  const section = $('#folder-repos-section')
  try {
    const data = await api('GET', '/api/list-repos')
    allRepos = data.repos || []
    section.hidden = !allRepos.length
    if (!allRepos.length) return
    $('#folder-repos-label').textContent = `${data.root || 'H:\\source\\repos'} 하위 프로젝트`
    renderReposList('')
  } catch {
    section.hidden = true
  }
}

function renderReposList(filterText) {
  const q = filterText.toLowerCase().trim()
  const filtered = allRepos.filter((r) => !q || r.name.toLowerCase().includes(q))
  $('#folder-repos-list').innerHTML = filtered.length
    ? filtered.map((r) => `<button type="button" class="recent repo-item" data-path="${esc(r.path)}"><b>${esc(r.name)}</b></button>`).join('')
    : '<div class="repos-empty">일치하는 프로젝트가 없습니다</div>'
}

export function openFolderDialog() {
  const input = $('#folder-input')
  input.value = currentCwd() || ''
  const recent = [...new Set(state.conversations.map((c) => c.cwd).filter(Boolean))].slice(0, 8)
  $('#folder-recent').innerHTML = recent.length
    ? '<div class="recent-label">최근 작업 폴더</div>' +
      recent.map((p) => `<button type="button" class="recent" data-path="${esc(p)}" title="${esc(p)}"><b>${esc(baseName(p))}</b><span>${esc(p)}</span></button>`).join('')
    : ''
  $('#folder-repos-filter').value = ''
  loadReposList()
  $('#folder-warn').hidden = !(state.current && state.current.messages.length)
  $('#folder-dialog').showModal()
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

export function bindDialogs() {
  // 최근 폴더·프로젝트 목록 버튼은 다시 그려지므로 대화상자에서 한 번에 받는다.
  $('#folder-dialog').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-path]')
    if (pick) $('#folder-input').value = pick.dataset.path
  })
  $('#folder-repos-filter').addEventListener('input', (e) => renderReposList(e.target.value))
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
}
