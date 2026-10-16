'use strict'
// 에이전트 목록: CLI 찾기, 버전·모델 목록 확인, 화면에 보낼 공개 정보.
// 모델 목록은 확인할 때마다 저장해 두고 다음 실행에서 먼저 보여 준다 (CLI 확인에 몇 초 걸림).
const { execFile } = require('node:child_process')
const store = require('../store')
const { resolveBinary } = require('./binary')
const claude = require('./claude')
const antigravity = require('./antigravity')

const ADAPTERS = { claude, antigravity }

/** CLI를 한 번 실행해 stdout을 돌려준다. 실패하면 null. */
function runOnce(info, args, { stdin = null, timeout }) {
  return new Promise((resolve) => {
    const child = execFile(
      info.binary.path,
      args,
      { cwd: store.DATA_DIR, env: info.adapter.buildEnv(process.env), timeout, windowsHide: true, shell: info.binary.shell },
      (err, stdout) => resolve(err ? null : String(stdout))
    )
    child.stdin.on('error', () => {})
    child.stdin.end(stdin || undefined)
  })
}

function createAgentRegistry({ getSettings, onChange }) {
  const modelCache = store.loadModelCache()
  const agents = {}
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    agents[id] = { adapter, binary: null, version: null, models: modelCache[id] || adapter.models }
  }

  async function checkVersion(info) {
    const out = await runOnce(info, ['--version'], { timeout: 15000 })
    info.version = out ? out.trim().split(/\r?\n/)[0].slice(0, 60) : null
    onChange()
  }

  async function refreshModels(id, info) {
    const probe = info.adapter.modelProbe
    const out = await runOnce(info, probe.args, { stdin: probe.stdin, timeout: 45000 })
    const models = out ? probe.parse(out) : []
    if (!models.length) return
    info.models = models
    modelCache[id] = models
    store.saveModelCache(modelCache)
    onChange()
  }

  /** 설정의 CLI 경로로 실행 파일을 다시 찾고, 버전·모델 목록을 백그라운드로 확인한다. */
  function detect() {
    const settings = getSettings()
    for (const [id, info] of Object.entries(agents)) {
      info.binary = resolveBinary(info.adapter.binaryName, settings[`${id}Path`] || '')
      info.version = null
      if (!info.binary) continue
      checkVersion(info)
      refreshModels(id, info)
    }
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

  return { agents, detect, publicInfo }
}

module.exports = { createAgentRegistry }
