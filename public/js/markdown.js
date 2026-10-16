// 의존성 없는 작은 마크다운 렌더러 (에이전트 답변 표시용). 모든 입력은 먼저 이스케이프한다.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function link(href, text) {
  // href는 이미 이스케이프된 상태
  const isWeb = /^https?:/i.test(href)
  const isMail = /^mailto:/i.test(href)
  const isFile = /^file:/i.test(href) || /^[a-zA-Z]:[/\\]/.test(href) || (/\.[a-z0-9]{1,8}(#.*)?$/i.test(href) && !isWeb && !isMail)
  if (!isWeb && !isMail && !isFile) return text
  const cls = isFile ? ' class="file-link"' : ''
  return `<a href="${href}"${cls} target="_blank" rel="noopener noreferrer">${text}</a>`
}

function fmt(s) {
  s = esc(s)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => link(u, alt || u))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, u) => link(u, t))
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,;:!?'"])/g, (_, p, u) => p + link(u, u))
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
  return s
}

// Why: 코드 스팬을 자리표시자로 빼 두고 나머지를 한 번에 서식 처리해야 `**`코드`**`처럼
// 굵게 안에 든 코드도 굵게가 깨지지 않는다.
function inline(s) {
  const codes = []
  const masked = String(s).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, body) => {
    const code = /^ .* $/.test(body) ? body.slice(1, -1) : body
    codes.push(`<code>${esc(code)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  return fmt(masked).replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)])
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function indentOf(line) {
  const m = line.match(/^(\s*)/)
  return m ? m[1].replace(/\t/g, '    ').length : 0
}

function isTableStart(line, next) {
  return line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-')
}

function isBlockStart(line, next) {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || /^\s*>/.test(line) || LIST.test(line) || isTableStart(line, next)
}

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function codeBlock(code, lang) {
  return (
    `<div class="code"><div class="code-head"><span>${esc(lang || 'text')}</span>` +
    `<button type="button" class="copy-code">복사</button></div>` +
    `<pre><code>${esc(code)}</code></pre></div>`
  )
}

function parseList(lines, i) {
  const base = indentOf(lines[i])
  const first = lines[i].match(LIST)
  const ordered = /\d/.test(first[2])
  const start = ordered ? parseInt(first[2], 10) : 1
  let html = ordered ? (start !== 1 ? `<ol start="${start}">` : '<ol>') : '<ul>'
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      const next = lines[i + 1]
      if (next !== undefined && LIST.test(next) && indentOf(next) >= base) {
        i++
        continue
      }
      break
    }
    const m = line.match(LIST)
    const ind = indentOf(line)
    if (m && ind === base) {
      i++
      let content = m[3]
      let task = ''
      const t = content.match(/^\[([ xX])\]\s+(.*)$/)
      if (t) {
        task = `<input type="checkbox" disabled${t[1] !== ' ' ? ' checked' : ''}> `
        content = t[2]
      }
      const cont = []
      let inner = ''
      while (i < lines.length) {
        const l = lines[i]
        if (!l.trim()) break
        const li = indentOf(l)
        if (LIST.test(l)) {
          if (li > base) {
            const [h, ni] = parseList(lines, i)
            inner += h
            i = ni
            continue
          }
          break
        }
        if (isBlockStart(l, lines[i + 1])) break
        cont.push(l.trim())
        i++
      }
      html += `<li>${task}${inline([content, ...cont].join(' '))}${inner}</li>`
    } else if (m && ind > base) {
      const [h, ni] = parseList(lines, i)
      html += h
      i = ni
    } else {
      break
    }
  }
  return [html + (ordered ? '</ol>' : '</ul>'), i]
}

function render(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  let html = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m = line.match(FENCE)
    if (m) {
      const fence = m[1]
      const buf = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        buf.push(lines[i])
        i++
      }
      i++
      html += codeBlock(buf.join('\n'), m[2])
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    m = line.match(HEADING)
    if (m) {
      const lv = m[1].length
      html += `<h${lv}>${inline(m[2])}</h${lv}>`
      i++
      continue
    }
    if (HR.test(line)) {
      html += '<hr>'
      i++
      continue
    }
    if (isTableStart(line, lines[i + 1])) {
      const head = splitRow(line)
      const aligns = splitRow(lines[i + 1]).map((c) =>
        /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''
      )
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c)}</${tag}>`
      html +=
        '<div class="table-wrap"><table><thead><tr>' +
        head.map((c, k) => cell('th', c, k)).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => cell('td', r[k] || '', k)).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      continue
    }
    if (/^\s*>/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      html += `<blockquote>${render(buf.join('\n'))}</blockquote>`
      continue
    }
    if (LIST.test(line)) {
      const [h, ni] = parseList(lines, i)
      html += h
      i = ni
      continue
    }
    const buf = []
    while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) {
      buf.push(lines[i])
      i++
    }
    html += `<p>${buf.map(inline).join('<br>')}</p>`
  }
  return html
}

export { render as renderMarkdown, esc as escapeHtml }
