const FRAME_INTERVAL_MS = 80

const DEFAULT_DURATIONS = {
  count: 600,
  percent: 500,
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function toDisplayNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number)
}

function buildSegment(value, index) {
  const text = String(value)
  return {
    key: `${index}-${text}`,
    text,
    direction: index % 2 === 0 ? 'top' : 'bottom',
    delay: index * 38,
  }
}

function buildNumberSegments(value) {
  const digits = String(toDisplayNumber(value)).split('')
  return digits.map(buildSegment)
}

function buildPercentSegments(value) {
  const percent = clamp(Math.round(Number(value) || 0), 0, 100)
  return buildNumberSegments(percent)
}

function buildDisplay(field, value) {
  if (field.kind === 'percent') return buildPercentSegments(value)
  return buildNumberSegments(value)
}

function updateField(options) {
  const { values, field, fromValue, toValue, duration, elapsed } = options
  if (fromValue === toValue) return true
  const progress = clamp(elapsed / duration, 0, 1)
  const eased = 1 - Math.pow(1 - progress, 3)
  const current = Math.round(fromValue + (toValue - fromValue) * eased)
  values[field] = toValue >= fromValue
    ? Math.min(toValue, Math.max(fromValue, current))
    : Math.max(toValue, Math.min(fromValue, current))
  return progress >= 1
}

function tick(page, state) {
  if (!page._alive || !page._visible) {
    page._numberRevealTimer = null
    return
  }
  const elapsed = Date.now() - state.startTime
  const patch = {}
  const complete = state.fields.map((field) => updateField({
    values: patch,
    field: field.name,
    fromValue: state.from[field.name],
    toValue: state.to[field.name],
    duration: state.durations[field.name] || DEFAULT_DURATIONS.count,
    elapsed,
  }))
  state.fields.forEach((field) => {
    if (patch[field.name] === undefined) return
    if (field.segmentsKey) patch[field.segmentsKey] = buildDisplay(field, patch[field.name])
  })
  if (Object.keys(patch).length) page.setData(patch)
  if (complete.every(Boolean)) {
    page._numberRevealTimer = null
    return
  }
  page._numberRevealTimer = setTimeout(() => tick(page, state), FRAME_INTERVAL_MS)
}

function clear(page) {
  if (page._numberRevealTimer) {
    clearTimeout(page._numberRevealTimer)
    page._numberRevealTimer = null
  }
}

function start(page, options) {
  clear(page)
  const fields = options.fields || []
  const unchanged = fields.every((field) => page.data[field.name] === options.to[field.name])
  if (unchanged) return false
  const state = {
    fields,
    from: fields.reduce((result, field) => {
      result[field.name] = page.data[field.name]
      return result
    }, {}),
    to: options.to,
    durations: options.durations || DEFAULT_DURATIONS,
    startTime: Date.now(),
  }
  page._numberRevealTimer = setTimeout(() => tick(page, state), FRAME_INTERVAL_MS)
  return true
}

module.exports = {
  DEFAULT_DURATIONS,
  buildNumberSegments,
  buildPercentSegments,
  clear,
  start,
  tick,
}
