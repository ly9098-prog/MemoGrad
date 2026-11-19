const {
  KEYS,
  BUSINESS_CACHE_KEYS,
  PROTECTED_KEYS,
  SESSION_DYNAMIC_KEY_PREFIXES,
  get,
  set,
  setStrict,
  remove,
  clearSession,
  currentSessionGeneration,
  ownerFingerprint,
} = require('./storage-core')
const { studyStrategy } = require('./study-strategy')
const { pomodoroTaskTypes } = require('./pomodoro-task-types')
const { knowledgePracticeSync } = require('./knowledge-practice-sync')

module.exports = {
  KEYS,
  get,
  set,
  setStrict,
  remove,
  clearSession,
  currentSessionGeneration,
  ownerFingerprint,
  BUSINESS_CACHE_KEYS,
  PROTECTED_KEYS,
  SESSION_DYNAMIC_KEY_PREFIXES,
  studyStrategy,
  pomodoroTaskTypes,
  knowledgePracticeSync,
}
