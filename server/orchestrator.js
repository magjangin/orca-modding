'use strict'
// 대화 하나에 한 번에 한 턴만 돈다. 턴이 끝나면 (핑퐁이 켜져 있으면) 상대 에이전트에게 자동으로 넘긴다.
const fs = require('node:fs')
const store = require('./store')
const { runTurn } = require('./runner')
const { buildPrompt } = require('./handoff')

const OTHER = { claude: 'antigravity', antigravity: 'claude' }
const MISSING_SESSION_RE = /no conversation found|conversation .*not found|session .*not found|could not find|does not exist/i
// 쿼터/사용량 초과/Rate limit/잔액 부족 감지 패턴
const QUOTA_ERROR_RE = /quota|rate.?limit|exceeded|insufficient_quota|credit.?balance|too low|resource.?exhausted|overloaded|usage limit|hit your limit/i
const FLUSH_MS = 50

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function createOrchestrator({ agents, broadcast, getSettings }) {
  const running = new Map() // convId -> { cancel, agent, msgId, stopRequested }
  const relayTimers = new Map()

  function isRunning(convId) {
    return running.has(convId) || relayTimers.has(convId)
  }

  function runningAgent(convId) {
    const r = running.get(convId)
    return r ? r.agent : null
  }

  function publishRunning(convId) {
    broadcast({ type: 'running', convId, agent: runningAgent(convId), pendingRelay: relayTimers.has(convId) })
  }

  function send(convId, body) {
    const conv = store.get(convId)
    if (!conv) throw new HttpError(404, '대화를 찾을 수 없습니다')
    if (running.has(convId)) throw new HttpError(409, '아직 응답 중입니다. 끝나거나 멈춘 뒤에 보내세요')
    clearTimeout(relayTimers.get(convId))
    relayTimers.delete(convId)

    const agent = body.agent
    const info = agents[agent]
    if (!info) throw new HttpError(400, '알 수 없는 에이전트')
    if (!info.binary) throw new HttpError(400, `${info.adapter.label} CLI(${info.adapter.binaryName})를 찾을 수 없습니다. 설정에서 경로를 지정하세요`)
    if (!conv.cwd || !fs.existsSync(conv.cwd)) throw new HttpError(400, `작업 폴더가 없습니다: ${conv.cwd}`)
    const text = String(body.text || '').trim()
    if (!text) throw new HttpError(400, '빈 메시지')

    const prefs = normalizePrefs(body.prefs)
    const relayRounds = Math.max(0, Math.min(10, Number(body.relayRounds) || 0))

    const now = Date.now()
    const userMsg = { id: store.newId(), role: 'user', agent, text, createdAt: now, auto: Boolean(body.auto) }
    conv.messages.push(userMsg)
    const userIndex = conv.messages.length - 1
    const { prompt, handoffCount } = buildPrompt(conv, agent, userIndex)
    userMsg.handoffCount = handoffCount
    const asst = {
      id: store.newId(),
      role: 'assistant',
      agent,
      parts: [],
      status: 'streaming',
      meta: { model: prefs[agent].model, permission: prefs[agent].permission, relayLeft: relayRounds },
      createdAt: now
    }
    conv.messages.push(asst)
    if (conv.title === '새 대화' && !body.auto) conv.title = text.replace(/\s+/g, ' ').slice(0, 48)
    conv.updatedAt = now

    broadcast({ type: 'message', convId, message: userMsg })
    broadcast({ type: 'message', convId, message: asst })
    broadcast({ type: 'conv-list', conversations: store.list() })
    startTurn(conv, asst, userIndex, prompt, { prefs, relayRounds, retried: false, failedOver: Boolean(body.failedOver) })
    return { userId: userMsg.id, assistantId: asst.id }
  }

  function normalizePrefs(p) {
    const out = {}
    for (const a of ['claude', 'antigravity']) {
      const src = (p && p[a]) || {}
      out[a] = {
        model: typeof src.model === 'string' && src.model ? src.model : 'default',
        permission: ['plan', 'edit', 'full'].includes(src.permission) ? src.permission : 'edit'
      }
    }
    return out
  }

  function startTurn(conv, asst, userIndex, prompt, ctx) {
    const agent = asst.agent
    const info = agents[agent]
    const sessionId = conv.sessions[agent]
    const startedAt = Date.now()
    let delivered = false
    let produced = false
    const dirty = new Set()
    let flushTimer = null

    function flush() {
      clearTimeout(flushTimer)
      flushTimer = null
      if (!dirty.size) return
      const patches = [...dirty].map((i) => [i, asst.parts[i]])
      dirty.clear()
      broadcast({ type: 'parts', convId: conv.id, msgId: asst.id, patches, meta: asst.meta })
      store.saveSoon(conv)
    }
    function touch(index) {
      produced = true
      dirty.add(index)
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
    }
    function last() {
      return asst.parts[asst.parts.length - 1]
    }
    function appendTo(kind, delta) {
      let p = last()
      if (!p || p.kind !== kind) {
        p = { kind, text: '' }
        asst.parts.push(p)
      }
      p.text += delta
      touch(asst.parts.length - 1)
    }

    const turn = runTurn({
      adapter: info.adapter,
      binary: info.binary,
      cwd: conv.cwd,
      prompt,
      sessionId,
      model: ctx.prefs[agent].model,
      permission: ctx.prefs[agent].permission,
      onEvent(ev) {
        switch (ev.type) {
          case 'session':
            delivered = true
            if (ev.sessionId) conv.sessions[agent] = ev.sessionId
            if (ev.model) asst.meta.resolvedModel = ev.model
            return
          case 'text-start': {
            const p = last()
            if (p && p.kind === 'text' && p.text.trim()) {
              asst.parts.push({ kind: 'text', text: '' })
            }
            return
          }
          case 'text':
            appendTo('text', ev.delta)
            return
          case 'thinking-start':
            asst.parts.push({ kind: 'thinking', text: '' })
            return
          case 'thinking':
            appendTo('thinking', ev.delta)
            return
          case 'tool': {
            let index = asst.parts.findIndex((p) => p.kind === 'tool' && p.id === ev.id)
            if (index === -1) {
              asst.parts.push({ kind: 'tool', id: ev.id, name: ev.name || 'tool', input: ev.input, output: null, status: 'running' })
              index = asst.parts.length - 1
            }
            const p = asst.parts[index]
            if (ev.name) p.name = ev.name
            if (ev.input !== undefined) p.input = ev.input
            if (ev.output !== undefined && ev.output !== null) p.output = clipOutput(ev.output)
            if (ev.status) p.status = ev.status
            touch(index)
            return
          }
          case 'done':
            flush()
            finish(ev)
            return
          default:
        }
      }
    })
    running.set(conv.id, { cancel: turn.cancel, agent, msgId: asst.id, stopRequested: false })
    publishRunning(conv.id)

    function finish(ev) {
      const r = running.get(conv.id)
      const stopRequested = Boolean(r && r.stopRequested)
      running.delete(conv.id)

      if (ev.isError && !ctx.retried && sessionId && !produced && MISSING_SESSION_RE.test(ev.error || '')) {
        // Why: CLI 쪽 세션 기록이 지워졌으면 새 세션으로 다시 시작하고, 대화 전체를 컨텍스트로 다시 넘긴다.
        conv.sessions[agent] = null
        conv.seen[agent] = -1
        const rebuilt = buildPrompt(conv, agent, userIndex)
        conv.messages[userIndex].handoffCount = rebuilt.handoffCount
        broadcast({ type: 'message', convId: conv.id, message: conv.messages[userIndex] })
        startTurn(conv, asst, userIndex, rebuilt.prompt, { ...ctx, retried: true })
        return
      }

      if (ev.stopped || stopRequested) asst.status = 'stopped'
      else if (ev.isError) {
        asst.status = 'error'
        asst.error = ev.error
      } else asst.status = 'done'
      for (const p of asst.parts) {
        if (p.kind === 'tool' && p.status === 'running') p.status = asst.status === 'done' ? 'done' : 'error'
      }
      let denied = ev.deniedTools && ev.deniedTools.length ? ev.deniedTools : []
      if (!denied.length && /auto-denied|cannot prompt for/i.test(ev.stderr || '')) {
        // Why: agy는 헤드리스에서 권한이 필요한 도구를 자동 거부하고 그 사실을 stderr에만 남긴다.
        denied = asst.parts.filter((p) => p.kind === 'tool' && p.status === 'error').map((p) => p.name)
        if (!denied.length) denied = ['명령 실행']
      }
      Object.assign(asst.meta, {
        // Why: agy의 duration_seconds는 대화 누적값이라, 두 에이전트 모두 이번 턴의 실제 경과 시간으로 통일한다.
        durationMs: Date.now() - startedAt,
        costUsd: ev.costUsd ?? null,
        tokens: ev.tokens ?? null,
        deniedTools: denied.length ? [...new Set(denied)] : undefined
      })
      if (ev.sessionId) conv.sessions[agent] = ev.sessionId
      if (delivered || ev.sessionId) conv.seen[agent] = conv.messages.indexOf(asst)
      conv.updatedAt = Date.now()
      store.saveNow(conv)
      broadcast({ type: 'message', convId: conv.id, message: asst })
      broadcast({ type: 'conv-list', conversations: store.list() })

      if (asst.status === 'done' && ctx.relayRounds > 0 && store.get(conv.id)) {
        const timer = setTimeout(() => {
          relayTimers.delete(conv.id)
          try {
            send(conv.id, {
              agent: OTHER[agent],
              text: getSettings().relayPrompt,
              prefs: ctx.prefs,
              relayRounds: ctx.relayRounds - 1,
              auto: true
            })
          } catch (err) {
            broadcast({ type: 'toast', convId: conv.id, level: 'error', message: `자동 핑퐁 중단: ${err.message}` })
            publishRunning(conv.id)
          }
        }, 400)
        relayTimers.set(conv.id, timer)
      } else if (asst.status === 'error' && !ctx.failedOver && store.get(conv.id)) {
        const settings = getSettings()
        const isQuota = QUOTA_ERROR_RE.test(`${ev.error || ''} ${ev.stderr || ''}`)
        const otherAgent = OTHER[agent]
        const otherInfo = agents[otherAgent]
        if (settings.autoFailover !== false && isQuota && otherInfo && otherInfo.binary) {
          const timer = setTimeout(() => {
            relayTimers.delete(conv.id)
            try {
              broadcast({
                type: 'toast',
                convId: conv.id,
                level: 'warn',
                message: `⚠️ ${agent === 'claude' ? 'Claude' : 'Antigravity'} 쿼터/사용량 제한 감지 → ${otherAgent === 'claude' ? 'Claude' : 'Antigravity'}가 이어서 진행합니다.`
              })
              send(conv.id, {
                agent: otherAgent,
                text: `${agent === 'claude' ? 'Claude' : 'Antigravity'}가 사용량/쿼터 한도에 도달하여 중단되었습니다. 위 대화와 맥락을 이어서 진행해줘.`,
                prefs: ctx.prefs,
                relayRounds: ctx.relayRounds,
                auto: true,
                failedOver: true
              })
            } catch (err) {
              broadcast({ type: 'toast', convId: conv.id, level: 'error', message: `자동 바톤터치 실패: ${err.message}` })
              publishRunning(conv.id)
            }
          }, 600)
          relayTimers.set(conv.id, timer)
        }
      }
      publishRunning(conv.id)
    }
  }

  function stop(convId) {
    const timer = relayTimers.get(convId)
    if (timer) {
      clearTimeout(timer)
      relayTimers.delete(convId)
    }
    const r = running.get(convId)
    if (r) {
      r.stopRequested = true
      r.cancel()
    }
    publishRunning(convId)
  }

  function stopAll() {
    for (const id of [...running.keys(), ...relayTimers.keys()]) stop(id)
  }

  return { send, stop, stopAll, isRunning, runningAgent, HttpError }
}

function clipOutput(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return s.length > 20000 ? s.slice(0, 20000) + `\n…(${s.length - 20000}자 생략)` : s
}

module.exports = { createOrchestrator, HttpError, QUOTA_ERROR_RE }
