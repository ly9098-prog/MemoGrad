const FRAME_INTERVAL_MS = 80
const EXPAND_DURATION_MS = 680
const SCORE_DURATION_MS = 760
const RADAR_ANGLES = [-90, 0, 90, 180]

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function toScore(value) {
  return Math.round(clamp(value, 0, 100))
}

function buildProgressWithKey(previousValues, subjectCode, score) {
  const key = `radar-progress-${subjectCode}`
  const previous = Number(previousValues[key])
  return Number.isFinite(previous)
    ? { key, value: previous, changed: previous !== score }
    : { key, value: 0, changed: score > 0 }
}

function buildRadarView(subjectMastery, previousValues = {}) {
  const items = (Array.isArray(subjectMastery) ? subjectMastery : []).slice(0, 4)
  const view = items.map((item, index) => {
    const subjectCode = String(item && item.subjectCode || `subject-${index}`)
    const score = item && item.hasData ? toScore(item.score) : 0
    const progress = buildProgressWithKey(previousValues, subjectCode, score)
    const angle = RADAR_ANGLES[index] * Math.PI / 180
    const radius = 38 * score / 100
    const x = 50 + Math.cos(angle) * radius
    const y = 50 + Math.sin(angle) * radius
    const delta = score - progress.value
    return {
      index,
      key: `${index}-${subjectCode}`,
      subjectCode,
      subjectName: item ? item.subjectName : '',
      score,
      progress,
      progressValue: progress.value,
      delay: index * 90,
      delta,
      trend: delta > 0 ? 'up' : delta < 0 ? 'down' : '',
      trendText: delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '',
      pointStyle: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;`,
    }
  })
  const polygonStyle = view.length === 4
    ? `clip-path:polygon(${view.map(item => item.pointStyle).join(',')});-webkit-clip-path:polygon(${view.map(item => item.pointStyle).join(',')});`
    : ''
  return {
    items: view,
    polygonStyle,
  }
}

function tick(page, state) {
  if (!page._alive || !page._visible) {
    page._masteryRadarTimer = null
    return
  }
  const elapsed = Date.now() - state.startTime
  const patch = {
    _masteryRadarExpand: clamp(elapsed / EXPAND_DURATION_MS, 0, 1),
  }
  let complete = patch._masteryRadarExpand >= 1
  state.items.items.forEach((item, index) => {
    const duration = item.score === 0 ? 260 : SCORE_DURATION_MS
    const progress = clamp((elapsed - item.delay) / duration, 0, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    const value = Math.round(item.progress.value + item.delta * eased)
    patch[item.progress.key] = value
    patch[`_masteryRadarItems[${index}].progressValue`] = value
    complete = complete && progress >= 1
  })
  page.setData(patch)
  if (complete) {
    page._masteryRadarTimer = null
    return
  }
  page._masteryRadarTimer = setTimeout(() => tick(page, state), FRAME_INTERVAL_MS)
}

function start(page) {
  const radarView = buildRadarView(page.data.subjectMastery, page.data)
  const unchanged = radarView.items.every(item => item.delta === 0)
  page.setData({
    _masteryRadarItems: radarView.items,
    _masteryRadarPolygonStyle: radarView.polygonStyle,
    _masteryRadarExpand: unchanged ? 1 : 0,
  })
  if (page._masteryRadarTimer) {
    clearTimeout(page._masteryRadarTimer)
    page._masteryRadarTimer = null
  }
  if (unchanged) return
  page._masteryRadarTimer = setTimeout(() => tick(page, {
    items: radarView,
    startTime: Date.now(),
  }), 80)
}

function clear(page) {
  if (page._masteryRadarTimer) {
    clearTimeout(page._masteryRadarTimer)
    page._masteryRadarTimer = null
  }
}

module.exports = {
  RADAR_ANGLES,
  buildRadarView,
  clear,
  start,
  tick,
}
