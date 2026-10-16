'use strict'
// Antigravity(agy) 헤드리스 어댑터.
// Orca 출처: src/shared/commit-message-agent-specs-secondary.ts (agy 비대화형 실행, `agy models` 파싱),
// src/shared/agent-resume-argv.ts (`--conversation <id>`로 이어가기),
// src/shared/agent-session-option-catalog-antigravity.ts (`--model`, `--effort`).
// Orca는 `--print=<프롬프트>`로 argv에 싣지만, Windows 명령줄 32K 제한 때문에 여기서는
// agy 1.3의 `--input-format stream-json`(stdin NDJSON `{"event":"user",...}`)을 쓴다.
const { LABEL, EFFORT_LEVELS, sortEfforts } = require('./shared')

const PERMISSION_ARGS = {
  plan: ['--mode', 'plan'],
  edit: ['--mode', 'accept-edits'],
  full: ['--dangerously-skip-permissions']
}
const DEFAULT_MODEL = { id: 'default', label: '기본값', efforts: EFFORT_LEVELS }
const VARIANT_RE = new RegExp(`^(.+)-(${EFFORT_LEVELS.join('|')})$`)

function buildArgs({ sessionId, model, effort, permission }) {
  return [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    ...(sessionId ? ['--conversation', sessionId] : []),
    ...(model && model !== 'default' ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(PERMISSION_ARGS[permission] || PERMISSION_ARGS.edit)
  ]
}

function stdinPayload(prompt) {
  return JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } }) + '\n'
}

function buildEnv(base) {
  return { ...base }
}

/** `agy models` 출력: 신버전은 `id<TAB>label`, 구버전은 표시 이름만 (Orca commit-message-model-parsers.ts). */
function parseModels(stdout) {
  const models = []
  for (const raw of String(stdout).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^fetching/i.test(line)) continue
    const [id, label] = line.split('\t')
    if (!id) continue
    models.push({ id: id.trim(), label: (label || id).trim() })
  }
  return models
}

/**
 * agy 모델 ID는 노력 단계가 끝에 붙은 변형(`gemini-4-argon-low`·`-medium`·`-high`)이라,
 * 모델 칸에는 계열 하나만 보이고 노력 칸에서 변형을 고르게 묶는다.
 */
function groupModels(list) {
  const families = new Map()
  for (const { id, label } of list) {
    const m = id.match(VARIANT_RE)
    const familyId = m ? m[1] : id
    let family = families.get(familyId)
    if (!family) {
      family = { id: familyId, label: label.replace(/\s*\([^)]*\)\s*$/, '') || familyId, efforts: [], variants: m ? {} : undefined }
      families.set(familyId, family)
    }
    if (m && family.variants) family.variants[m[2]] = id
  }
  return [...families.values()].map((f) => {
    if (!f.variants) return { id: f.id, label: f.label, efforts: [] }
    const efforts = sortEfforts(Object.keys(f.variants))
    const defaultEffort = ['high', 'medium'].find((l) => f.variants[l]) || efforts[0]
    return { ...f, efforts, defaultEffort }
  })
}

const MODEL_PROBE = {
  args: ['models'],
  stdin: null,
  parse(stdout) {
    const models = groupModels(parseModels(stdout))
    return models.length ? [DEFAULT_MODEL, ...models] : []
  }
}

// ── 사용량 (Orca src/main/rate-limits/antigravity-usage-command.ts) ──
// Why: agy는 구글 자격 증명을 OS 키링에 두고 직접 토큰을 받으므로 바깥에서 할당량 API를 부를 수 없다.
// print 모드의 `/usage` 슬래시 명령은 대화를 시작하지 않고(num_turns 0, 토큰 0) 할당량만 돌려준다.
// --disable-slash-commands를 붙이면 `/usage`가 일반 프롬프트로 가서 실제 턴을 쓰므로 붙이지 않는다.
// 1.1.11 전에는 이 명령도 턴을 썼다.
const WINDOW_LABEL = { '5h': '5시간', weekly: '주간', daily: '일간' }
const USAGE_PROBE = {
  args: ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'],
  stdin: null,
  minVersion: '1.1.11',
  parse: parseUsage
}

/** `/usage` json → { plan, groups: [{ name, hint, windows: [{ label, usedPercent, resetsAt }] }], notes } */
function parseUsage(stdout) {
  const start = String(stdout).indexOf('{')
  if (start === -1) return null
  let obj
  try {
    obj = JSON.parse(String(stdout).slice(start))
  } catch {
    return null
  }
  const data = obj && obj.command && obj.command.name === 'usage' ? obj.command.data : null
  if (!data || !Array.isArray(data.groups)) return null
  return {
    plan: null,
    groups: data.groups.map((g) => ({
      name: g.name,
      hint: g.description || undefined,
      windows: (g.buckets || [])
        .filter((b) => Number.isFinite(b.remaining_fraction))
        .map((b) => ({
          label: WINDOW_LABEL[b.window] || b.name,
          usedPercent: Math.round((1 - b.remaining_fraction) * 1000) / 10,
          resetsAt: b.reset_time || null
        }))
    })),
    notes: []
  }
}

// ── MCP ── `agy mcp list`는 설정 표(NAME TYPE STATUS COMMAND/URL)만 보여 준다 (연결 확인은 하지 않음).
const MCP_PROBE = { args: ['mcp', 'list'], parse: parseMcpList }

function parseMcpList(stdout) {
  const servers = []
  for (const line of String(stdout).split(/\r?\n/)) {
    const cols = line.trim().split(/\s{2,}/)
    if (cols.length < 4 || cols[0] === 'NAME') continue
    const [name, type, status, ...rest] = cols
    servers.push({ name, type: type.toLowerCase(), target: rest.join('  '), status: /^enabled$/i.test(status) ? 'enabled' : 'disabled' })
  }
  return servers
}

// ── 플러그인·스킬 ── `agy plugin list`
const PLUGIN_PROBE = { args: ['plugin', 'list'], parse: parsePluginList }

function parsePluginList(stdout) {
  const plugins = []
  let cur = null
  for (const line of String(stdout).split(/\r?\n/)) {
    const head = line.match(/^-\s+([\w.-]+)\s+\(([^,]+),\s*([^)]+)\)/)
    if (head) {
      cur = { name: head[1], status: head[2].trim(), version: head[3].trim(), detail: '' }
      plugins.push(cur)
      continue
    }
    const comp = line.match(/^\s+Components:\s*(.+)$/i)
    if (comp && cur) cur.detail = comp[1].trim()
    const src = line.match(/^\s+Source:\s*(.+)$/i)
    if (src && cur && !cur.detail) cur.detail = src[1].trim()
  }
  return plugins
}

function toolStatus(state) {
  if (state === 'DONE') return 'done'
  if (state === 'ACTIVE' || state === 'PENDING' || state === 'RUNNING') return 'running'
  return 'error'
}

function createParser(emit) {
  let textStep = null
  let sawText = false
  return function onLine(obj) {
    if (!obj || typeof obj !== 'object') return
    switch (obj.event) {
      case 'init':
        emit({ type: 'session', sessionId: obj.conversation_id, model: obj.init && obj.init.model })
        return
      case 'step_update': {
        const su = obj.step_update || {}
        if (su.step_type === 'agent_response') {
          if (su.text_delta) {
            if (textStep !== su.step_index) {
              textStep = su.step_index
              emit({ type: 'text-start' })
            }
            sawText = true
            emit({ type: 'text', delta: su.text_delta })
          }
          if (su.thinking_delta) emit({ type: 'thinking', delta: su.thinking_delta })
        } else if (su.step_type === 'tool') {
          const info = su.tool_info || {}
          emit({
            type: 'tool',
            id: 'step-' + su.step_index,
            name: su.tool_name || info.name,
            input: info.parameters,
            output: info.output,
            status: toolStatus(su.state)
          })
        } else if (su.step_type && su.step_type !== 'user_input' && su.text_delta) {
          emit({ type: 'thinking', delta: su.text_delta })
        }
        return
      }
      case 'result': {
        const r = obj.result || {}
        if (!sawText && r.response) emit({ type: 'text', delta: r.response })
        const ok = r.status === 'SUCCESS'
        emit({
          type: 'done',
          sessionId: r.conversation_id,
          isError: !ok,
          error: ok ? null : String(r.error || r.status || '알 수 없는 오류'),
          durationMs: typeof r.duration_seconds === 'number' ? Math.round(r.duration_seconds * 1000) : null,
          costUsd: null,
          tokens: r.usage ? r.usage.total_tokens : null,
          deniedTools: []
        })
        return
      }
      default:
    }
  }
}

module.exports = {
  id: 'antigravity',
  label: LABEL.antigravity,
  binaryName: 'agy',
  models: [DEFAULT_MODEL],
  modelProbe: MODEL_PROBE,
  usageProbe: USAGE_PROBE,
  mcpProbe: MCP_PROBE,
  pluginProbe: PLUGIN_PROBE,
  buildArgs,
  stdinPayload,
  buildEnv,
  createParser,
  parseModels,
  groupModels
}
