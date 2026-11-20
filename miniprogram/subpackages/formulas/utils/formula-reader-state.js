const storage = require('../../../utils/storage')

const SEQUENCE_KEY = 'reader_sequence'
// This existing session prefix is cleared by the shared logout flow.
const MODE_KEY = 'study_active_v1:formula-reader-mode'
const SEQUENCE_TTL = 30 * 60 * 1000
const FILTER_KEYS = ['subject_code', 'exam_scope', 'chapter_id', 'category_id', 'tags', 'library_type', 'study_card_type', 'q', 'favorite_only']

function sessionIdentity() {
  const sessionGeneration = storage.currentSessionGeneration()
  return {
    owner: sessionGeneration ? String(storage.ownerFingerprint() || 'session') : 'guest',
    sessionGeneration,
  }
}

function cacheScope() {
  // Logout already clears these caches. Only the stable account belongs on
  // disk: token renewal and a new app runtime must not reset the reading mode.
  return { owner: sessionIdentity().owner }
}

function sameSession(a, b = sessionIdentity()) {
  return Boolean(a && a.owner === b.owner && a.sessionGeneration === b.sessionGeneration)
}

function sameCacheScope(saved) {
  const scope = cacheScope()
  return Boolean(saved && saved.owner === scope.owner)
}

function readMode(explicitMode) {
  if (explicitMode === 'browse' || explicitMode === 'recite') return explicitMode
  const saved = storage.get(MODE_KEY)
  return sameCacheScope(saved) && saved.mode === 'recite' ? 'recite' : 'browse'
}

function writeMode(mode) {
  if (mode !== 'browse' && mode !== 'recite') return
  storage.set(MODE_KEY, { ...cacheScope(), mode })
}

function sequenceFilters(values = {}) {
  values = values && typeof values === 'object' ? values : {}
  const params = {}
  FILTER_KEYS.forEach(key => {
    const value = values[key]
    if (key === 'favorite_only') {
      if (value === true || value === 'true' || value === '1') params[key] = true
    } else if (value !== undefined && value !== null && value !== '') {
      params[key] = String(value)
    }
  })
  if (sessionIdentity().owner === 'guest') delete params.favorite_only
  return params
}

function readSequence(formulaId, now, requestedFilters = {}) {
  const saved = storage.get(SEQUENCE_KEY)
  const age = saved ? now - Number(saved.savedAt) : NaN
  if (!sameCacheScope(saved) || !Number.isFinite(age) || age < 0 || age >= SEQUENCE_TTL ||
      !Array.isArray(saved.ids) || !saved.ids.some(id => String(id) === String(formulaId))) return null
  const filters = sequenceFilters(requestedFilters)
  if (Object.keys(filters).length) {
    const savedFilters = sequenceFilters(saved.params)
    if (FILTER_KEYS.some(key => filters[key] !== savedFilters[key])) return null
  }
  return saved
}

function writeSequence(value, now) {
  storage.set(SEQUENCE_KEY, { ...value, ...cacheScope(), savedAt: now })
}

function queryString(values) {
  return Object.entries(values).filter(entry => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
    .map(entry => `${encodeURIComponent(entry[0])}=${encodeURIComponent(entry[1])}`).join('&')
}

module.exports = { sessionIdentity, sameSession, readMode, writeMode, sequenceFilters, readSequence, writeSequence, queryString }
