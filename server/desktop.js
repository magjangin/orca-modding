'use strict'
// 운영체제 연동: 폴더 선택 창, 탐색기로 열기, 기본 브라우저로 열기.
const fs = require('node:fs')
const { spawn, execFile } = require('node:child_process')

const isWin = process.platform === 'win32'

function detached(cmd, args) {
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

/** 웹 모드용 폴더 선택 창 (Electron에서는 preload의 네이티브 대화상자를 쓴다). Windows가 아니면 null. */
function pickFolder(initial) {
  if (!isWin) return Promise.resolve(null)
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

/** 탐색기 인자. 경로만 따옴표로 감싼다 (`/select,"C:\a b\c.txt"`). */
function explorerArg(p, isDir) {
  return isDir ? `"${p}"` : `/select,"${p}"`
}

/** 폴더는 탐색기로 열고, 파일은 탐색기에서 선택된 상태로 보여 준다. */
function revealPath(p) {
  if (!isWin) return detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [p])
  // Why: Node는 공백이 든 인자를 통째로 따옴표로 감싸("/select,C:\a b\c.txt") 넘기는데, 탐색기는 그걸
  // /select 옵션으로 못 읽고 문서 폴더를 연다. 인자를 직접 만들어 그대로(verbatim) 넘긴다.
  spawn('explorer.exe', [explorerArg(p, fs.statSync(p).isDirectory())], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true
  }).unref()
}

function openUrl(url) {
  if (isWin) detached('cmd', ['/c', 'start', '', url])
  else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
}

module.exports = { pickFolder, revealPath, openUrl, explorerArg }
