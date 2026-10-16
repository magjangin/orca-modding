'use strict'
// 에이전트 CLI 실행 파일 찾기.
// Why: Windows의 npm 전역 설치는 `claude.cmd` 셈(shim)만 PATH에 두는데, Node 24는 .cmd를
// shell 없이 spawn하지 못한다. 셈 안에 적힌 실제 exe(`claude.exe`)를 꺼내 쓰면 shell 없이
// 인자를 그대로 넘길 수 있다. agy는 원래 단일 exe라 그대로 쓴다.
const fs = require('node:fs')
const path = require('node:path')

const isWin = process.platform === 'win32'

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function fromCmdShim(cmdPath) {
  let text
  try {
    text = fs.readFileSync(cmdPath, 'utf8')
  } catch {
    return null
  }
  const dir = path.dirname(cmdPath)
  const exe = text.match(/"%dp0%\\([^"]+?\.exe)"/i)
  if (exe) {
    const target = path.join(dir, exe[1])
    if (isFile(target)) return { path: target, shell: false }
  }
  return null
}

function resolveBinary(name, override) {
  if (override) {
    if (!isFile(override)) return null
    if (isWin && /\.(cmd|bat)$/i.test(override)) {
      return fromCmdShim(override) || { path: override, shell: true }
    }
    return { path: override, shell: false }
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      if (!isFile(candidate)) continue
      if (ext === '.cmd' || ext === '.bat') {
        return fromCmdShim(candidate) || { path: candidate, shell: true }
      }
      return { path: candidate, shell: false }
    }
  }
  return null
}

module.exports = { resolveBinary }
