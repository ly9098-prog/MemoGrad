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
  const hasPrevious = Number.isFinite(previous)
  return Number.isFinite(previous)
    ? { key, value: previous, changed: previous !== score, hasPrevious }
    : { key, value: 0, changed: score > 0, hasPrevious: false }
}

function buildRadarView(subjectMastery, previousValues = {}) {
  const items = (Array.isArray(subjectMastery) ? subjectMastery : []).slice(0, 4)
  const view = items.map((item, index) => {
    const subjectCode = String(item && item.subjectCode || `subject-${index}`)
    const score = item && item.hasData ? toScore(item.score) : 0
    const progress = buildProgressWithKey(previousValues, subjectCode, score)
    const angle = RADAR_ANGLES[index] * Math.PI / 180
    const progressValue = progress.value
    const radius = 38 * progressValue / 100
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
      trend: progress.hasPrevious && delta > 0 ? 'up' : progress.hasPrevious && delta < 0 ? 'down' : '',
      trendText: !progress.hasPrevious || delta === 0
        ? ''
        : delta > 0 ? `+${delta}` : `${delta}`,
      x,
      y,
      pointStyle: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;`,
    }
  })
  const polygonStyle = view.length === 4
    ? `clip-path:polygon(${view.map(item => `${item.x.toFixed(2)}% ${item.y.toFixed(2)}%`).join(',')});-webkit-clip-path:polygon(${view.map(item => `${item.x.toFixed(2)}% ${item.y.toFixed(2)}%`).join(',')});`
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
    const angle = RADAR_ANGLES[item.index] * Math.PI / 180
    const radius = 38 * value / 100
    const x = 50 + Math.cos(angle) * radius
    const y = 50 + Math.sin(angle) * radius
    patch[`_masteryRadarItems[${index}].progressValue`] = value
    patch[`_masteryRadarItems[${index}].x`] = x
    patch[`_masteryRadarItems[${index}].y`] = y
    patch[`_masteryRadarItems[${index}].pointStyle`] = `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;`
    complete = complete && progress >= 1
  })
  const pointStyles = state.items.items.map((item, index) => {
    const value = patch[item.progress.key] !== undefined ? patch[item.progress.key] : item.progressValue
    const angle = RADAR_ANGLES[item.index] * Math.PI / 180
    const radius = 38 * value / 100
    const x = 50 + Math.cos(angle) * radius
    const y = 50 + Math.sin(angle) * radius
    return { index, x, y }
  })
  if (pointStyles.length === 4) {
    const polygonPoints = pointStyles.map(point => `${point.x.toFixed(2)}% ${point.y.toFixed(2)}%`).join(',')
    patch._masteryRadarPolygonStyle = `clip-path:polygon(${polygonPoints});-webkit-clip-path:polygon(${polygonPoints});`
  }
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
