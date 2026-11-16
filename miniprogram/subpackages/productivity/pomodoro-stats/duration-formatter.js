function formatDuration(sec) {
  var s = Math.max(0, sec || 0)
  var totalMin = Math.floor(s / 60)
  var hours = Math.floor(totalMin / 60)
  var mins = totalMin % 60
  if (hours > 0) return hours + '时' + mins + '分'
  return mins + '分钟'
}

function formatHourMinute(sec) {
  const s = Math.max(0, sec || 0)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mins = m % 60
  return `${h}时${mins}分`
}

function formatMin(sec) {
  const s = Math.max(0, sec || 0)
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分钟`
  return `${Math.floor(m / 60)}时${m % 60}分`
}

function buildDurationSegments(text, reveal = false) {
  const normalized = String(text || '').trim() || '0分钟'
  const parts = []
  const regex = /(\d+)|(小时|分钟|时|分)/g
  let match = null
  let revealIndex = 0
  while ((match = regex.exec(normalized))) {
    if (match[1]) {
      String(match[1]).split('').forEach(digit => {
        const segment = {
          type: 'num',
          text: digit,
          key: `pos-${parts.length}`,
        }
        if (reveal) {
          segment.direction = revealIndex % 2 === 0 ? 'top' : 'bottom'
          segment.delay = revealIndex * 28
        }
        parts.push(segment)
        revealIndex += 1
      })
    } else if (match[2]) {
      parts.push({ type: 'unit', text: match[2], key: `pos-${parts.length}` })
    }
  }
  if (!parts.length) {
    const segment = { type: 'num', text: normalized, key: 'pos-0' }
    if (reveal) {
      segment.direction = 'top'
      segment.delay = 0
    }
    return [segment]
  }
  return parts
}

module.exports = {
  formatDuration,
  formatHourMinute,
  formatMin,
  buildDurationSegments,
}
