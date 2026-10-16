'use strict'
// 실제 CLI 출력(2026-10 기준 claude 2.1.293, agy 1.3.5)을 녹화한 줄로 파서와 컨텍스트 전달을 검증한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const claude = require('../server/agents/claude')
const antigravity = require('../server/agents/antigravity')
const { buildPrompt } = require('../server/handoff')
const { QUOTA_ERROR_RE } = require('../server/orchestrator')

function collect(adapter, lines) {
  const events = []
  const onLine = adapter.createParser((e) => events.push(e))
  for (const l of lines) onLine(JSON.parse(l))
  return events
}

test('claude: 세션·텍스트 델타·도구·결과를 공통 이벤트로 바꾼다', () => {
  const events = collect(claude, [
    '{"type":"system","subtype":"init","session_id":"s-1","model":"claude-haiku-5-5"}',
    '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"po"}},"parent_tool_use_id":null}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ng"}},"parent_tool_use_id":null}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"pong"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.txt"}}]},"parent_tool_use_id":null}',
    '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"hello"}]},"parent_tool_use_id":null}',
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"sub"}},"parent_tool_use_id":"task-9"}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":1384,"result":"pong","session_id":"s-1","total_cost_usd":0.0037,"usage":{"input_tokens":2,"cache_creation_input_tokens":10,"cache_read_input_tokens":20,"output_tokens":4},"permission_denials":[{"tool_name":"Bash"}]}'
  ])
  assert.deepEqual(events[0], { type: 'session', sessionId: 's-1', model: 'claude-haiku-5-5' })
  const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
  assert.equal(text, 'pong', '서브에이전트 스트림과 완성 메시지 텍스트는 중복으로 싣지 않는다')
  const tools = events.filter((e) => e.type === 'tool')
  assert.equal(tools[0].name, 'Read')
  assert.equal(tools[1].output, 'hello')
  assert.equal(tools[1].status, 'done')
  const done = events.at(-1)
  assert.equal(done.type, 'done')
  assert.equal(done.tokens, 36)
  assert.deepEqual(done.deniedTools, ['Bash'])
})

test('claude: 스트림 델타가 없으면 result 텍스트로 채운다', () => {
  const events = collect(claude, ['{"type":"result","is_error":false,"result":"only result","session_id":"s"}'])
  assert.equal(events[0].delta, 'only result')
})

test('antigravity: init·도구 step·텍스트 step·result', () => {
  const events = collect(antigravity, [
    '{"event":"init","conversation_id":"c-1","init":{"model":"gemini-3.8-flash-low"}}',
    '{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":0,"state":"DONE","step_type":"user_input"}}',
    '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:\\\\x\\\\sample.txt"}}}}',
    '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:\\\\x\\\\sample.txt"},"output":"2 lines, 6 bytes"}}}',
    '{"event":"step_update","step_update":{"step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"내용은 "}}',
    '{"event":"step_update","step_update":{"step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"`hello`"}}',
    '{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"내용은 `hello`","duration_seconds":5.07,"usage":{"total_tokens":19963}}}'
  ])
  assert.deepEqual(events[0], { type: 'session', sessionId: 'c-1', model: 'gemini-3.8-flash-low' })
  const tools = events.filter((e) => e.type === 'tool')
  assert.equal(tools.length, 2)
  assert.equal(tools[0].id, tools[1].id)
  assert.equal(tools[0].status, 'running')
  assert.equal(tools[1].status, 'done')
  assert.equal(tools[1].output, '2 lines, 6 bytes')
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), '내용은 `hello`')
  const done = events.at(-1)
  assert.equal(done.isError, false)
  assert.equal(done.durationMs, 5070)
  assert.equal(done.tokens, 19963)
})

test('antigravity: 오류 result는 isError', () => {
  const events = collect(antigravity, [
    '{"event":"result","result":{"conversation_id":"x","status":"ERROR","response":"","error":"boom"}}'
  ])
  assert.equal(events[0].isError, true)
  assert.equal(events[0].error, 'boom')
})

test('antigravity: stdin 페이로드와 인자', () => {
  const payload = JSON.parse(antigravity.stdinPayload('안녕 "따옴표"'))
  assert.deepEqual(payload, { event: 'user', message: { role: 'user', content: '안녕 "따옴표"' } })
  const args = antigravity.buildArgs({ sessionId: 'c-1', model: 'gemini-x', permission: 'plan' })
  assert.deepEqual(args, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--conversation', 'c-1', '--model', 'gemini-x', '--mode', 'plan'])
  assert.deepEqual(antigravity.parseModels('Fetching available models...\na-1\tA One\nb-2\tB Two\n'), [
    { id: 'a-1', label: 'A One' },
    { id: 'b-2', label: 'B Two' }
  ])
})

test('claude: 인자와 자식 환경변수 정리', () => {
  assert.deepEqual(claude.buildArgs({ sessionId: null, model: 'default', permission: 'full' }).slice(-1), ['--dangerously-skip-permissions'])
  assert.ok(claude.buildArgs({ sessionId: 's', model: 'opus', permission: 'edit' }).join(' ').includes('--resume s --model opus --permission-mode acceptEdits'))
  const env = claude.buildEnv({ PATH: 'x', CLAUDECODE: '1', claude_code_session_id: 'abc' })
  assert.deepEqual(env, { PATH: 'x' })
})

function conv(messages, seen, sessions) {
  return { messages, seen, sessions }
}
const u = (agent, text) => ({ role: 'user', agent, text })
const a = (agent, text) => ({ role: 'assistant', agent, status: 'done', parts: [{ kind: 'text', text }] })

test('handoff: 처음 보내는 에이전트에게는 다른 쪽 대화를 넘긴다', () => {
  const c = conv(
    [u('claude', '버그 찾아줘'), a('claude', 'foo.js 12행이 원인'), u('antigravity', '고쳐줘')],
    { claude: 1, antigravity: -1 },
    { claude: 's1', antigravity: null }
  )
  const { prompt, handoffCount } = buildPrompt(c, 'antigravity', 2)
  assert.equal(handoffCount, 2)
  assert.match(prompt, /\[사용자 → Claude\]\n버그 찾아줘/)
  assert.match(prompt, /\[Claude의 답변\]\nfoo.js 12행이 원인/)
  assert.ok(prompt.endsWith('[사용자 → Antigravity]\n고쳐줘'))
})

test('handoff: 이미 본 대화는 다시 넘기지 않는다', () => {
  const c = conv(
    [u('claude', 'A'), a('claude', 'B'), u('antigravity', 'C'), a('antigravity', 'D'), u('claude', 'E')],
    { claude: 1, antigravity: 3 },
    { claude: 's1', antigravity: 'c1' }
  )
  const { prompt, handoffCount } = buildPrompt(c, 'claude', 4)
  assert.equal(handoffCount, 2)
  assert.ok(!prompt.includes('[사용자 → Claude]\nA'))
  assert.match(prompt, /\[Antigravity의 답변\]\nD/)

  const same = conv([u('claude', 'A'), a('claude', 'B'), u('claude', 'C')], { claude: 1, antigravity: -1 }, { claude: 's1', antigravity: null })
  assert.deepEqual(buildPrompt(same, 'claude', 2), { prompt: 'C', handoffCount: 0 })
})

test('handoff: 세션이 없으면(폴더 변경 등) 자기 대화까지 전체를 넘긴다', () => {
  const c = conv(
    [u('claude', 'A'), a('claude', 'B'), { role: 'system', text: '폴더 변경' }, u('claude', 'C')],
    { claude: -1, antigravity: -1 },
    { claude: null, antigravity: null }
  )
  const { handoffCount, prompt } = buildPrompt(c, 'claude', 3)
  assert.equal(handoffCount, 2)
  assert.ok(!prompt.includes('폴더 변경'))
})

test('failover: 쿼터/사용량 초과/Rate limit 에러 패턴을 정확히 감지한다', () => {
  const quotaErrors = [
    'rate_limit_error: You have exceeded your current quota',
    'Error: credit balance is too low to complete this request',
    'ResourceExhausted: 429 Resource has been exhausted (e.g. check quota)',
    'Claude was overloaded: please try again later',
    'insufficient_quota: check your plan and billing details',
    'You have hit your limit for today'
  ]
  for (const err of quotaErrors) {
    assert.ok(QUOTA_ERROR_RE.test(err), `패턴 매칭 성공: ${err}`)
  }

  const normalErrors = [
    'SyntaxError: Unexpected token',
    'File not found: calc.js',
    'Command failed with exit code 1'
  ]
  for (const err of normalErrors) {
    assert.ok(!QUOTA_ERROR_RE.test(err), `일반 에러는 쿼터로 오인하지 않음: ${err}`)
  }
})
