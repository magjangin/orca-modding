'use strict'
// 대화 저장소: <데이터 폴더>/conversations/<id>.json 한 파일에 대화 하나.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const DATA_DIR = process.env.ORCA_DUO_DATA || path.join(os.homedir(), '.orca-duo')
const CONV_DIR = path.join(DATA_DIR, 'conversations')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

fs.mkdirSync(CONV_DIR, { recursive: true })

const cache = new Map()
const pending = new Map()

const DEFAULT_SETTINGS = {
  lastCwd: os.homedir(),
  claudePath: '',
  antigravityPath: '',
  autoFailover: true,
  relayPrompt:
    '위 공유 컨텍스트에 있는 상대 에이전트의 답변을 검토해줘. 틀리거나 빠진 부분이 있으면 바로잡고, 남은 작업이 있으면 이어서 진행해줘.'
}

function newId() {
  return crypto.randomUUID()
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data, 'utf8')
  fs.renameSync(tmp, file)
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings) {
  writeAtomic(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function convFile(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('잘못된 대화 ID')
  return path.join(CONV_DIR, `${id}.json`)
}

function loadAll() {
  for (const name of fs.readdirSync(CONV_DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      const conv = JSON.parse(fs.readFileSync(path.join(CONV_DIR, name), 'utf8'))
      // Why: 앱이 응답 도중 꺼졌다면 그 메시지는 더 이상 스트리밍 중이 아니다.
      for (const m of conv.messages) {
        if (m.status === 'streaming') {
          m.status = 'stopped'
          for (const p of m.parts || []) if (p.kind === 'tool' && p.status === 'running') p.status = 'error'
        }
      }
      cache.set(conv.id, conv)
    } catch {
      // 깨진 파일은 건너뛴다
    }
  }
}

function summary(conv) {
  const agents = [...new Set(conv.messages.filter((m) => m.role === 'assistant').map((m) => m.agent))]
  return {
    id: conv.id,
    title: conv.title,
    cwd: conv.cwd,
    updatedAt: conv.updatedAt,
    agents,
    count: conv.messages.length
  }
}

function list() {
  return [...cache.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(summary)
}

function get(id) {
  return cache.get(id) || null
}

function create(cwd) {
  const now = Date.now()
  const conv = {
    id: newId(),
    title: '새 대화',
    cwd,
    createdAt: now,
    updatedAt: now,
    sessions: { claude: null, antigravity: null },
    seen: { claude: -1, antigravity: -1 },
    messages: []
  }
  cache.set(conv.id, conv)
  saveNow(conv)
  return conv
}

function saveNow(conv) {
  clearTimeout(pending.get(conv.id))
  pending.delete(conv.id)
  writeAtomic(convFile(conv.id), JSON.stringify(conv))
}

/** 스트리밍 중에는 너무 자주 쓰지 않도록 묶어서 저장. */
function saveSoon(conv) {
  if (pending.has(conv.id)) return
  pending.set(
    conv.id,
    setTimeout(() => {
      pending.delete(conv.id)
      if (cache.has(conv.id)) saveNow(conv)
    }, 1500)
  )
}

function remove(id) {
  clearTimeout(pending.get(id))
  pending.delete(id)
  cache.delete(id)
  try {
    fs.unlinkSync(convFile(id))
  } catch {
    // 이미 없음
  }
}

function flushAll() {
  for (const id of [...pending.keys()]) {
    const conv = cache.get(id)
    if (conv) saveNow(conv)
  }
}

loadAll()

module.exports = {
  DATA_DIR,
  newId,
  list,
  get,
  create,
  saveNow,
  saveSoon,
  remove,
  flushAll,
  summary,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS
}
