'use strict'
// Antigravity(agy) 헤드리스 어댑터.
// Orca 출처: src/shared/commit-message-agent-specs-secondary.ts (agy 비대화형 실행, `agy models` 파싱),
// src/shared/agent-resume-argv.ts (`--conversation <id>`로 이어가기),
// src/shared/agent-session-option-catalog-antigravity.ts (`--model`, `--effort`).
// Orca는 `--print=<프롬프트>`로 argv에 싣지만, Windows 명령줄 32K 제한 때문에 여기서는
// agy 1.3의 `--input-format stream-json`(stdin NDJSON `{"event":"user",...}`)을 쓴다.

const PERMISSION_ARGS = {
  plan: ['--mode', 'plan'],
  edit: ['--mode', 'accept-edits'],
  full: ['--dangerously-skip-permissions']
}

function buildArgs({ sessionId, model, permission }) {
  return [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    ...(sessionId ? ['--conversation', sessionId] : []),
    ...(model && model !== 'default' ? ['--model', model] : []),
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
  label: 'Antigravity',
  binaryName: 'agy',
  models: [{ id: 'default', label: '기본값' }],
  buildArgs,
  stdinPayload,
  buildEnv,
  createParser,
  parseModels
}
