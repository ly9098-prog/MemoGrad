const ACTIONS = [
{ action: 'explain_correct', label: '正确选项为什么对', shortLabel: '只讲正确项', icon: '/assets/icons/wrong-detail/circle-check.svg' },
{ action: 'explain_options', label: '逐项讲解 A/B/C/D', shortLabel: '逐项讲解', icon: '/assets/icons/wrong-detail/list-details.svg' },
{ action: 'core_concept', label: '这道题真正考什么', shortLabel: '真正考点', icon: '/assets/icons/wrong-detail/target.svg' },
{ action: 'similar_question', label: '给我一道同类题', shortLabel: '同类题', icon: '/assets/icons/wrong-detail/file-text.svg' },
{ action: 'harder_question', label: '给我一道更难的题', shortLabel: '更难一题', icon: '/assets/icons/wrong-detail/trending-up.svg' },
{ action: 'connect_knowledge', label: '帮我串联相关知识点', shortLabel: '知识串联', icon: '/assets/icons/wrong-detail/network.svg' },
{ action: 'high_frequency_traps', label: '总结这个知识点的高频陷阱', shortLabel: '高频陷阱', icon: '/assets/icons/wrong-detail/triangle-alert.svg' },
]
const PRIMARY_ACTION_KEYS = ['explain_options', 'core_concept', 'explain_correct', 'connect_knowledge']
const PRIMARY_ACTION_SET = new Set(PRIMARY_ACTION_KEYS)
const PRIMARY_ACTIONS = PRIMARY_ACTION_KEYS.map(key => ACTIONS.find(item => item.action === key)).filter(Boolean)
const MORE_ACTIONS = ACTIONS.filter(item => !PRIMARY_ACTION_SET.has(item.action))
const ACTION_BY_KEY = ACTIONS.reduce((map, item) => {
map[item.action] = item
return map
}, {})
const STRUCTURED_ANALYSIS_KEYS = [
{ keys: ['mistake_diagnosis', 'mistakeDiagnosis', 'error_analysis', 'diagnosis', '错因诊断'], heading: '错因诊断' },
{ keys: ['knowledge_patch', 'knowledgePatch', 'knowledge_weakness', 'knowledgeGap', '知识补漏', '补漏重点'], heading: '知识补漏' },
{ keys: ['review_task', 'reviewTask', 'review_plan', 'suggestion', '复练任务', '复习建议'], heading: '复练建议' },
{ keys: ['analysis', 'explanation', 'solution', 'answer_analysis', '题目解析', '解析'], heading: '题目解析' },
]
function cleanText(value) {
return String(value == null ? '' : value).trim()
}
function tryParseObject(value) {
if (value && typeof value === 'object' && !Array.isArray(value)) return value
let text = cleanText(value)
if (!text) return null
if (text.startsWith('```')) {
const firstBreak = text.indexOf('\n')
if (firstBreak >= 0) text = text.slice(firstBreak + 1)
text = text.replace(/```\s*$/, '').trim()
}
const left = text.indexOf('{')
const right = text.lastIndexOf('}')
if (left >= 0 && right > left) text = text.slice(left, right + 1)
try {
const parsed = JSON.parse(text)
return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
} catch (_) {
return null
}
}
function textPoints(value) {
if (Array.isArray(value)) {
return value.map(item => {
if (item && typeof item === 'object') {
return cleanText(item.text || item.content || item.point || item.description || '')
}
return cleanText(item)
}).filter(Boolean)
}
if (value && typeof value === 'object') {
const preferred = value.text || value.content || value.summary || value.description || value.reason
if (preferred) return [cleanText(preferred)].filter(Boolean)
return Object.values(value).map(item => cleanText(item)).filter(text => text && text !== '[object Object]')
}
const text = cleanText(value)
return text ? [text] : []
}
function structuredSections(value, allowUnknownFields = true) {
const obj = tryParseObject(value)
if (!obj) return []
const result = []
STRUCTURED_ANALYSIS_KEYS.forEach(group => {
let picked
for (let keyIndex = 0; keyIndex < group.keys.length; keyIndex++) {
const key = group.keys[keyIndex]
if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
picked = obj[key]
break
}
}
const points = textPoints(picked)
if (points.length) result.push({ heading: group.heading, points })
})
if (!result.length && allowUnknownFields) {
Object.keys(obj).forEach(key => {
const points = textPoints(obj[key])
if (points.length) result.push({ heading: cleanText(key).replace(/_/g, ' '), points })
})
}
return result
}
function normalizeSections(rawSections) {
const sections = []
;(Array.isArray(rawSections) ? rawSections : []).forEach((item, index) => {
if (!item || typeof item !== 'object') return
const heading = cleanText(item.heading) || `要点 ${index + 1}`
const points = []
;(Array.isArray(item.points) ? item.points : []).forEach(point => {
const nested = structuredSections(point)
if (nested.length) {
nested.forEach(section => sections.push(section))
} else {
const text = cleanText(point)
if (text) points.push(text)
}
})
if (points.length) sections.push({ heading, points })
})
return sections
}
function dedupeSections(items) {
const seen = new Set()
const result = []
;(items || []).forEach((item, index) => {
const points = (item.points || []).map(cleanText).filter(Boolean)
if (!points.length) return
const heading = cleanText(item.heading) || `要点 ${index + 1}`
const key = `${heading}|${points.join('|')}`
if (seen.has(key)) return
seen.add(key)
result.push({ key: `${result.length}-${heading}`, heading, points })
})
return result
}
function normalizePracticeQuestion(practiceRaw) {
let practiceQuestion = null
if (practiceRaw && typeof practiceRaw === 'object') {
const options = practiceRaw.options && typeof practiceRaw.options === 'object'
? Object.keys(practiceRaw.options).map(key => ({ key, text: cleanText(practiceRaw.options[key]) })).filter(item => item.text)
: []
practiceQuestion = {
stem: cleanText(practiceRaw.stem),
options,
answer: cleanText(practiceRaw.answer),
analysis: cleanText(practiceRaw.analysis),
difficultyDelta: Number(practiceRaw.difficulty_delta ?? practiceRaw.difficultyDelta ?? 0) || 0,
}
}
return practiceQuestion
}
function hasTeachingBody(sections, knowledgePoints, action) {
if (action === 'explain_options') return sections.length > 0
const points = sections.reduce((items, section) => items.concat(section.points), [])
if (action === 'connect_knowledge') {
knowledgePoints.forEach(item => points.push(item.relation, item.masteryHint))
}
const unique = [...new Set(points.map(point => point.replace(/\s/g, '')).filter(Boolean))]
if (!unique.length) return false
if (unique.length > 1) return true
const text = unique[0]
// Reject a lone tiny opening, while retaining complete short sentences/formulas.
// This is a fragment guard, not semantic validation of an entire lesson.
return Array.from(text).length > 4 || /[。！？.!?]$/.test(text) ||
/^[^=<>≤≥≠!]+(?:<=|>=|==|!=|[=<>≤≥≠])[^=<>≤≥≠!]+$/.test(text) || /^[OΩΘ]\([^()]+\)$/.test(text)
}
function normalizeResult(raw) {
let source = raw
if (typeof source === 'string') source = tryParseObject(source)
if (!source || typeof source !== 'object' || Array.isArray(source)) return null
if (source.result && typeof source.result === 'object') source = source.result
if (source.data && typeof source.data === 'object' && !source.action && !source.sections) source = source.data
const summaryStructured = structuredSections(source.summary, false)
const sections = dedupeSections(summaryStructured.concat(normalizeSections(source.sections)))
let summary = cleanText(source.summary)
if (summaryStructured.length) {
summary = summaryStructured[0].points[0] || ''
} else if ((source.summary && typeof source.summary === 'object') || tryParseObject(summary)) {
summary = sections.length ? sections[0].points[0] : ''
}
const knowledgePoints = Array.isArray(source.knowledge_points)
? source.knowledge_points.map((item, index) => ({
key: `${index}-${cleanText(item && item.name)}`,
name: cleanText(item && item.name),
relation: cleanText(item && item.relation),
masteryHint: cleanText(item && (item.mastery_hint || item.masteryHint)),
})).filter(item => item.name).slice(0, 8)
: []
const practiceRaw = source.practice_question || source.practiceQuestion
const practiceQuestion = normalizePracticeQuestion(practiceRaw)
const action = cleanText(source.action)
const actionMeta = ACTION_BY_KEY[action] || {}
const result = {
action,
actionLabel: cleanText(source.action_label || source.actionLabel) || actionMeta.label || 'AI 老师',
title: cleanText(source.title) || actionMeta.label || 'AI 老师',
summary,
sections,
knowledgePoints,
practiceQuestion,
nextAction: source.next_action || source.nextAction || null,
fromFallback: !!(source.from_fallback ?? source.fromFallback),
personalization: source.personalization || {},
promptVersion: cleanText(source.prompt_version || source.promptVersion),
}
const fallbackReason = cleanText(source.fallback_reason || source.fallbackReason)
if (fallbackReason) result.fallbackReason = fallbackReason
return finalizeResult(result)
}
function finalizeResult(result) {
const { action, sections, knowledgePoints, practiceQuestion } = result
if (!result.fromFallback && ACTION_BY_KEY[action]) {
const hasBody = action === 'similar_question' || action === 'harder_question'
? !!(practiceQuestion && practiceQuestion.stem && practiceQuestion.options.length && practiceQuestion.answer)
: hasTeachingBody(sections, knowledgePoints, action)
if (!hasBody) {
result.fromFallback = true
result.fallbackReason = 'missing_body'
result.title = '讲解未完整生成'
result.summary = '未收到可展示的讲解正文，请重新尝试。'
}
}
if (result.fromFallback) {
result.title = '这次讲解未完成'
result.summary = fallbackMessage(result.summary, result.fallbackReason)
result.sections = []
result.knowledgePoints = []
result.practiceQuestion = null
result.nextAction = null
}
return result
}
const FALLBACK_MESSAGES = {
budget_exhausted: 'AI 调用额度不足，可先查看题库解析。',
service_unavailable: 'AI 老师暂不可用，请稍后重试，或返回查看题库解析。',
output_truncated: 'AI 讲解达到输出长度上限，未能完整生成，请重新尝试。',
content_filtered: 'AI 输出被服务商安全策略过滤，未获得可展示的讲解。',
invalid_format: 'AI 返回的格式无法解析，请重新尝试。',
invalid_options: '逐项讲解未通过完整性或答案一致性校验，请重新尝试。',
invalid_question: '未收到含完整答案和解析的练习题，请重新尝试。',
missing_body: '未收到可展示的讲解正文，请重新尝试。',
}
function fallbackMessage(summary, reasonCode) {
if (Object.prototype.hasOwnProperty.call(FALLBACK_MESSAGES, reasonCode)) return FALLBACK_MESSAGES[reasonCode]
// Older servers append a generic failure sentence. Keep one verified cause;
// never display their historical copied question analysis as a generated lesson.
const reason = cleanText(summary).split(/本次未生成(?: AI 讲解|逐项讲解)/)[0].trim().replace(/[。；;]+$/, '')
if (/^今日(?: AI 调用)?额度已用尽/.test(reason)) return FALLBACK_MESSAGES.budget_exhausted
if (/^(?:AI (?:返回格式异常|未生成可校验的单选题|老师暂不可用|讲解未完整生成)|今日 AI 调用额度已用尽|未收到可展示的讲解正文)/.test(reason)) return `${reason}。`
if (/^AI 返回的逐项内容不完整或与标准答案不一致/.test(reason)) return '逐项讲解未通过完整性或答案一致性校验，请重新尝试。'
if (/^AI 返回的讲解内容不完整/.test(reason)) return FALLBACK_MESSAGES.missing_body
return '本次未生成 AI 讲解，请重新尝试，或返回查看题库解析。'
}
function errorMessage(error, api) {
const detail = error && error.detail
if (detail && detail.code === 'ai_service_unavailable' && detail.message) return cleanText(detail.message)
const raw = api && typeof api.getErrorMessage === 'function'
? api.getErrorMessage(error)
: cleanText(error && error.message)
if (raw.includes('exam_in_progress_ai_blocked') || raw.includes('考试进行中')) {
return '考试进行中不开放答案型 AI 讲解，请交卷后再使用。'
}
return raw || 'AI 老师暂不可用，请稍后重试'
}
module.exports = {
ACTIONS,
PRIMARY_ACTIONS,
MORE_ACTIONS,
ACTION_BY_KEY,
normalizeResult,
errorMessage,
}
