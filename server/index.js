'use strict'
// Orca Duo 로컬 서버: UI 정적 파일 + JSON API + SSE 이벤트 스트림. 127.0.0.1에만 붙는다.
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

// `--data=<폴더>`: 대화 저장 위치 바꾸기 (store를 불러오기 전에 정해야 한다).
const dataArg = process.argv.find((a) => a.startsWith('--data='))
if (require.main === module && dataArg) process.env.ORCA_DUO_DATA = dataArg.slice('--data='.length)

const store = require('./store')
const { createAgentRegistry } = require('./agents')
const { AGENT_IDS } = require('./agents/shared')
const { createOrchestrator } = require('./orchestrator')
const { HttpError, json, readBody, serveStatic } = require('./http')
const desktop = require('./desktop')

function validDir(p) {
  try {
    return typeof p === 'string' && p && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 폴더 대화상자의 프로젝트 목록: 마지막 폴더가 `repos`면 그 아래, 아니면 기본 저장소 폴더 아래. */
function listRepos(lastCwd) {
  const root =
    validDir(lastCwd) && path.basename(lastCwd).toLowerCase() === 'repos'
      ? lastCwd
      : validDir(store.DEFAULT_REPOS_ROOT)
        ? store.DEFAULT_REPOS_ROOT
        : null
  const repos = []
  if (root) {
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) repos.push({ name: ent.name, path: path.join(root, ent.name) })
      }
      repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    } catch {}
  }
  return { root, repos }
}

function startServer({ port = 0, host = '127.0.0.1' } = {}) {
  const token = crypto.randomBytes(18).toString('hex')
  let settings = store.loadSettings()
  const clients = new Set()

  function broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of clients) res.write(data)
  }

  const registry = createAgentRegistry({
    getSettings: () => settings,
    onChange: () => broadcast({ type: 'agents', agents: registry.publicInfo() })
  })
  const orchestrator = createOrchestrator({ agents: registry.agents, broadcast, getSettings: () => settings })

  function rememberCwd(cwd) {
    if (cwd === settings.lastCwd) return
    settings.lastCwd = cwd
    store.saveSettings(settings)
  }

  function openEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    res.write('retry: 1500\n\n')
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
  }

  async function handleConversation(req, res, id, action) {
    const method = req.method
    if (!id && method === 'POST') {
      const body = await readBody(req)
      const cwd = validDir(body.cwd) ? body.cwd : validDir(settings.lastCwd) ? settings.lastCwd : os.homedir()
      const conv = store.create(cwd)
      broadcast({ type: 'conv-list', conversations: store.list() })
      return json(res, 200, conv)
    }
    const conv = id ? store.get(id) : null
    if (!conv) throw new HttpError(404, '대화를 찾을 수 없습니다')

    if (!action && method === 'GET') return json(res, 200, conv)

    if (!action && method === 'PATCH') {
      const body = await readBody(req)
      if (typeof body.title === 'string' && body.title.trim()) conv.title = body.title.trim().slice(0, 120)
      if (typeof body.cwd === 'string' && body.cwd !== conv.cwd) {
        if (orchestrator.isRunning(id)) throw new HttpError(409, '응답 중에는 폴더를 바꿀 수 없습니다')
        if (!validDir(body.cwd)) throw new HttpError(400, `폴더가 없습니다: ${body.cwd}`)
        conv.cwd = body.cwd
        // Why: CLI 세션은 폴더별로 저장되므로 폴더가 바뀌면 새 세션을 열고 대화 전체를 컨텍스트로 넘긴다.
        conv.sessions = { claude: null, antigravity: null }
        conv.seen = { claude: -1, antigravity: -1 }
        conv.messages.push({ id: store.newId(), role: 'system', text: `작업 폴더 변경 → ${body.cwd}`, createdAt: Date.now() })
        rememberCwd(body.cwd)
      }
      conv.updatedAt = Date.now()
      store.saveNow(conv)
      broadcast({ type: 'conversation', conversation: conv })
      broadcast({ type: 'conv-list', conversations: store.list() })
      return json(res, 200, conv)
    }

    if (!action && method === 'DELETE') {
      orchestrator.stop(id)
      store.remove(id)
      broadcast({ type: 'conv-list', conversations: store.list() })
      return json(res, 200, { ok: true })
    }

    if (action === 'send' && method === 'POST') {
      const result = orchestrator.send(id, await readBody(req))
      rememberCwd(conv.cwd)
      return json(res, 200, result)
    }

    if (action === 'stop' && method === 'POST') {
      orchestrator.stop(id)
      return json(res, 200, { ok: true })
    }
    throw new HttpError(404, '없는 API')
  }

  async function handleApi(req, res, url) {
    const method = req.method
    const [route, id, action] = url.pathname.split('/').filter(Boolean).slice(1) // "api" 다음부터

    if (route === 'events' && method === 'GET') return openEvents(req, res)

    if (route === 'state' && method === 'GET') {
      const running = {}
      for (const c of store.list()) {
        if (orchestrator.isRunning(c.id)) running[c.id] = orchestrator.runningAgent(c.id)
      }
      return json(res, 200, { conversations: store.list(), agents: registry.publicInfo(), settings, running, dataDir: store.DATA_DIR })
    }

    if (route === 'settings' && method === 'POST') {
      const body = await readBody(req)
      const next = { ...settings }
      for (const key of ['relayPrompt', 'claudePath', 'antigravityPath']) {
        if (typeof body[key] === 'string') next[key] = body[key].trim()
      }
      if (typeof body.autoFailover === 'boolean') next.autoFailover = body.autoFailover
      if (!next.relayPrompt) next.relayPrompt = store.DEFAULT_SETTINGS.relayPrompt
      settings = next
      store.saveSettings(settings)
      registry.detect()
      return json(res, 200, { settings, agents: registry.publicInfo() })
    }

    if (route === 'agents' && method === 'GET' && AGENT_IDS.includes(id)) {
      const force = url.searchParams.get('refresh') === '1'
      if (action === 'usage') return json(res, 200, await registry.fetchUsage(id, { force }))
      if (action === 'mcp') return json(res, 200, await registry.fetchMcp(id, { cwd: url.searchParams.get('cwd'), force }))
      if (action === 'plugins') return json(res, 200, await registry.fetchPlugins(id, { force }))
    }

    if (route === 'pick-folder' && method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, { path: await desktop.pickFolder(validDir(body.initial) ? body.initial : settings.lastCwd) })
    }

    if (route === 'list-repos' && method === 'GET') return json(res, 200, listRepos(settings.lastCwd))

    if (route === 'check-folder' && method === 'POST') {
      const body = await readBody(req)
      const p = typeof body.path === 'string' ? path.resolve(body.path.trim().replace(/^"|"$/g, '')) : ''
      return json(res, 200, { ok: validDir(p), path: p })
    }

    if (route === 'open-path' && method === 'POST') {
      const body = await readBody(req)
      let p = typeof body.path === 'string' ? body.path.trim() : ''
      if (p && !path.isAbsolute(p) && validDir(body.cwd)) p = path.resolve(body.cwd, p)
      if (!p || !fs.existsSync(p)) throw new HttpError(404, `경로가 없습니다: ${p}`)
      desktop.revealPath(p)
      return json(res, 200, { ok: true })
    }

    if (route === 'upload-image' && method === 'POST') {
      const body = await readBody(req)
      const dataUri = typeof body.data === 'string' ? body.data : ''
      const match = dataUri.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i)
      if (!match) throw new HttpError(400, '올바른 base64 이미지 데이터가 아닙니다')
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
      const buf = Buffer.from(match[2], 'base64')
      const id = store.newId()
      const filename = `${id}.${ext}`
      const targetPath = path.join(store.ATTACHMENTS_DIR, filename)
      fs.writeFileSync(targetPath, buf)
      return json(res, 200, {
        id,
        filename,
        path: targetPath,
        url: `/api/attachments/${filename}`,
        name: typeof body.name === 'string' && body.name ? body.name : filename,
        size: buf.length
      })
    }

    if (route === 'attachments' && method === 'GET' && id) {
      if (!/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif)$/i.test(id)) throw new HttpError(400, '잘못된 파일명')
      const targetPath = path.join(store.ATTACHMENTS_DIR, id)
      if (!fs.existsSync(targetPath)) throw new HttpError(404, '이미지를 찾을 수 없습니다')
      const ext = path.extname(targetPath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
      fs.createReadStream(targetPath).pipe(res)
      return
    }

    if (route === 'conversations') return handleConversation(req, res, id, action)

    throw new HttpError(404, '없는 API')
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Why: DNS 리바인딩 방지 — 다른 호스트 이름으로 들어온 요청은 거절.
      const hostHeader = String(req.headers.host || '')
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(hostHeader)) {
        res.writeHead(403)
        return res.end('forbidden host')
      }
      const url = new URL(req.url, `http://${hostHeader}`)
      if (url.pathname.startsWith('/api/')) {
        // Why: 브라우저의 다른 사이트가 localhost API를 몰래 호출해 에이전트를 돌리지 못하게 토큰을 요구한다.
        const given = req.headers['x-duo-token'] || url.searchParams.get('token')
        if (given !== token) return json(res, 401, { error: '토큰이 맞지 않습니다. 페이지를 새로고침하세요' })
        return await handleApi(req, res, url)
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      return serveStatic(res, url.pathname, token)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      if (!res.headersSent) json(res, status, { error: err.message || String(err) })
      else res.end()
    }
  })

  registry.detect()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const actualPort = server.address().port
      resolve({
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/`,
        close() {
          orchestrator.stopAll()
          store.flushAll()
          for (const res of clients) res.end()
          server.close()
        }
      })
    })
  })
}

module.exports = { startServer }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const portArg = argv.find((a) => a.startsWith('--port='))
  const port = portArg ? Number(portArg.split('=')[1]) : 47321
  startServer({ port })
    .catch((err) => {
      // 기본 포트를 다른 프로그램이 쓰고 있으면 빈 포트로 띄운다.
      if (err.code === 'EADDRINUSE' && !portArg) return startServer({ port: 0 })
      throw err
    })
    .then(({ url, close }) => {
      console.log(`Orca Duo 실행 중: ${url}`)
      console.log(`데이터 폴더: ${store.DATA_DIR}`)
      if (argv.includes('--open')) desktop.openUrl(url)
      const shutdown = () => {
        close()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
}
