const revealGate = require('./digit-reveal-gate')

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
    key: `pos-${index}`,
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

function commitDisplayPatch(patch, field, value) {
  patch[field.name] = value
  if (field.segmentsKey) patch[field.segmentsKey] = buildDisplay(field, value)
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
  if (page._numberRevealState !== state) return
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
    if (patch[field.name] === page.data[field.name]) {
      delete patch[field.name]
      return
    }
    if (field.segmentsKey) patch[field.segmentsKey] = buildDisplay(field, patch[field.name])
  })
  if (Object.keys(patch).length) page.setData(patch)
  if (complete.every(Boolean)) {
    page._numberRevealTimer = null
    page._numberRevealState = null
    return
  }
  page._numberRevealTimer = setTimeout(() => tick(page, state), FRAME_INTERVAL_MS)
}

function clear(page) {
  page._numberRevealRevision = (page._numberRevealRevision || 0) + 1
  ;(page._numberRevealFields || []).forEach(field => revealGate.cancel(page, field.segmentsKey))
  if (page._numberRevealTimer) clearTimeout(page._numberRevealTimer)
  page._numberRevealTimer = null
  page._numberRevealState = null
}

function finish(page) {
  const state = page._numberRevealState
  if (page._numberRevealTimer) clearTimeout(page._numberRevealTimer)
  page._numberRevealTimer = null
  page._numberRevealState = null
  if (!state) return false
  const patch = {}
  state.fields.forEach(field => commitDisplayPatch(patch, field, toDisplayNumber(state.to[field.name])))
  // Retain offscreen/unfinished view commits: their CSS entrance is still owed
  // when the user returns. Count-up itself is finalized on hide.
  page.setData(patch)
  return true
}

function start(page, options) {
  const fields = options.fields || []
  const active = page._numberRevealState
  const changed = fields.filter(field => (
    (active ? active.to[field.name] : page.data[field.name]) !== options.to[field.name] ||
    !hasDisplaySegments(page.data, field)
  ))
  // An identical refresh must not cancel entrances waiting below the fold.
  if (!changed.length) return false
  changed.push(...fields.filter(field => !changed.includes(field) &&
    page.data[field.segmentsKey + 'Playing'] === false))
  clear(page)
  const revision = page._numberRevealRevision
  page._numberRevealFields = fields
  const initialPatch = {}
  changed.forEach(field => {
    commitDisplayPatch(initialPatch, field, toDisplayNumber(page.data[field.name]))
    initialPatch[field.segmentsKey + 'Playing'] = false
  })
  const state = {
    fields,
    from: fields.reduce((result, field) => {
      result[field.name] = toDisplayNumber(page.data[field.name])
      return result
    }, {}),
    to: options.to,
    durations: options.durations || DEFAULT_DURATIONS,
    startTime: null,
  }
  page._numberRevealState = state
  page.setData(initialPatch, () => {
    if (page._numberRevealRevision !== revision) return
    changed.forEach(field => {
      revealGate.arm(page, field.segmentsKey, field.selector || options.selector || '.reveal-metric', () => {
        if (page._numberRevealRevision !== revision) return
        page.setData({ [field.segmentsKey + 'Playing']: true }, () => {
          if (page._numberRevealState !== state || state.startTime !== null ||
              !page._alive || !page._visible) return
          state.startTime = Date.now()
          page._numberRevealTimer = setTimeout(() => tick(page, state), FRAME_INTERVAL_MS)
        })
      }, options.canStart)
    })
  })
  return true
}

function hasDisplaySegments(data, field) {
  const segments = data[field.segmentsKey]
  return Array.isArray(segments) && segments.length > 0 &&
    segments.map(segment => segment.text).join('') ===
      buildDisplay(field, data[field.name]).map(segment => segment.text).join('')
}

module.exports = {
  DEFAULT_DURATIONS,
  buildNumberSegments,
  buildPercentSegments,
  clear,
  finish,
  start,
  tick,
}
