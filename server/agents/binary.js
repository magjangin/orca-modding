'use strict'
// 에이전트 CLI 실행 파일 찾기. 결과: { path, shell, args } — args는 CLI 인자 앞에 붙일 인자(예: node로 띄울 스크립트).
// Why: Windows의 npm 전역 설치는 `claude.cmd` 셈(shim)만 PATH에 두는데, Node 24는 .cmd를
// shell 없이 spawn하지 못한다. 셈 안에 적힌 실제 대상(exe, 또는 node로 도는 .js)을 꺼내 쓰면
// shell 없이 인자를 그대로 넘길 수 있다. agy는 원래 단일 exe라 그대로 쓴다.
const fs = require('node:fs')
const path = require('node:path')

const isWin = process.platform === 'win32'

// npm cmd-shim이 가리키는 대상: `"%dp0%\…"`(cmd-shim) 또는 `"%~dp0\…"`(구버전·pnpm) 꼴.
const SHIM_TARGET_RE = /"%~?dp0%?\\([^"]+?\.(?:exe|c?js|mjs))"/gi

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** PATH에서 name(+확장자)을 찾는다. */
function findOnPath(name, exts) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

function fromCmdShim(cmdPath) {
  let text
  try {
    text = fs.readFileSync(cmdPath, 'utf8')
  } catch {
    return null
  }
  const dir = path.dirname(cmdPath)
  for (const m of text.matchAll(SHIM_TARGET_RE)) {
    const rel = m[1]
    // Why: JS 셈에는 `IF EXIST "%dp0%\node.exe"` 줄이 먼저 나온다. 그건 실행기이지 대상이 아니다.
    if (/^node\.exe$/i.test(rel)) continue
    const target = path.join(dir, rel)
    if (!isFile(target)) continue
    if (/\.exe$/i.test(rel)) return { path: target, shell: false, args: [] }
    // 셈과 같은 순서로 node를 고른다: 셈 옆의 node.exe, 없으면 PATH의 node.
    const node = isFile(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : findOnPath('node', ['.exe'])
    if (node) return { path: node, shell: false, args: [target] }
  }
  return null
}

function resolveBinary(name, override) {
  if (override) {
    if (!isFile(override)) return null
    if (isWin && /\.(cmd|bat)$/i.test(override)) {
      return fromCmdShim(override) || { path: override, shell: true, args: [] }
    }
    return { path: override, shell: false, args: [] }
  }
  const found = findOnPath(name, isWin ? ['.exe', '.cmd', '.bat'] : [''])
  if (!found) return null
  if (/\.(cmd|bat)$/i.test(found)) return fromCmdShim(found) || { path: found, shell: true, args: [] }
  return { path: found, shell: false, args: [] }
}

module.exports = { resolveBinary, fromCmdShim }
