// 메시지 맨 앞의 `@claude` / `@agy` 같은 멘션으로 보낼 대상을 고른다. (DOM 없이 테스트할 수 있게 따로 둔다)

// Why: JS 정규식의 \b는 [A-Za-z0-9_]만 글자로 보므로 `@클로드 ` 뒤에서 경계를 못 찾는다. 공백·구두점·끝으로 경계를 직접 확인한다.
const MENTION = /^@(claude|클로드|agy|antigravity|안티그래비티|안티)(?=[\s,:]|$)[\s,:]*/i

/** @returns {{agent:'claude'|'antigravity', text:string} | null} */
export function parseMention(text) {
  const m = text.match(MENTION)
  if (!m) return null
  return { agent: /claude|클로드/i.test(m[1]) ? 'claude' : 'antigravity', text: text.slice(m[0].length).trim() }
}
