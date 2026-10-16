'use strict'
// 대화 저장소: <데이터 폴더>/conversations/<id>.json 한 파일에 대화 하나.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const DATA_DIR = process.env.ORCA_DUO_DATA || path.join(os.homedir(), '.orca-duo')
const CONV_DIR = path.join(DATA_DIR, 'conversations')
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const MODEL_CACHE_FILE = path.join(DATA_DIR, 'models.json')

fs.mkdirSync(CONV_DIR, { recursive: true })
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })

const cache = new Map()
const pending = new Map()

const DEFAULT_REPOS_ROOT = 'H:\\source\\repos'
const initialCwd = fs.existsSync(DEFAULT_REPOS_ROOT) ? DEFAULT_REPOS_ROOT : os.homedir()

const DEFAULT_SETTINGS = {
  lastCwd: initialCwd,
  claudePath: '',
  antigravityPath: '',
  autoFailover: true,
  relayPrompt:
    '직전 에이전트의 작업 내역과 실제 파일 상태를 확인해줘.\n1. 작업 폴더에 `계획문서.md`가 있다면 미완료 항목(`- [ ]`)을 기준으로 작업을 이어가고, 완료한 항목은 `- [x]`로 갱신해.\n2. 중단되었거나 남은 작업이 있다면 실제 코드를 확인하며 바로 이어서 구현해.\n3. 명백한 버그, 빌드/테스트 오류, 요구사항 누락만 수정하고, 정상 작동하는 코드를 단순 스타일 차이로 재수정하지 마.\n4. 모든 작업과 테스트 검증이 끝났다면 억지로 코드를 고치지 말고 완료 상태만 짧게 브리핑해.\n불필요한 인사말이나 중복 요약은 생략하고 반드시 한국어로만 답변해.'
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

/** 에이전트별 마지막 모델 목록 ({ claude: [...], antigravity: [...] }). */
function loadModelCache() {
  try {
    return JSON.parse(fs.readFileSync(MODEL_CACHE_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

function saveModelCache(cache) {
  writeAtomic(MODEL_CACHE_FILE, JSON.stringify(cache, null, 2))
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
  ATTACHMENTS_DIR,
  newId,
  list,
  get,
  create,
  saveNow,
  saveSoon,
  remove,
  flushAll,
  loadSettings,
  saveSettings,
  loadModelCache,
  saveModelCache,
  DEFAULT_SETTINGS,
  DEFAULT_REPOS_ROOT
}
