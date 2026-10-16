'use strict'
// HTTP 도우미: JSON 응답, 요청 본문 읽기, public/ 정적 파일.
const fs = require('node:fs')
const path = require('node:path')

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

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
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

/** public/ 아래 파일을 보낸다. HTML에는 API 토큰을 심는다. */
function serveStatic(res, pathname, token) {
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

module.exports = { HttpError, json, readBody, serveStatic }
