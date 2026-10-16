'use strict'
// 에이전트 목록: CLI 찾기, 버전·모델 목록 확인, 사용량·MCP 조회, 화면에 보낼 공개 정보.
// 모델 목록은 확인할 때마다 저장해 두고 다음 실행에서 먼저 보여 준다 (CLI 확인에 몇 초 걸림).
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const store = require('../store')
const { resolveBinary } = require('./binary')
const claude = require('./claude')
const antigravity = require('./antigravity')

const ADAPTERS = { claude, antigravity }
const STATUS_TTL_MS = 60 * 1000

/** CLI를 한 번 실행한다. → { ok, stdout, error } */
function runOnce(info, args, { stdin = null, cwd = store.DATA_DIR, timeout }) {
  return new Promise((resolve) => {
    const child = execFile(
      info.binary.path,
      [...(info.binary.args || []), ...args],
      { cwd, env: info.adapter.buildEnv(process.env), timeout, windowsHide: true, shell: info.binary.shell, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const detail = String(stderr || '').trim() || (err && err.killed ? '시간 초과' : err ? err.message : '')
        resolve({ ok: !err, stdout: String(stdout || ''), error: err ? detail.slice(-400) : null })
      }
    )
    child.stdin.on('error', () => {})
    child.stdin.end(stdin || undefined)
  })
}

function versionAtLeast(version, min) {
  const m = String(version || '').match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return false
  const a = m.slice(1).map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

function isDir(p) {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function createAgentRegistry({ getSettings, onChange }) {
  const modelCache = store.loadModelCache()
  const agents = {}
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    agents[id] = { adapter, binary: null, version: null, versionCheck: null, models: modelCache[id] || adapter.models }
  }
  const statusCache = new Map() // `${kind}:${agent}:${cwd}` → { at, promise }

  async function checkVersion(info) {
    const r = await runOnce(info, ['--version'], { timeout: 15000 })
    info.version = r.ok ? r.stdout.trim().split(/\r?\n/)[0].slice(0, 60) : null
    onChange()
  }

  async function refreshModels(id, info) {
    const probe = info.adapter.modelProbe
    const r = await runOnce(info, probe.args, { stdin: probe.stdin, timeout: 45000 })
    const models = r.ok ? probe.parse(r.stdout) : []
    if (!models.length) return
    info.models = models
    modelCache[id] = models
    store.saveModelCache(modelCache)
    onChange()
  }

  /** 설정의 CLI 경로로 실행 파일을 다시 찾고, 버전·모델 목록을 백그라운드로 확인한다. */
  function detect() {
    const settings = getSettings()
    statusCache.clear()
    for (const [id, info] of Object.entries(agents)) {
      info.binary = resolveBinary(info.adapter.binaryName, settings[`${id}Path`] || '')
      info.version = null
      info.versionCheck = null
      if (!info.binary) continue
      info.versionCheck = checkVersion(info)
      refreshModels(id, info)
    }
  }

  // Why: 사용량 조회는 서버 쪽 한도가 있어(Orca: 자주 부르면 429) 잠깐 기억해 두고, 새로 고침을 눌렀을 때만 다시 부른다.
  function cached(key, force, load) {
    const hit = statusCache.get(key)
    if (hit && !force && Date.now() - hit.at < STATUS_TTL_MS) return hit.promise
    const promise = load().then((result) => {
      if (result.error) statusCache.delete(key)
      return { ...result, checkedAt: Date.now() }
    })
    statusCache.set(key, { at: Date.now(), promise })
    return promise
  }

  /** 남은 사용량(쿼터). → { plan, groups, notes } 또는 { error } */
  function fetchUsage(id, { force = false } = {}) {
    const info = agents[id]
    return cached(`usage:${id}`, force, async () => {
      if (!info.binary) return { error: 'CLI를 찾을 수 없습니다' }
      const probe = info.adapter.usageProbe
      if (probe.minVersion) {
        await info.versionCheck
        if (!versionAtLeast(info.version, probe.minVersion)) {
          return { error: `${info.adapter.binaryName} ${probe.minVersion} 이상에서만 확인할 수 있습니다 (현재 ${info.version || '알 수 없음'})` }
        }
      }
      const r = await runOnce(info, probe.args, { stdin: probe.stdin, timeout: 30000 })
      const usage = r.ok ? probe.parse(r.stdout) : null
      return usage || { error: r.error || '사용량 응답을 읽지 못했습니다' }
    })
  }

  /** 쓸 수 있는 MCP 서버. cwd는 프로젝트 범위 서버를 찾을 작업 폴더. → { servers } 또는 { error } */
  function fetchMcp(id, { cwd, force = false } = {}) {
    const info = agents[id]
    const dir = isDir(cwd) ? cwd : os.homedir()
    return cached(`mcp:${id}:${dir}`, force, async () => {
      if (!info.binary) return { error: 'CLI를 찾을 수 없습니다' }
      const probe = info.adapter.mcpProbe
      const r = await runOnce(info, probe.args, { cwd: dir, timeout: 60000 })
      // Why: 일부 서버가 연결에 실패하면 종료 코드가 0이 아닐 수 있지만, 목록 자체는 그대로 보여 준다.
      const servers = probe.parse(r.stdout)
      return r.ok || servers.length ? { servers, cwd: dir } : { error: r.error || 'MCP 목록을 읽지 못했습니다' }
    })
  }

  function publicInfo() {
    const out = {}
    for (const [id, info] of Object.entries(agents)) {
      out[id] = {
        id,
        label: info.adapter.label,
        available: Boolean(info.binary),
        path: info.binary ? info.binary.path : null,
        version: info.version,
        models: info.models
      }
    }
    return out
  }

  return { agents, detect, publicInfo, fetchUsage, fetchMcp }
}

module.exports = { createAgentRegistry, versionAtLeast }
