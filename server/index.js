'use strict'
// Orca Duo 로컬 서버: UI 정적 파일 + JSON API + SSE 이벤트 스트림. 127.0.0.1에만 붙는다.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')

// `--data=<폴더>`: 대화 저장 위치 바꾸기 (store를 불러오기 전에 정해야 한다).
const dataArg = process.argv.find((a) => a.startsWith('--data='))
if (require.main === module && dataArg) process.env.ORCA_DUO_DATA = dataArg.slice('--data='.length)

const store = require('./store')
const { resolveBinary } = require('./agents/binary')
const claude = require('./agents/claude')
const antigravity = require('./agents/antigravity')
const { createOrchestrator, HttpError } = require('./orchestrator')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const MAX_BODY = 8 * 1024 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

function startServer({ port = 0, host = '127.0.0.1' } = {}) {
  const token = crypto.randomBytes(18).toString('hex')
  let settings = store.loadSettings()
  const clients = new Set()

  const agents = {
    claude: { adapter: claude, binary: null, version: null, models: claude.models },
    antigravity: { adapter: antigravity, binary: null, version: null, models: antigravity.models }
  }

  function broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of clients) res.write(data)
  }

  function detectAgents() {
    for (const [id, info] of Object.entries(agents)) {
      info.binary = resolveBinary(info.adapter.binaryName, settings[`${id}Path`] || '')
      info.version = null
      if (!info.binary) continue
      execFile(
        info.binary.path,
        ['--version'],
        { timeout: 15000, windowsHide: true, shell: info.binary.shell },
        (err, stdout) => {
          info.version = err ? null : String(stdout).trim().split(/\r?\n/)[0].slice(0, 60)
          broadcast({ type: 'agents', agents: agentsPublic() })
        }
      )
    }
    refreshAntigravityModels()
  }

  let modelsLoading = null
  function refreshAntigravityModels() {
    const info = agents.antigravity
    if (!info.binary || modelsLoading) return modelsLoading
    modelsLoading = new Promise((resolve) => {
      execFile(
        info.binary.path,
        ['models'],
        { timeout: 45000, windowsHide: true, shell: info.binary.shell },
        (err, stdout) => {
          modelsLoading = null
          const parsed = err ? [] : antigravity.parseModels(stdout)
          if (parsed.length) {
            info.models = [{ id: 'default', label: '기본값' }, ...parsed]
            broadcast({ type: 'agents', agents: agentsPublic() })
          }
          resolve()
        }
      )
    })
    return modelsLoading
  }

  function agentsPublic() {
    const out = {}
    for (const [id, info] of Object.entries(agents)) {
      out[id] = {
        id,
        label: info.adapter.label,
        available: Boolean(info.binary),
        path: info.binary ? info.binary.path : null,
        version: info.version,
        models: info.models
      }
    }
    return out
  }

  const orchestrator = createOrchestrator({ agents, broadcast, getSettings: () => settings })

  function json(res, status, body) {
    const data = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(data)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(new HttpError(413, '요청이 너무 큽니다'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (!chunks.length) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new HttpError(400, '잘못된 JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  function validDir(p) {
    try {
      return typeof p === 'string' && p && fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  }

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const file = path.normalize(path.join(PUBLIC_DIR, rel))
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' })
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'not found' })
      const ext = path.extname(file).toLowerCase()
      if (ext === '.html') data = Buffer.from(data.toString('utf8').replace('%%DUO_TOKEN%%', token))
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(data)
    })
  }

  async function handleApi(req, res, url) {
    const method = req.method
    const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"

    if (parts[0] === 'events' && method === 'GET') {
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
      return
    }

    if (parts[0] === 'state' && method === 'GET') {
      const running = {}
      for (const c of store.list()) {
        if (orchestrator.isRunning(c.id)) running[c.id] = orchestrator.runningAgent(c.id)
      }
      return json(res, 200, {
        conversations: store.list(),
        agents: agentsPublic(),
        settings,
        running,
        dataDir: store.DATA_DIR,
        platform: process.platform
      })
    }

    if (parts[0] === 'settings' && method === 'POST') {
      const body = await readBody(req)
      const next = { ...settings }
      for (const key of ['relayPrompt', 'claudePath', 'antigravityPath']) {
        if (typeof body[key] === 'string') next[key] = body[key].trim()
      }
      if (typeof body.autoFailover === 'boolean') next.autoFailover = body.autoFailover
      if (!next.relayPrompt) next.relayPrompt = store.DEFAULT_SETTINGS.relayPrompt
      settings = next
      store.saveSettings(settings)
      detectAgents()
      return json(res, 200, { settings, agents: agentsPublic() })
    }

    if (parts[0] === 'models' && parts[1] === 'antigravity' && method === 'GET') {
      await refreshAntigravityModels()
      return json(res, 200, { models: agents.antigravity.models })
    }

    if (parts[0] === 'pick-folder' && method === 'POST') {
      const body = await readBody(req)
      const picked = await pickFolderNative(validDir(body.initial) ? body.initial : settings.lastCwd)
      return json(res, 200, { path: picked })
    }

    if (parts[0] === 'list-repos' && method === 'GET') {
      const root = validDir(settings.lastCwd) && path.basename(settings.lastCwd).toLowerCase() === 'repos'
        ? settings.lastCwd
        : fs.existsSync('H:\\source\\repos')
          ? 'H:\\source\\repos'
          : null
      const list = []
      if (root) {
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true })
          for (const ent of entries) {
            if (ent.isDirectory() && !ent.name.startsWith('.')) {
              list.push({ name: ent.name, path: path.join(root, ent.name) })
            }
          }
          list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        } catch {}
      }
      return json(res, 200, { root, repos: list })
    }

    if (parts[0] === 'check-folder' && method === 'POST') {
      const body = await readBody(req)
      const p = typeof body.path === 'string' ? path.resolve(body.path.trim().replace(/^"|"$/g, '')) : ''
      return json(res, 200, { ok: validDir(p), path: p })
    }

    if (parts[0] === 'open-path' && method === 'POST') {
      const body = await readBody(req)
      const p = typeof body.path === 'string' ? body.path : ''
      if (!p || !fs.existsSync(p)) throw new HttpError(404, `경로가 없습니다: ${p}`)
      openInExplorer(p)
      return json(res, 200, { ok: true })
    }

    if (parts[0] === 'conversations') {
      const id = parts[1]
      if (!id && method === 'POST') {
        const body = await readBody(req)
        const cwd = validDir(body.cwd) ? body.cwd : validDir(settings.lastCwd) ? settings.lastCwd : require('node:os').homedir()
        const conv = store.create(cwd)
        broadcast({ type: 'conv-list', conversations: store.list() })
        return json(res, 200, conv)
      }
      const conv = id ? store.get(id) : null
      if (!conv) throw new HttpError(404, '대화를 찾을 수 없습니다')

      if (!parts[2] && method === 'GET') return json(res, 200, conv)

      if (!parts[2] && method === 'PATCH') {
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
          settings.lastCwd = body.cwd
          store.saveSettings(settings)
        }
        conv.updatedAt = Date.now()
        store.saveNow(conv)
        broadcast({ type: 'conversation', conversation: conv })
        broadcast({ type: 'conv-list', conversations: store.list() })
        return json(res, 200, conv)
      }

      if (!parts[2] && method === 'DELETE') {
        orchestrator.stop(id)
        store.remove(id)
        broadcast({ type: 'conv-list', conversations: store.list() })
        return json(res, 200, { ok: true })
      }

      if (parts[2] === 'send' && method === 'POST') {
        const body = await readBody(req)
        const result = orchestrator.send(id, body)
        if (conv.cwd !== settings.lastCwd) {
          settings.lastCwd = conv.cwd
          store.saveSettings(settings)
        }
        return json(res, 200, result)
      }

      if (parts[2] === 'stop' && method === 'POST') {
        orchestrator.stop(id)
        return json(res, 200, { ok: true })
      }
    }

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
      return serveStatic(req, res, url.pathname)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      if (!res.headersSent) json(res, status, { error: err.message || String(err) })
      else res.end()
    }
  })

  detectAgents()

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

function pickFolderNative(initial) {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '작업 폴더 선택'",
    '$d.ShowNewFolderButton = $true',
    `$d.SelectedPath = '${String(initial || '').replace(/'/g, "''")}'`,
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    "if ($d.ShowDialog($owner) -eq 'OK') { Write-Output $d.SelectedPath }"
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: false, encoding: 'utf8', timeout: 10 * 60 * 1000 },
      (err, stdout) => resolve(err ? null : String(stdout).trim() || null)
    )
  })
}

function openInExplorer(p) {
  if (process.platform === 'win32') {
    const isDir = fs.statSync(p).isDirectory()
    spawn('explorer.exe', isDir ? [p] : [`/select,${p}`], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [p], { detached: true, stdio: 'ignore' }).unref()
  }
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
      if (argv.includes('--open')) {
        if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
        else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
      }
      const shutdown = () => {
        close()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
}
