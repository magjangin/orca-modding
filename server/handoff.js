'use strict'
// 번갈아 보내기의 핵심: 각 에이전트는 자기 세션만 기억하므로, 마지막으로 응답한 뒤
// 상대 에이전트와 오간 대화를 프롬프트 앞에 붙여 넘겨준다.
const { LABEL, OTHER } = require('./agents/shared')

const PER_MESSAGE_LIMIT = 6000
const TOTAL_LIMIT = 30000

function clip(text, limit) {
  if (text.length <= limit) return text
  const head = Math.floor(limit * 0.6)
  const tail = limit - head
  return `${text.slice(0, head)}\n…(중간 ${text.length - limit}자 생략)…\n${text.slice(-tail)}`
}

function assistantText(msg) {
  const out = []
  const tools = []
  for (const p of msg.parts || []) {
    if (p.kind === 'text' && p.text.trim()) out.push(p.text.trim())
    else if (p.kind === 'tool' && p.name) tools.push(p.name)
  }
  let text = out.join('\n\n')
  if (tools.length) text += `\n(사용한 도구: ${[...new Set(tools)].join(', ')})`
  if (msg.status === 'stopped') text += '\n(사용자가 중간에 멈춤)'
  if (msg.status === 'error') text += `\n(오류로 끝남: ${msg.error || ''})`
  return text.trim()
}

/** agent가 아직 못 본 메시지들 (사용자 메시지 index 이전까지). */
function unseenMessages(conv, agent, beforeIndex) {
  const from = (conv.seen && typeof conv.seen[agent] === 'number' ? conv.seen[agent] : -1) + 1
  return conv.messages
    .slice(from, beforeIndex)
    .filter((m) => m.role !== 'system' && (m.agent !== agent || !conv.sessions[agent]))
}

function renderEntry(m) {
  if (m.role === 'user') {
    return `[사용자 → ${LABEL[m.agent]}]\n${clip(m.text, PER_MESSAGE_LIMIT)}`
  }
  return `[${LABEL[m.agent]}의 답변]\n${clip(assistantText(m) || '(빈 응답)', PER_MESSAGE_LIMIT)}`
}

/**
 * @returns {{prompt:string, handoffCount:number}}
 */
function buildPrompt(conv, agent, userIndex) {
  const userText = conv.messages[userIndex].text
  const unseen = unseenMessages(conv, agent, userIndex)
  if (unseen.length === 0) return { prompt: userText, handoffCount: 0 }

  const other = LABEL[OTHER[agent]]
  const entries = unseen.map(renderEntry)
  let dropped = 0
  while (entries.length > 1 && entries.join('\n\n').length > TOTAL_LIMIT) {
    entries.shift()
    dropped++
  }
  const body = (dropped ? `…(앞선 메시지 ${dropped}개 생략)…\n\n` : '') + entries.join('\n\n')
  const prompt =
    `<shared-context>\n` +
    `이 대화는 사용자가 Claude와 Antigravity에게 번갈아 요청하는 공동 작업 스레드입니다. ` +
    `당신(${LABEL[agent]})이 마지막으로 응답한 뒤 사용자와 ${other} 사이에 오간 내용입니다. ` +
    `같은 작업 폴더를 쓰므로 ${other}가 바꾼 파일이 있을 수 있습니다.\n\n` +
    `${body}\n` +
    `</shared-context>\n\n` +
    `[사용자 → ${LABEL[agent]}]\n${userText}`
  return { prompt, handoffCount: unseen.length }
}

module.exports = { buildPrompt }
