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

/** 폴더는 탐색기로 열고, 파일은 탐색기에서 선택된 상태로 보여 준다. */
function revealPath(p) {
  if (isWin) detached('explorer.exe', fs.statSync(p).isDirectory() ? [p] : [`/select,${p}`])
  else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [p])
}

function openUrl(url) {
  if (isWin) detached('cmd', ['/c', 'start', '', url])
  else detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
}

module.exports = { pickFolder, revealPath, openUrl }
