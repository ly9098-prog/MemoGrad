const RELATION_LABELS = {
prerequisite: '前置知识',
prerequisites: '前置知识',
prereq: '前置知识',
parent: '所属主题',
parent_node: '所属主题',
parent_topic: '所属主题',
next: '后续知识',
next_node: '后续知识',
next_nodes: '后续知识',
child: '下级知识',
children: '下级知识',
related: '相关知识',
related_node: '相关知识',
related_nodes: '相关知识',
sibling: '同层知识',
}

const METRIC_RE = /\b(mastery|confidence)\s*[:=]\s*(-?\d+(?:\.\d+)?%?)/ig

function cleanText(value) {
return String(value == null ? '' : value).trim()
}

function clamp(value, min, max) {
return Math.max(min, Math.min(max, value))
}

function masteryPercent(rawValue) {
const text = cleanText(rawValue)
if (!text) return null
const hasPercent = text.endsWith('%')
const value = Number(text.replace('%', ''))
if (!Number.isFinite(value)) return null
const normalized = !hasPercent && value >= 0 && value <= 1 ? value * 100 : value
return Math.round(clamp(normalized, 0, 100))
}

function masteryLabel(percent) {
if (!Number.isFinite(percent)) return ''
if (percent >= 85) return `掌握较好 · ${percent}%`
if (percent >= 60) return `基本掌握 · ${percent}%`
if (percent >= 40) return `还需巩固 · ${percent}%`
return `建议优先复习 · ${percent}%`
}

function stripMetricFragments(text) {
let result = cleanText(text)
if (!result) return ''
result = result.replace(METRIC_RE, '')
result = result
.replace(/^[\s,，;；|·:：-]+/, '')
.replace(/[\s,，;；|·:：-]+$/, '')
.replace(/\s*[,，;；|]\s*[,，;；|]+\s*/g, '，')
.replace(/^并且\s*/, '')
return result.trim()
}

function relationLabel(rawKey) {
const key = cleanText(rawKey).toLowerCase().replace(/[\s-]+/g, '_')
return RELATION_LABELS[key] || ''
}

function pushRelationItem(items, label, value) {
const cleanValue = cleanText(value)
if (!label || !cleanValue) return
const safeValue = stripMetricFragments(cleanValue)
if (!safeValue) return
const duplicate = items.some(item => item.label === label && item.value === safeValue)
if (duplicate) return
items.push({
key: `${items.length}-${label}-${safeValue}`,
label,
value: safeValue,
})
}

function parseRelation(rawRelation) {
const source = cleanText(rawRelation)
if (!source) return { items: [], text: '' }

const items = []
const leftovers = []
const chunks = source.split(/[;；\n]+/).map(cleanText).filter(Boolean)
chunks.forEach(chunk => {
const match = chunk.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(?:→|->|=>|:|=)\s*(.+)$/)
if (match) {
const label = relationLabel(match[1])
if (label && !/^[A-Za-z_$][\w$]*\s*[\[(]/.test(match[2])) {
pushRelationItem(items, label, match[2])
return
}
}

let consumed = false
const pairRe = /(?:^|[,，]\s*)([A-Za-z][A-Za-z0-9_-]*)\s*(?:→|->|=>|:|=)\s*([^,，]+)(?=$|[,，])/g
let pair
while ((pair = pairRe.exec(chunk))) {
const label = relationLabel(pair[1])
if (!label || /^[A-Za-z_$][\w$]*\s*[\[(]/.test(pair[2])) continue
pushRelationItem(items, label, pair[2])
consumed = true
}
if (!consumed) leftovers.push(relationLabel(chunk) || stripMetricFragments(chunk))
})

return {
items: items.slice(0, 6),
text: leftovers.filter(Boolean).join(' · '),
}
}

function formatKnowledgePoint(item, index) {
const source = item || {}
const relation = parseRelation(source.relation)
const hintSource = cleanText(source.masteryHint)
let mastery = null
let match
METRIC_RE.lastIndex = 0
while ((match = METRIC_RE.exec(hintSource))) {
if (String(match[1]).toLowerCase() === 'mastery') mastery = masteryPercent(match[2])
}
METRIC_RE.lastIndex = 0
const learningHint = stripMetricFragments(hintSource)

return {
key: cleanText(source.key) || `${index}-${cleanText(source.name)}`,
name: cleanText(source.name),
relationItems: relation.items,
relationText: relation.text,
masteryText: masteryLabel(mastery),
learningHint,
}
}

function presentTeacherResult(rawResult) {
if (!rawResult || typeof rawResult !== 'object') return rawResult
const result = Object.assign({}, rawResult)
result.title = cleanText(result.title)
result.summary = cleanText(result.summary)
result.sections = (Array.isArray(result.sections) ? result.sections : []).map((section, sectionIndex) => ({
key: cleanText(section && section.key) || `${sectionIndex}`,
heading: cleanText(section && section.heading),
points: (Array.isArray(section && section.points) ? section.points : [])
.map(cleanText)
.filter(Boolean),
})).filter(section => section.heading || section.points.length)
result.knowledgePoints = (Array.isArray(result.knowledgePoints) ? result.knowledgePoints : [])
.map(formatKnowledgePoint)
.filter(item => item.name)
return result
}

module.exports = {
presentTeacherResult,
parseRelation,
formatKnowledgePoint,
}
