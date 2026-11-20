const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildReviewResultPayload,
  buildReviewResultUrl,
} = require('../subpackages/study/review-today/utils/review-result-payload-builder')

const groupQuestions = [
  { question_id: 11, question_version_id: 3, content: { text: '题目甲' }, options: { A: '1' }, question_type: 'single' },
  { question_id: 12, question_version_id: 4, content: { text: '题目乙' }, options: { A: '2' }, question_type: 'single' },
  { question_id: 13, question_version_id: 5, content: { text: '题目丙' }, options: null, question_type: 'blank' },
]

const groupResults = [
  { question_id: 11, question_version_id: 3, schedule_id: 1, occurrence_seq: 0, wasSubmitted: true, isCorrect: true, userAnswer: 'A', correctAnswer: 'A' },
  { question_id: 12, question_version_id: 4, schedule_id: 2, occurrence_seq: 1, wasSubmitted: true, isCorrect: false, userAnswer: 'B', correctAnswer: 'C' },
  { question_id: 13, question_version_id: 5, schedule_id: 3, occurrence_seq: 2, wasSubmitted: false, isCorrect: false, userAnswer: '', correctAnswer: '' },
]

test('maps review results onto the practice-result cache contract', () => {
  const payload = buildReviewResultPayload({ groupResults, groupQuestions, durationSec: 125.6, now: 1700000000000, random: 0.5 })
  assert.equal(payload.correct, 1)
  assert.equal(payload.wrong, 1)
  assert.equal(payload.skipped, 1)
  assert.equal(payload.partial, 0)
  assert.equal(payload.total, 3)
  assert.equal(payload.duration, 126)
  assert.match(payload._cacheKey, /^pr_1700000000000_[0-9a-z]{2,8}$/)
  assert.equal(payload._createdAt, 1700000000000)
  assert.equal(payload.results.length, 3)
  assert.equal(payload.questions.length, 3)
  assert.equal(payload.results[0].status, 'correct')
  assert.equal(payload.results[1].status, 'wrong')
  assert.equal(payload.results[2].status, 'skipped')
  assert.equal(payload.questions[0].id, 11)
  assert.equal(payload.questions[0].stem, '题目甲')
  assert.equal(payload.subject_name, '今日复习')
  assert.equal(payload._source, 'review_today')
})

test('failed submissions keep their slot without fake correctness', () => {
  const payload = buildReviewResultPayload({
    groupResults: [{ question_id: 9, wasSubmitted: true, submitFailed: true, isCorrect: false, userAnswer: 'A', correctAnswer: 'B' }],
    groupQuestions: [{ question_id: 9, question_version_id: 1, content: { text: '题' } }],
    now: 1,
    random: 0.2,
  })
  assert.equal(payload.results[0].status, 'partial')
  assert.equal(payload.correct, 0)
  assert.equal(payload.wrong, 0)
  assert.equal(payload.partial, 1)
})

test('builds the redirect url with the cache key and review source', () => {
  const payload = buildReviewResultPayload({ groupResults, groupQuestions, durationSec: 10, now: 1700000000000, random: 0.5 })
  const url = buildReviewResultUrl(payload)
  assert.ok(url.startsWith('/subpackages/study/practice-result/index?'))
  assert.ok(url.includes('&total=3'))
  assert.ok(url.includes(`&_ck=${payload._cacheKey}`))
  assert.ok(url.includes('&source=review_today'))
  assert.ok(url.includes('&review_session_only=0'))
  assert.ok(url.includes(encodeURIComponent('今日复习')))
  assert.equal(buildReviewResultUrl(null), '')
})

test('marks results as session-only when review work was completed earlier today', () => {
  const payload = buildReviewResultPayload({
    groupResults,
    groupQuestions,
    reviewSessionOnly: true,
    now: 1700000000000,
    random: 0.5,
  })
  assert.equal(payload.review_session_only, true)
  assert.ok(buildReviewResultUrl(payload).includes('&review_session_only=1'))
})

test('uses enriched cumulative results when older group question payloads are unavailable', () => {
  const payload = buildReviewResultPayload({
    groupResults: [
      {
        question_id: 21,
        question_version_id: 31,
        schedule_id: 41,
        occurrence_seq: 3,
        content: { text: '来自第一组的结果快照' },
        wasSubmitted: true,
        isCorrect: true,
        userAnswer: 'A',
        correctAnswer: 'A',
      },
      {
        question_id: 22,
        question_version_id: 32,
        schedule_id: 42,
        occurrence_seq: 4,
        content: { text: '来自最后一组的结果快照' },
        wasSubmitted: true,
        isCorrect: false,
        userAnswer: 'B',
        correctAnswer: 'D',
      },
    ],
    groupQuestions: [{
      question_id: 22,
      question_version_id: 32,
      schedule_id: 42,
      occurrence_seq: 4,
      content: { text: '最后一组题目元数据' },
    }],
    now: 2,
    random: 0.25,
  })
  assert.deepEqual(payload.questions.map(item => item.id), [21, 22])
  assert.equal(payload.questions[0].stem, '来自第一组的结果快照')
  assert.equal(payload.questions[1].stem, '最后一组题目元数据')
})
