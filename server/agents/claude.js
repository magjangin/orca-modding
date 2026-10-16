'use strict'
// Claude Code 헤드리스 어댑터.
// Orca 출처: src/shared/commit-message-agent-specs-primary.ts (`claude -p`는 stdin으로 프롬프트를 받음),
// src/shared/agent-resume-argv.ts (`--resume <session_id>`),
// src/main/claude/claude-child-process-environment.ts (자식 세션 스탬프 환경변수 제거).

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

const MODELS = [
  { id: 'default', label: '기본값' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]

function buildArgs({ sessionId, model, permission }) {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(sessionId ? ['--resume', sessionId] : []),
    ...(model && model !== 'default' ? ['--model', model] : []),
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
  label: 'Claude',
  binaryName: 'claude',
  models: MODELS,
  buildArgs,
  stdinPayload,
  buildEnv,
  createParser
}
