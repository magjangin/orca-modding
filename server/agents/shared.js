'use strict'
// 에이전트 공통 정의: ID·표시 이름, 노력(effort) 단계, 모델 목록 해석.
//
// 모델 목록 항목: { id, label, hint?, resolved?, efforts, variants?, defaultEffort? }
//  - efforts: 고를 수 있는 노력 단계 (비어 있으면 화면에서 노력 칸을 숨긴다)
//  - variants: agy처럼 노력이 모델 ID에 들어 있을 때 단계별 실제 모델 ID ({ low: 'gemini-x-low', … })
//  - resolved: 별칭이 가리키는 실제 모델 ID (답변 아래 모델 이름을 다시 표시 이름으로 바꿀 때 쓴다)

const AGENT_IDS = ['claude', 'antigravity']
const LABEL = { claude: 'Claude', antigravity: 'Antigravity' }
const OTHER = { claude: 'antigravity', antigravity: 'claude' }
const PERMISSIONS = ['plan', 'edit', 'full']
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

function sortEfforts(levels) {
  return EFFORT_LEVELS.filter((l) => levels.includes(l))
}

/**
 * 화면에서 고른 모델·노력을 CLI 인자로 바꾼다.
 * @returns {{model:string, effort:string|null, level:string|null}} effort는 `--effort`로 넘길 값, level은 실제로 쓰일 단계
 */
function resolveLaunch(models, modelId, effort) {
  const m = models.find((x) => x.id === modelId)
  if (!m) return { model: modelId, effort: null, level: null }
  if (m.variants) {
    const level = m.variants[effort] ? effort : m.defaultEffort
    return { model: m.variants[level], effort: null, level }
  }
  const flag = m.efforts.includes(effort) ? effort : null
  return { model: m.id, effort: flag, level: flag }
}

module.exports = { AGENT_IDS, LABEL, OTHER, PERMISSIONS, EFFORT_LEVELS, sortEfforts, resolveLaunch }
