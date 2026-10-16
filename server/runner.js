'use strict'
// 한 턴 = 프로세스 하나. 세션 ID로 이어가므로 앱을 껐다 켜도 대화가 이어진다.
const { spawn, spawnSync } = require('node:child_process')

const isWin = process.platform === 'win32'
const STDERR_TAIL = 4000

function quoteForShell(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${String(arg).replace(/"/g, '""')}"`
}

/**
 * @param {object} o
 * @param {object} o.adapter  agents/claude.js 또는 agents/antigravity.js
 * @param {{path:string, shell:boolean}} o.binary
 * @param {(ev:object)=>void} o.onEvent
 */
function runTurn({ adapter, binary, cwd, prompt, sessionId, model, effort, permission, onEvent }) {
  const args = adapter.buildArgs({ sessionId, model, effort, permission })
  const env = adapter.buildEnv(process.env)
  const child = binary.shell
    ? spawn([quoteForShell(binary.path), ...args.map(quoteForShell)].join(' '), {
        cwd,
        env,
        shell: true,
        windowsHide: true
      })
    : spawn(binary.path, args, { cwd, env, windowsHide: true })

  let finished = false
  let cancelled = false
  let stderr = ''
  let buffer = ''
  let pendingDone = null
  let pendingTimer = null

  // Why: 결과 줄 뒤에 stderr 안내(예: agy의 "auto-denied")가 늦게 붙어 오므로, 프로세스가 닫힐 때까지
  // (최대 3초) 기다렸다가 stderr 꼬리를 같이 실어 보낸다.
  function emitPendingDone() {
    if (!pendingDone) return
    clearTimeout(pendingTimer)
    const ev = pendingDone
    pendingDone = null
    ev.stderr = stderr
    onEvent(ev)
  }
  const parse = adapter.createParser((ev) => {
    if (ev.type === 'done') {
      finished = true
      pendingDone = ev
      pendingTimer = setTimeout(emitPendingDone, 3000)
      return
    }
    onEvent(ev)
  })

  const done = new Promise((resolve) => {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          stderr = (stderr + line + '\n').slice(-STDERR_TAIL)
          continue
        }
        try {
          parse(obj)
        } catch (err) {
          stderr = (stderr + String(err) + '\n').slice(-STDERR_TAIL)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL)
    })
    child.on('error', (err) => {
      emitPendingDone()
      if (!finished) {
        finished = true
        onEvent({ type: 'done', isError: true, error: `실행 실패: ${err.message}` })
      }
      resolve()
    })
    child.on('close', (code) => {
      if (buffer.trim()) {
        try {
          parse(JSON.parse(buffer.trim()))
        } catch {
          stderr = (stderr + buffer).slice(-STDERR_TAIL)
        }
      }
      emitPendingDone()
      if (!finished) {
        finished = true
        onEvent(
          cancelled
            ? { type: 'done', isError: false, stopped: true }
            : {
                type: 'done',
                isError: true,
                error: (stderr.trim() || `프로세스가 종료됨 (코드 ${code})`).slice(-1500)
              }
        )
      }
      resolve()
    })
  })

  child.stdin.on('error', () => {})
  child.stdin.end(adapter.stdinPayload(prompt), 'utf8')

  function cancel() {
    if (finished || cancelled) return
    cancelled = true
    if (isWin && child.pid) {
      // Why: 에이전트가 띄운 셸/빌드 프로세스까지 같이 끊어야 한다 (Orca automations/precheck-runner.ts와 같은 방식).
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
  }

  return { cancel, done, args }
}

module.exports = { runTurn }
