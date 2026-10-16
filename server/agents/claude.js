'use strict'
// Claude Code 헤드리스 어댑터.
// Orca 출처: src/shared/commit-message-agent-specs-primary.ts (`claude -p`는 stdin으로 프롬프트를 받음),
// src/shared/agent-resume-argv.ts (`--resume <session_id>`),
// src/main/claude/claude-child-process-environment.ts (자식 세션 스탬프 환경변수 제거),
// src/shared/claude-model-list-probe.ts (`list_models` 제어 요청으로 모델 목록 받기).
const { LABEL, EFFORT_LEVELS, sortEfforts } = require('./shared')

const CHILD_SESSION_STAMP_KEYS = [
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  // Why: Claude Code 안에서 이 앱을 띄웠을 때 중첩 세션으로 오인되지 않게 한다.
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT'
]

const PERMISSION_ARGS = {
  plan: ['--permission-mode', 'plan'],
  edit: ['--permission-mode', 'acceptEdits'],
  full: ['--dangerously-skip-permissions']
}

// 목록 확인 전(또는 list_models를 모르는 구버전 CLI)에 쓰는 기본 목록.
const MODELS = [
  { id: 'default', label: '기본값', efforts: EFFORT_LEVELS },
  { id: 'opus', label: 'Opus', efforts: EFFORT_LEVELS },
  { id: 'sonnet', label: 'Sonnet', efforts: EFFORT_LEVELS },
  { id: 'haiku', label: 'Haiku', efforts: [] }
]

// ── 제어 요청 (모델 목록·사용량) ─────────────────────────
// Why: --print stream-json에 control_request 한 줄을 보내면 API 턴 없이 CLI 내부 정보를 돌려준다
// (list_models = /model 선택지, get_usage = /usage 한도). 사용자 설정을 읽지 않게(--setting-sources project,
// 빈 데이터 폴더에서 실행) 해서 SessionStart 훅이 돌지 않게 한다.
const CONTROL_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project']

function controlRequest(subtype) {
  return JSON.stringify({ type: 'control_request', request_id: `duo-${subtype}`, request: { subtype } }) + '\n'
}

/** stdout에서 그 요청의 성공 응답 본문을 찾는다. 모르는 요청(구버전 CLI)이면 null. */
function controlResponse(stdout, subtype) {
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.includes('control_response')) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const res = obj.response || {}
    if (res.request_id === `duo-${subtype}` && res.subtype === 'success') return res.response || {}
  }
  return null
}

const MODEL_PROBE = { args: CONTROL_ARGS, stdin: controlRequest('list_models'), parse: parseModels }
const USAGE_PROBE = { args: CONTROL_ARGS, stdin: controlRequest('get_usage'), parse: parseUsage }
// `claude mcp list`는 서버마다 실제로 붙어 보고(연결됨/실패/인증 필요) 사용자·프로젝트·플러그인 서버를 모두 보여 준다.
const MCP_PROBE = { args: ['mcp', 'list'], parse: parseMcpList }

function parseModels(stdout) {
  const body = controlResponse(stdout, 'list_models')
  if (!body || !Array.isArray(body.models)) return []
  const seen = new Set()
  const models = []
  for (const m of body.models) {
    const id = m && typeof m.value === 'string' ? m.value.trim() : ''
    // Why: 아직 못 쓰는 모델은 disabled 자리표시 줄로 오고, 그 value를 --model에 넘기면 실패한다.
    if (!id || m.disabled === true || seen.has(id)) continue
    seen.add(id)
    const efforts = m.supportsEffort === true && Array.isArray(m.supportedEffortLevels) ? sortEfforts(m.supportedEffortLevels) : []
    // Why: default 줄의 설명은 사용자 설정을 빼고 확인한 값이라 실제 기본 모델과 다를 수 있어 붙이지 않는다.
    if (id === 'default') models.push({ id, label: '기본값', efforts })
    else models.push({ id, label: m.displayName || id, hint: m.description || undefined, resolved: m.resolvedModel || undefined, efforts })
  }
  return models
}

const LIMIT_LABEL = { session: '5시간', weekly_all: '주간', weekly_scoped: '주간' }
const WINDOW_KEYS = [
  ['five_hour', '5시간'],
  ['seven_day', '주간'],
  ['seven_day_opus', '주간 · Opus'],
  ['seven_day_sonnet', '주간 · Sonnet']
]

function money(minor, decimals, currency) {
  const n = (minor / 10 ** (decimals || 0)).toFixed(decimals || 0)
  return currency === 'USD' ? `$${n}` : `${n} ${currency || ''}`.trim()
}

/** get_usage 응답 → { plan, groups: [{ name, windows: [{ label, usedPercent, resetsAt }] }], notes } */
function parseUsage(stdout) {
  const body = controlResponse(stdout, 'get_usage')
  if (!body) return null
  const rl = body.rate_limits || {}
  const windows = []
  if (Array.isArray(rl.limits) && rl.limits.length) {
    for (const l of rl.limits) {
      if (!l || !Number.isFinite(l.percent)) continue
      const model = l.scope && l.scope.model && l.scope.model.display_name
      const base = LIMIT_LABEL[l.kind] || (l.group === 'weekly' ? '주간' : l.kind)
      windows.push({ label: model ? `${base} · ${model}` : base, usedPercent: l.percent, resetsAt: l.resets_at || null })
    }
  } else {
    for (const [key, label] of WINDOW_KEYS) {
      const w = rl[key]
      if (w && Number.isFinite(w.utilization)) windows.push({ label, usedPercent: w.utilization, resetsAt: w.resets_at || null })
    }
  }
  const notes = []
  if (body.rate_limits_available === false) notes.push('이 계정은 사용량 한도 정보를 제공하지 않습니다 (API 키 사용 등)')
  const extra = rl.extra_usage
  if (extra && extra.is_enabled && Number.isFinite(extra.used_credits)) {
    notes.push(`추가 사용 크레딧 ${money(extra.used_credits, extra.decimal_places, extra.currency)} 사용`)
  }
  const plan = typeof body.subscription_type === 'string' && body.subscription_type
  return {
    plan: plan ? `Claude ${plan[0].toUpperCase()}${plan.slice(1)}` : null,
    groups: windows.length ? [{ name: null, windows }] : [],
    notes
  }
}

// `name: 대상 - ✔ Connected` / `- ✘ Failed to connect — 이유` / `- ! Needs authentication`
// Why: 유니코드 터미널이 아니면(파이프로 받을 때 등) 표시가 `√`·`×`로 바뀌므로, 표시는 넓게 받고 상태 문구로 판단한다.
const MCP_LINE_RE = /^(.+?): (.*) - (?:[✔✓√✘✗✖×!⚠‼]\s*)?((?:Connected|Failed|Needs|Pending|Connecting).*)$/iu

function mcpStatus(text) {
  if (/^needs auth/i.test(text)) return 'needs-auth'
  if (/^connected/i.test(text)) return 'connected'
  if (/^(pending|connecting)/i.test(text)) return 'pending'
  return 'failed'
}

function parseMcpList(stdout) {
  const servers = []
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = line.trim().match(MCP_LINE_RE)
    if (!m) continue
    const [, name, rawTarget, text] = m
    const typed = rawTarget.match(/^(.*) \((HTTP|SSE|stdio)\)$/i)
    const status = mcpStatus(text)
    const detail = status === 'failed' ? text.replace(/^Failed to connect\s*—?\s*/i, '').slice(0, 240) : ''
    servers.push({
      name,
      type: typed ? typed[2].toLowerCase() : /^https?:/i.test(rawTarget) ? 'http' : 'stdio',
      target: typed ? typed[1] : rawTarget,
      status,
      ...(detail ? { detail } : {})
    })
  }
  return servers
}

// ── 플러그인·스킬 ── `claude plugin list`
const PLUGIN_PROBE = { args: ['plugin', 'list'], parse: parsePluginList }

function parsePluginList(stdout) {
  const plugins = []
  let cur = null
  for (const line of String(stdout).split(/\r?\n/)) {
    const head = line.match(/^\s*>\s+([^@\s]+)(?:@\S+)?/)
    if (head) {
      cur = { name: head[1], status: 'enabled', version: '', detail: '' }
      plugins.push(cur)
      continue
    }
    const ver = line.match(/^\s*Version:\s*(.+)$/i)
    if (ver && cur) cur.version = ver[1].trim()
    const st = line.match(/^\s*Status:\s*.*?(\w+)\s*$/i)
    if (st && cur) cur.status = st[1].toLowerCase()
    const sc = line.match(/^\s*Scope:\s*(.+)$/i)
    if (sc && cur && !cur.detail) cur.detail = sc[1].trim()
    const pt = line.match(/^\s*Path:\s*(.+)$/i)
    if (pt && cur && !cur.detail) cur.detail = pt[1].trim()
  }
  return plugins
}

function buildArgs({ sessionId, model, effort, permission }) {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(sessionId ? ['--resume', sessionId] : []),
    ...(model && model !== 'default' ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(PERMISSION_ARGS[permission] || PERMISSION_ARGS.edit)
  ]
}

function stdinPayload(prompt) {
  return prompt
}

function buildEnv(base) {
  const env = { ...base }
  for (const key of CHILD_SESSION_STAMP_KEYS) {
    for (const envKey of Object.keys(env)) {
      if (envKey.toUpperCase() === key) delete env[envKey]
    }
  }
  return env
}

function toolResultText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && c.type === 'text' ? c.text : c && c.type ? `[${c.type}]` : ''))
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** stream-json 한 줄(객체)을 공통 이벤트로 바꾼다. */
function createParser(emit) {
  let sawText = false
  return function onLine(obj) {
    if (!obj || typeof obj !== 'object') return
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init') {
          emit({ type: 'session', sessionId: obj.session_id, model: obj.model })
        }
        return
      case 'stream_event': {
        // Why: 서브에이전트(Task) 내부 스트림은 parent_tool_use_id가 붙는다. 본문에는 메인 에이전트만 싣는다.
        if (obj.parent_tool_use_id) return
        const ev = obj.event || {}
        if (ev.type === 'content_block_start') {
          const kind = ev.content_block && ev.content_block.type
          if (kind === 'text') emit({ type: 'text-start' })
          else if (kind === 'thinking') emit({ type: 'thinking-start' })
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            sawText = true
            emit({ type: 'text', delta: ev.delta.text })
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            emit({ type: 'thinking', delta: ev.delta.thinking })
          }
        }
        return
      }
      case 'assistant': {
        if (obj.parent_tool_use_id) return
        const blocks = (obj.message && obj.message.content) || []
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            emit({ type: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' })
          }
        }
        return
      }
      case 'user': {
        if (obj.parent_tool_use_id) return
        const blocks = (obj.message && obj.message.content) || []
        if (!Array.isArray(blocks)) return
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            emit({
              type: 'tool',
              id: b.tool_use_id,
              output: toolResultText(b.content),
              status: b.is_error ? 'error' : 'done'
            })
          }
        }
        return
      }
      case 'result': {
        if (!sawText && typeof obj.result === 'string' && obj.result) {
          emit({ type: 'text', delta: obj.result })
        }
        const denials = Array.isArray(obj.permission_denials) ? obj.permission_denials : []
        emit({
          type: 'done',
          sessionId: obj.session_id,
          isError: Boolean(obj.is_error),
          error: obj.is_error ? String(obj.result || obj.subtype || '알 수 없는 오류') : null,
          durationMs: obj.duration_ms,
          costUsd: obj.total_cost_usd,
          tokens: obj.usage
            ? (obj.usage.input_tokens || 0) +
              (obj.usage.cache_creation_input_tokens || 0) +
              (obj.usage.cache_read_input_tokens || 0) +
              (obj.usage.output_tokens || 0)
            : null,
          deniedTools: denials.map((d) => d.tool_name).filter(Boolean)
        })
        return
      }
      default:
    }
  }
}

module.exports = {
  id: 'claude',
  label: LABEL.claude,
  binaryName: 'claude',
  models: MODELS,
  modelProbe: MODEL_PROBE,
  usageProbe: USAGE_PROBE,
  mcpProbe: MCP_PROBE,
  pluginProbe: PLUGIN_PROBE,
  buildArgs,
  stdinPayload,
  buildEnv,
  createParser
}
