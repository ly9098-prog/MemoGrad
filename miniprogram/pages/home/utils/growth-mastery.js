const HOME_MASTERY_SUBJECTS = [
  { key: 'data', code: 'data_structure', name: '数据结构' },
  { key: 'chip', code: 'computer_organization', name: '计算机组成原理' },
  { key: 'code', code: 'operating_system', name: '操作系统' },
  { key: 'network', code: 'computer_network', name: '计算机网络' },
]

function getMasteryMark(name, code) {
  const text = `${String(name || '')} ${String(code || '')}`.toLowerCase()
  if (text.includes('数据结构') || text.includes('data_structure')) return '数'
  if (text.includes('组成') || text.includes('organization')) return '组'
  if (text.includes('操作系统') || text.includes('operating')) return '系'
  if (text.includes('网络') || text.includes('network')) return '网'
  if (text.includes('高等数学') || text.includes('calculus')) return '高'
  if (text.includes('线性代数') || text.includes('linear')) return '线'
  if (text.includes('英语') || text.includes('english')) return '英'
  if (text.includes('政治') || text.includes('politic')) return '政'
  const clean = String(name || '').trim()
  return clean ? clean.slice(0, 1) : '科'
}

function getMasteryIconClass(name, code) {
  const text = `${String(name || '')} ${String(code || '')}`.toLowerCase()
  if (text.includes('数据结构') || text.includes('data_structure')) return 'data'
  if (text.includes('组成') || text.includes('organization')) return 'chip'
  if (text.includes('操作系统') || text.includes('operating')) return 'code'
  if (text.includes('网络') || text.includes('network')) return 'network'
  if (text.includes('高等数学') || text.includes('calculus')) return 'math'
  if (text.includes('线性代数') || text.includes('linear')) return 'matrix'
  if (text.includes('英语') || text.includes('english')) return 'language'
  if (text.includes('政治') || text.includes('politic')) return 'civic'
  return 'generic'
}

function getMasteryIconSrc(iconClass) {
  const icons = {
    data: '/assets/icons/home-mastery/data-structure.svg',
    chip: '/assets/icons/home-mastery/computer-organization.svg',
    code: '/assets/icons/home-mastery/operating-system.svg',
    network: '/assets/icons/home-mastery/computer-network.svg',
  }
  return icons[String(iconClass || '')] || ''
}

function getMasterySubjectKey(name, code) {
  const rawCode = String(code || '').trim().toLowerCase()
  const rawName = String(name || '').trim().toLowerCase()
  const text = `${rawName} ${rawCode}`
  if (rawCode === 'data_structure' || text.includes('数据结构')) return 'data'
  if (rawCode === 'computer_organization' || text.includes('组成原理') || text.includes('计组')) return 'chip'
  if (rawCode === 'operating_system' || text.includes('操作系统')) return 'code'
  if (rawCode === 'computer_network' || text.includes('计算机网络') || text.includes('计网')) return 'network'
  return getMasteryIconClass(name, code)
}

function toNonNegativeInt(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n)
}

function indexSubjectMastery(list) {
  const byKey = {}
  ;(Array.isArray(list) ? list : []).forEach((item) => {
    if (!item) return
    const key = getMasterySubjectKey(item.subject_name, item.subject_code)
    const supported = HOME_MASTERY_SUBJECTS.some(meta => meta.key === key)
    if (supported && !byKey[key]) byKey[key] = item
  })
  return byKey
}

function resolveSubjectMastery(values) {
  const {
    statsItem,
    hubHasData,
    statsHasData,
    statsAttempts,
    hubScoreNumber,
  } = values
  const hasData = hubHasData
  const score = hasData ? Math.max(0, Math.min(100, Math.round(hubScoreNumber))) : 0
  // Dashboard counts answers; Hub counts knowledge-point observations. A
  // question can update several points, so these counts must never be mixed.
  const attemptCount = statsHasData ? statsAttempts : 0
  const correctCount = statsHasData
    ? Math.max(0, Math.min(attemptCount, toNonNegativeInt(statsItem.correct_count))) : 0
  return { score, attemptCount, correctCount, hasData }
}

function masteryStatus(hasData, hubItem, hasAttempts) {
  const status = String(hubItem && hubItem.status || '')
  if (!hasData && status !== 'insufficient') {
    return { statusText: hasAttempts ? (hubItem ? '样本积累中' : '评估暂不可用') : '开始积累', statusIconSrc: '' }
  }
  const confidence = hubItem && hubItem.confidence != null ? Number(hubItem.confidence) : NaN
  const icons = '/assets/icons/home-mastery/'
  if (status === 'insufficient' || !Number.isFinite(confidence) || confidence < 0.3) {
    return { statusText: '样本积累中', statusIconSrc: `${icons}status-observing.svg` }
  }
  const rawScore = Number(hubItem && hubItem.mastery_score)
  const code = ['weak', 'developing', 'good', 'mastered'].includes(status) ? status
    : (rawScore < 40 ? 'weak' : rawScore < 70 ? 'developing' : rawScore < 85 ? 'good' : 'mastered')
  if (code === 'weak') return { statusText: '需要强化', statusIconSrc: `${icons}status-weak.svg` }
  if (code === 'developing') return { statusText: '持续巩固', statusIconSrc: `${icons}status-good.svg` }
  if (code === 'good') return { statusText: '较为稳定', statusIconSrc: `${icons}status-good.svg` }
  return { statusText: '掌握稳固', statusIconSrc: `${icons}status-mastered.svg` }
}

function buildSubjectMasteryItem(meta, index, hubByKey, statsByKey) {
  const hubItem = hubByKey[meta.key] || null
  const statsItem = statsByKey[meta.key] || null
  const hubAttempts = toNonNegativeInt(hubItem && hubItem.attempt_count)
  const statsAttempts = toNonNegativeInt(statsItem && statsItem.total_questions)
  const rawHubScore = hubItem && hubItem.mastery_score
  const hubScoreNumber = rawHubScore == null ? NaN : Number(rawHubScore)
  const hubConfidence = hubItem && hubItem.confidence != null ? Number(hubItem.confidence) : NaN
  const hubHasData = !!(
    hubItem &&
    Number.isFinite(hubScoreNumber) &&
    hubItem.data_available !== false &&
    hubItem.status !== 'insufficient' &&
    Number.isFinite(hubConfidence) && hubConfidence >= 0.3
  )
  const statsHasData = !!(statsItem && statsAttempts > 0)
  const mastery = resolveSubjectMastery({
    statsItem,
    hubHasData,
    statsHasData,
    statsAttempts,
    hubScoreNumber,
  })
  const sourceItem = hubItem || statsItem || {}
  const subjectName = String(sourceItem.subject_name || meta.name)
  const subjectCode = String(sourceItem.subject_code || meta.code)
  const subjectId = Number(sourceItem.subject_id) || 0
  const iconClass = meta.key
  const { score, attemptCount, correctCount, hasData } = mastery
  return {
    subjectId,
    subjectCode,
    subjectName,
    orderText: String(index + 1).padStart(2, '0'),
    mark: getMasteryMark(subjectName, subjectCode),
    iconClass,
    iconSrc: getMasteryIconSrc(iconClass),
    hasData,
    score,
    scoreText: hasData ? `${score}%` : '--',
    barWidth: hasData ? score : 0,
    attemptCount,
    correctCount,
    questionStatText: statsHasData ? `${correctCount}/${attemptCount} 题` : '暂无题量统计',
    sampleText: attemptCount > 0 ? `已练 ${attemptCount} 题` : (hubAttempts > 0 ? '已有知识点评估' : '暂无练习记录'),
    ...masteryStatus(hasData, hubItem, statsAttempts > 0 || hubAttempts > 0),
  }
}

function buildSubjectMastery(options = {}) {
  const hubByKey = indexSubjectMastery(options.hubSubjectMastery)
  const statsByKey = indexSubjectMastery(options.dashboardSubjectStats)
  return HOME_MASTERY_SUBJECTS.map((meta, index) => (
    buildSubjectMasteryItem(meta, index, hubByKey, statsByKey)
  ))
}

module.exports = {
  HOME_MASTERY_SUBJECTS,
  buildSubjectMastery,
  toNonNegativeInt,
}
