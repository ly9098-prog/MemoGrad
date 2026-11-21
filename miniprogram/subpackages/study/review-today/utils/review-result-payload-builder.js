// Builds a practice-result compatible payload for a completed review day.
// Mirrors the `lastPracticeResult` cache contract so the final review group can
// hand off to the shared result page without maintaining a second result UI.

function buildCacheKey(now, random) {
  return 'pr_' + now + '_' + random.toString(36).slice(2, 8).padEnd(4, '0')
}

function toStoredResult(result) {
  if (!result) return null
  const submitFailed = Boolean(result.submitFailed)
  const wasSubmitted = Boolean(result.wasSubmitted) && !submitFailed
  const status = !wasSubmitted
    ? (submitFailed ? 'partial' : 'skipped')
    : (result.isCorrect ? 'correct' : 'wrong')
  return {
    question_id: result.question_id,
    question_version_id: result.question_version_id != null ? result.question_version_id : null,
    schedule_id: result.schedule_id,
    occurrence_seq: result.occurrence_seq,
    user_answer: result.userAnswer || '',
    correct_answer: result.correctAnswer || '',
    is_correct: wasSubmitted ? Boolean(result.isCorrect) : false,
    wrong_question_id: result.wrongQuestionId != null ? result.wrongQuestionId : null,
    status,
    _local_partial: status === 'partial',
    _local_skipped: status === 'skipped',
  }
}

function toLightQuestion(question) {
  if (!question) return null
  const content = question.content || {}
  return {
    id: question.question_id != null ? question.question_id : question.id,
    schedule_id: question.schedule_id != null ? question.schedule_id : null,
    question_version_id: question.question_version_id != null ? question.question_version_id : null,
    question_version: question.question_version || null,
    stem: content.text || content.stem || question.stem || '',
    options: question.options || null,
    question_type: question.question_type || '',
  }
}

function collectResultQuestions(groupResults, groupQuestions) {
  const bySchedule = {}
  const byQuestionVersion = {}
  const byQuestion = {}
  groupQuestions.forEach(question => {
    if (!question) return
    const scheduleId = question.schedule_id != null ? String(question.schedule_id) : ''
    const questionId = question.question_id != null ? question.question_id : question.id
    const versionId = question.question_version_id
    if (scheduleId) bySchedule[scheduleId] = question
    if (questionId != null) byQuestion[String(questionId)] = question
    if (questionId != null && versionId != null) {
      byQuestionVersion[String(questionId) + ':' + String(versionId)] = question
    }
  })
  return groupResults.map(result => {
    if (!result) return null
    const scheduleId = result.schedule_id != null ? String(result.schedule_id) : ''
    const questionId = result.question_id
    const versionId = result.question_version_id
    return bySchedule[scheduleId] ||
      byQuestionVersion[String(questionId) + ':' + String(versionId)] ||
      byQuestion[String(questionId)] ||
      result
  })
}

function countByStatus(results) {
  const counts = { correct: 0, wrong: 0, skipped: 0, partial: 0 }
  results.forEach(item => {
    if (counts[item.status] !== undefined) counts[item.status] += 1
  })
  return counts
}

function buildReviewResultPayload(input) {
  const options = input || {}
  const groupResults = Array.isArray(options.groupResults) ? options.groupResults : []
  const groupQuestions = Array.isArray(options.groupQuestions) ? options.groupQuestions : []
  const storedResults = groupResults.map(toStoredResult).filter(Boolean)
  const lightQuestions = collectResultQuestions(groupResults, groupQuestions)
    .map(toLightQuestion)
    .filter(item => item && item.id != null && item.id !== undefined)
  const counts = countByStatus(storedResults)
  const now = Number(options.now) || (typeof Date !== 'undefined' ? Date.now() : 0)
  const randomValue = typeof options.random === 'number' ? options.random : Math.random()
  const cacheKey = options.cacheKey || buildCacheKey(now, randomValue)
  return {
    correct: counts.correct,
    wrong: counts.wrong,
    skipped: counts.skipped,
    partial: counts.partial,
    total: storedResults.length,
    subject_id: null,
    subject_name: '今日复习',
    duration: Math.max(0, Math.round(Number(options.durationSec) || 0)),
    results: storedResults,
    questions: lightQuestions,
    answers: [],
    comboCount: 0,
    knowledge_session: null,
    request_id: '',
    review_session_only: Boolean(options.reviewSessionOnly),
    _cacheKey: cacheKey,
    _createdAt: now,
    _source: 'review_today',
  }
}

function buildReviewResultUrl(payload) {
  if (!payload || !payload.total) return ''
  return [
    '/subpackages/study/practice-result/index',
    '?correct=' + payload.correct,
    '&wrong=' + payload.wrong,
    '&skipped=' + payload.skipped,
    '&partial=' + payload.partial,
    '&total=' + payload.total,
    '&subject_id=',
    '&subject_name=' + encodeURIComponent('今日复习'),
    '&duration=' + payload.duration,
    '&_ck=' + payload._cacheKey,
    '&_rid=',
    '&_recover=0',
    '&source=review_today',
    '&review_session_only=' + (payload.review_session_only ? '1' : '0'),
    '&return_to=',
  ].join('')
}

module.exports = {
  buildReviewResultPayload,
  buildReviewResultUrl,
}
