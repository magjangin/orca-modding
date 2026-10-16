'use strict'
// 실제 CLI 출력(2026-10 기준 claude 2.1.293, agy 1.3.5)을 녹화한 줄로 파서와 컨텍스트 전달을 검증한다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Why: orchestrator가 store를 불러오면 데이터 폴더를 만들고 읽는다. 실제 ~/.orca-duo를 건드리지 않게 임시 폴더로 돌린다.
process.env.ORCA_DUO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-duo-test-'))

const claude = require('../server/agents/claude')
const antigravity = require('../server/agents/antigravity')
const { resolveLaunch } = require('../server/agents/shared')
const { fromCmdShim } = require('../server/agents/binary')
const { versionAtLeast } = require('../server/agents')
const { explorerArg } = require('../server/desktop')
const { buildPrompt } = require('../server/handoff')
const { QUOTA_ERROR_RE, normalizePrefs, createOrchestrator, isRelayDone } = require('../server/orchestrator')
const store = require('../server/store')

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

test('claude: list_models 응답에서 버전 붙은 이름과 노력 단계를 읽는다', () => {
  const stdout = [
    '{"type":"system","subtype":"hook_started"}',
    JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'duo-list_models',
        response: {
          models: [
            { value: 'default', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['high', 'low', 'max'] },
            { value: 'opus', displayName: 'Opus 5.5', description: 'For complex work', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
            { value: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
            { value: 'cc-update-required-1', displayName: 'Fable 9 (disabled)', disabled: true }
          ]
        }
      }
    })
  ].join('\n')
  assert.deepEqual(JSON.parse(JSON.stringify(claude.modelProbe.parse(stdout))), [
    { id: 'default', label: '기본값', efforts: ['low', 'high', 'max'] },
    { id: 'opus', label: 'Opus 5.5', hint: 'For complex work', resolved: 'claude-opus-5-5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [] }
  ])
  assert.deepEqual(claude.modelProbe.parse('{"type":"control_response","response":{"subtype":"error"}}'), [])
  assert.ok(claude.buildArgs({ model: 'opus', effort: 'xhigh', permission: 'edit' }).join(' ').includes('--model opus --effort xhigh'))
})

test('antigravity: 노력 단계별 모델을 계열 하나로 묶는다', () => {
  const models = antigravity.modelProbe.parse(
    'Fetching available models...\ngemini-x-medium\tGemini X (Medium)\ngemini-x-low\tGemini X (Low)\ngemini-x-high\tGemini X (High)\nsolo\tSolo\n'
  )
  assert.equal(models[0].id, 'default')
  assert.deepEqual(models[1], {
    id: 'gemini-x',
    label: 'Gemini X',
    efforts: ['low', 'medium', 'high'],
    variants: { medium: 'gemini-x-medium', low: 'gemini-x-low', high: 'gemini-x-high' },
    defaultEffort: 'high'
  })
  assert.deepEqual(models[2], { id: 'solo', label: 'Solo', efforts: [] })
  assert.deepEqual(antigravity.modelProbe.parse('Fetching available models...\n'), [])
})

test('resolveLaunch: 노력은 모델이 지원할 때만, agy 계열은 변형 ID로', () => {
  const agy = antigravity.groupModels([
    { id: 'g-low', label: 'G (Low)' },
    { id: 'g-high', label: 'G (High)' }
  ])
  assert.deepEqual(resolveLaunch(agy, 'g', 'low'), { model: 'g-low', effort: null, level: 'low' })
  assert.deepEqual(resolveLaunch(agy, 'g', 'max'), { model: 'g-high', effort: null, level: 'high' })
  const cl = [
    { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'high'] },
    { id: 'haiku', label: 'Haiku 4.5', efforts: [] }
  ]
  assert.deepEqual(resolveLaunch(cl, 'opus', 'high'), { model: 'opus', effort: 'high', level: 'high' })
  assert.deepEqual(resolveLaunch(cl, 'haiku', 'high'), { model: 'haiku', effort: null, level: null })
  assert.deepEqual(resolveLaunch(cl, 'unknown-model', 'high'), { model: 'unknown-model', effort: null, level: null })
})

test('normalizePrefs: 모르는 노력·권한 값은 기본값으로', () => {
  const p = normalizePrefs({ claude: { model: 'opus', effort: 'xhigh', permission: 'full' }, antigravity: { effort: 'turbo', permission: 'root' } })
  assert.deepEqual(p.claude, { model: 'opus', effort: 'xhigh', permission: 'full' })
  assert.deepEqual(p.antigravity, { model: 'default', effort: 'default', permission: 'edit' })
})

test('orchestrator: 고른 모델·노력이 CLI 인자까지 가고, 답변 meta에 남는다', async () => {
  const calls = []
  // 진짜 CLI 대신 node로 claude 형식의 result 한 줄만 찍는 가짜 어댑터.
  const fake = {
    ...claude,
    buildArgs(o) {
      calls.push(o)
      return ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'result', is_error: false, result: 'ok', session_id: 's-1' }))} + '\\n')`]
    }
  }
  const binary = { path: process.execPath, shell: false }
  const agents = {
    claude: { adapter: fake, binary, models: [{ id: 'opus', label: 'Opus 5.5', efforts: ['low', 'high'] }] },
    antigravity: { adapter: fake, binary, models: [] }
  }
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  const orch = createOrchestrator({
    agents,
    broadcast: (e) => e.type === 'message' && e.message.role === 'assistant' && e.message.status !== 'streaming' && resolveDone(e.message),
    getSettings: () => ({ relayPrompt: '', autoFailover: false })
  })
  const c = store.create(os.tmpdir())
  orch.send(c.id, { agent: 'claude', text: 'hi', prefs: { claude: { model: 'opus', effort: 'high', permission: 'plan' } } })
  const reply = await done
  assert.equal(calls[0].model, 'opus')
  assert.equal(calls[0].effort, 'high')
  assert.equal(calls[0].permission, 'plan')
  assert.equal(reply.status, 'done')
  assert.equal(reply.meta.effort, 'high')
  assert.equal(c.sessions.claude, 's-1')
})

test('mention: 한글 멘션도 대상과 본문을 나눈다', async () => {
  const { parseMention } = await import('../public/js/mention.js')
  assert.deepEqual(parseMention('@클로드 버그 찾아줘'), { agent: 'claude', text: '버그 찾아줘' })
  assert.deepEqual(parseMention('@안티 고쳐줘'), { agent: 'antigravity', text: '고쳐줘' })
  assert.deepEqual(parseMention('@안티그래비티: 검토'), { agent: 'antigravity', text: '검토' })
  assert.deepEqual(parseMention('@agy, 해줘'), { agent: 'antigravity', text: '해줘' })
  assert.deepEqual(parseMention('@claude'), { agent: 'claude', text: '' })
  assert.equal(parseMention('@claudex 안녕'), null, '이름 뒤에 글자가 붙으면 멘션이 아니다')
  assert.equal(parseMention('@안티프래질 책'), null)
  assert.equal(parseMention('메일은 a@claude 로'), null)
})

test('markdown: 로컬 파일 링크 및 Windows 드라이브 경로 링크를 지원한다', async () => {
  const { renderMarkdown } = await import('../public/js/markdown.js')
  const out1 = renderMarkdown('[Mod.cs](file:///H:/source/repos/mod/Mod.cs#L10)')
  assert.ok(out1.includes('class="file-link"'))
  assert.ok(out1.includes('href="file:///H:/source/repos/mod/Mod.cs#L10"'))

  const out2 = renderMarkdown('[Main.cs](H:\\source\\repos\\Main.cs)')
  assert.ok(out2.includes('class="file-link"'))

  const out3 = renderMarkdown('[index.js](server/index.js)')
  assert.ok(out3.includes('class="file-link"'))

  const out4 = renderMarkdown('[Docs](https://example.com)')
  assert.ok(out4.includes('href="https://example.com"'))
  assert.ok(!out4.includes('class="file-link"'))
})

test('desktop: 탐색기 /select 인자는 경로만 따옴표로 감싼다', () => {
  assert.equal(explorerArg('C:\\a b\\c.txt', false), '/select,"C:\\a b\\c.txt"')
  assert.equal(explorerArg('C:\\a b', true), '"C:\\a b"')
})

test('binary: npm .cmd 셈에서 실제 대상을 꺼낸다 (node.exe 줄은 건너뜀)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-duo-shim-'))
  const touch = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), '')
  }
  const shim = (name, body) => {
    fs.writeFileSync(path.join(dir, name), body)
    return path.join(dir, name)
  }
  touch('node.exe')
  touch('node_modules/tool/cli.js')
  touch('node_modules/native/bin/native.exe')
  const jsShim = shim(
    'tool.cmd',
    '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\tool\\cli.js" %*\r\n'
  )
  assert.deepEqual(fromCmdShim(jsShim), { path: path.join(dir, 'node.exe'), shell: false, args: [path.join(dir, 'node_modules', 'tool', 'cli.js')] })
  const exeShim = shim('native.cmd', '@ECHO off\r\n"%~dp0\\node_modules\\native\\bin\\native.exe" %*\r\n')
  assert.deepEqual(fromCmdShim(exeShim), { path: path.join(dir, 'node_modules', 'native', 'bin', 'native.exe'), shell: false, args: [] })
  assert.equal(fromCmdShim(shim('none.cmd', '@ECHO off\r\n"%dp0%\\missing.exe" %*\r\n')), null)
})

test('claude: get_usage 한도와 mcp list 연결 상태를 읽는다', () => {
  const usage = claude.usageProbe.parse(
    JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'duo-get_usage',
        response: {
          subscription_type: 'pro',
          rate_limits: {
            limits: [
              { kind: 'session', group: 'session', percent: 3, resets_at: '2026-10-16T09:00:00Z' },
              { kind: 'weekly_scoped', group: 'weekly', percent: 40, scope: { model: { display_name: 'Fable' } } }
            ],
            extra_usage: { is_enabled: true, used_credits: 6250, decimal_places: 2, currency: 'USD' }
          }
        }
      }
    })
  )
  assert.equal(usage.plan, 'Claude Pro')
  assert.deepEqual(usage.groups[0].windows, [
    { label: '5시간', usedPercent: 3, resetsAt: '2026-10-16T09:00:00Z' },
    { label: '주간 · Fable', usedPercent: 40, resetsAt: null }
  ])
  assert.deepEqual(usage.notes, ['추가 사용 크레딧 $62.50 사용'])
  assert.equal(claude.usageProbe.parse('{"type":"control_response","response":{"subtype":"error","request_id":"duo-get_usage"}}'), null)

  const servers = claude.mcpProbe.parse(
    [
      'Checking MCP server health…',
      '',
      'claude.ai Docs: https://api.example.com/mcp - ✔ Connected',
      'plugin:x:fal: https://mcp.fal.ai/mcp (HTTP) - ✘ Failed to connect — HTTP 401',
      'rea: C:\\Program Files\\nodejs\\node.exe rea.mjs mcp - ✔ Connected',
      'linear: https://mcp.linear.app/sse (SSE) - ! Needs authentication',
      // 파이프로 받을 때(유니코드 터미널 아님)의 대체 표시
      'piped: https://p.dev/mcp - √ Connected',
      'broken: node b.js - × Failed to connect'
    ].join('\n')
  )
  assert.deepEqual(servers, [
    { name: 'claude.ai Docs', type: 'http', target: 'https://api.example.com/mcp', status: 'connected' },
    { name: 'plugin:x:fal', type: 'http', target: 'https://mcp.fal.ai/mcp', status: 'failed', detail: 'HTTP 401' },
    { name: 'rea', type: 'stdio', target: 'C:\\Program Files\\nodejs\\node.exe rea.mjs mcp', status: 'connected' },
    { name: 'linear', type: 'sse', target: 'https://mcp.linear.app/sse', status: 'needs-auth' },
    { name: 'piped', type: 'http', target: 'https://p.dev/mcp', status: 'connected' },
    { name: 'broken', type: 'stdio', target: 'node b.js', status: 'failed' }
  ])
})

test('antigravity: /usage 남은 비율을 사용률로, mcp list 표를 읽는다', () => {
  const usage = antigravity.usageProbe.parse(
    JSON.stringify({
      status: 'SUCCESS',
      num_turns: 0,
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                { window: '5h', name: 'Five Hour Limit Remaining', remaining_fraction: 0.895, reset_time: '2026-10-16T05:14:36Z' },
                { window: 'weekly', name: 'Weekly', remaining_fraction: 1 }
              ]
            }
          ]
        }
      }
    })
  )
  assert.deepEqual(usage.groups[0].windows, [
    { label: '5시간', usedPercent: 10.5, resetsAt: '2026-10-16T05:14:36Z' },
    { label: '주간', usedPercent: 0, resetsAt: null }
  ])
  assert.equal(usage.plan, 'Antigravity Pro')
  assert.equal(antigravity.usageProbe.parse('{"status":"SUCCESS","response":"모델 답변"}'), null, '명령 응답이 아니면 버린다')
  assert.ok(!antigravity.usageProbe.args.includes('--disable-slash-commands'), '/usage가 일반 프롬프트로 가면 턴을 쓴다')

  const servers = antigravity.mcpProbe.parse(
    'NAME                  TYPE   STATUS    COMMAND/URL\nmodding-support-tool  stdio  enabled   H:\\tools\\Modding Tool.exe mcp\nweb                   http   disabled  https://x.dev/mcp\n'
  )
  assert.deepEqual(servers, [
    { name: 'modding-support-tool', type: 'stdio', target: 'H:\\tools\\Modding Tool.exe mcp', status: 'enabled' },
    { name: 'web', type: 'http', target: 'https://x.dev/mcp', status: 'disabled' }
  ])
  assert.ok(versionAtLeast('agy 1.3.6', '1.1.11'))
  assert.ok(!versionAtLeast('1.1.9', '1.1.11'))
  assert.ok(!versionAtLeast(null, '1.1.11'))
})

test('claude & antigravity: plugin list 파싱 (universal-modder 및 스킬)', () => {
  const agyPlugins = antigravity.pluginProbe.parse(
    'Installed plugins:\n- google-antigravity-sdk (enabled, 0.0.9)\n    Source:     antigravity-plugins-official\n    Components: 1 skill\n- universal-modder (enabled, 0.2.0)\n    Source:     antigravity\n    Components: 12 skills\n'
  )
  assert.deepEqual(agyPlugins, [
    { name: 'google-antigravity-sdk', status: 'enabled', version: '0.0.9', detail: '1 skill' },
    { name: 'universal-modder', status: 'enabled', version: '0.2.0', detail: '12 skills' }
  ])

  const clPlugins = claude.pluginProbe.parse(
    'Installed plugins:\n\n  > universal-modder@universal-modder\n    Version: 8370faa8e114\n    Scope: user\n    Status: √ enabled\n'
  )
  assert.deepEqual(clPlugins, [
    { name: 'universal-modder', status: 'enabled', version: '8370faa8e114', detail: 'user' }
  ])
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

test('attachments: 첨부 이미지가 있으면 프롬프트에 경로를 포함한다', () => {
  const attachUser = (agent, text, attachments) => ({
    id: 'u',
    role: 'user',
    agent,
    text,
    attachments,
    createdAt: Date.now()
  })
  const c = conv(
    [
      attachUser('claude', '이 스크린샷 에러 분석해줘', [{ path: 'C:\\test\\shot.png', name: 'shot.png' }])
    ],
    { claude: -1, antigravity: -1 },
    { claude: null, antigravity: null }
  )
  const { prompt } = buildPrompt(c, 'claude', 0)
  assert.match(prompt, /\[첨부 이미지: C:\\test\\shot\.png\]\n\n이 스크린샷 에러 분석해줘/)

  const c2 = conv(
    [
      attachUser('claude', '에러 났어', [{ path: 'C:\\img\\1.png' }]),
      a('claude', '확인해볼게요'),
      u('antigravity', '수정해줘')
    ],
    { claude: 1, antigravity: -1 },
    { claude: 's1', antigravity: null }
  )
  const p2 = buildPrompt(c2, 'antigravity', 2).prompt
  assert.match(p2, /\[사용자 → Claude\]\n\[첨부 이미지: C:\\img\\1\.png\]/)
})

test('relay: [DONE] 조기 종료 트리거를 감지한다', () => {
  assert.ok(isRelayDone({ parts: [{ kind: 'text', text: '모든 수정 및 검증이 완료되었습니다.\n[DONE]' }] }))
  assert.ok(isRelayDone({ parts: [{ kind: 'text', text: '[done]' }] }))
  assert.ok(isRelayDone({ parts: [{ kind: 'text', text: '작업 완료. [DONE] ' }] }))
  assert.ok(!isRelayDone({ parts: [{ kind: 'text', text: '진행 중입니다 (not done yet)' }] }))
  assert.ok(!isRelayDone({ parts: [{ kind: 'tool', name: 'Bash' }] }))
  assert.ok(!isRelayDone(null))
})

