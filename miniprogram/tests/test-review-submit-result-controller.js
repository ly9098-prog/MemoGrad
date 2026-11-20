const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createGroupSubmitResultController,
} = require('../subpackages/study/review-today/utils/submit-result-controller')

function createHarness(overrides = {}) {
  const state = {
    data: {
      groups: [],
      todayDueCount: 6,
      todayCompletedCount: 1,
      currentGroupIdx: 0,
    },
    session: {
      allGroupResults: [],
      todayTaskTotalCount: 6,
      completedBeforeSession: 0,
      timerElapsedMs: 0,
      reviewTotalElapsedMs: 0,
    },
    clearedDrafts: [],
    toasts: [],
    paused: false,
    resultDockShown: false,
    setPatches: [],
    cachedResults: [],
    resultUrls: [],
    homeRefreshMarks: 0,
  }
  const controller = createGroupSubmitResultController({
    getGroups: () => state.data.groups,
    getSession: () => state.session,
    getTodayDueCount: () => state.data.todayDueCount,
    getTodayCompletedCount: () => state.data.todayCompletedCount,
    getCurrentGroupIdx: () => state.data.currentGroupIdx,
    clearSubmittedDraft: (questions, results) => { state.clearedDrafts.push({ questions, results }) },
    showToast: options => { state.toasts.push(options) },
    pauseTimer: () => { state.paused = true },
    setData: patch => { state.setPatches.push(patch); Object.assign(state.data, patch) },
    showResultDockAndRefreshTimer: () => { state.resultDockShown = true },
    isGuestMode: () => false,
    writeResultCache: payload => { state.cachedResults.push(payload) },
    openResultUrl: url => { state.resultUrls.push(url) },
    markHomeGrowthRefresh: () => { state.homeRefreshMarks += 1 },
    ...overrides,
  })
  return { controller, state }
}

const question = { schedule_id: 1 }
const groupResults = [{
  schedule_id: 1,
  wasSubmitted: true,
  isCorrect: true,
  submitFailed: false,
  refreshRequired: false,
}]

test('clears confirmed drafts, updates session, and writes result view', () => {
  const { controller, state } = createHarness()
  const outcome = controller.apply({ groupQuestions: [question], groupResults })

  assert.deepEqual(state.clearedDrafts, [{ questions: [question], results: groupResults }])
  assert.deepEqual(state.toasts, [])
  assert.equal(state.paused, true)
  assert.equal(state.session.totalCorrect, 1)
  assert.equal(state.session.totalCompleted, 1)
  assert.equal(state.setPatches.length, 1)
  assert.equal(state.data.phase, 'group-result')
  assert.equal(state.data.submittingGroup, false)
  assert.equal(state.data.resultDockVisible, true)
  assert.equal(state.data.todayRemainingCount, 5)
  assert.equal(outcome.view.todayRemainingCount, 5)
  assert.equal(state.resultDockShown, false)
  assert.equal(state.cachedResults.length, 0)
  assert.equal(state.resultUrls.length, 0)
})

test('shows failure toast and completion dock', () => {
  const { controller, state } = createHarness()
  const failed = [{
    schedule_id: 1,
    wasSubmitted: false,
    isCorrect: false,
    submitFailed: true,
    refreshRequired: true,
  }]
  state.data.todayDueCount = 1
  state.data.todayCompletedCount = 0
  state.session.todayTaskTotalCount = 1

  controller.apply({ groupQuestions: [question], groupResults: failed })

  assert.deepEqual(state.toasts, [{ title: '1 题任务已更新，将重新获取', icon: 'none' }])
  assert.equal(state.data.todayRemainingCount, 1)
  assert.equal(state.resultDockShown, false)

  state.data.todayDueCount = 0
  state.session.todayTaskTotalCount = 0
  state.session.timerElapsedMs = 75000
  controller.apply({ groupQuestions: [question], groupResults: [] })
  assert.equal(state.resultDockShown, true)
  assert.equal(state.cachedResults.length, 1)
  assert.equal(state.cachedResults[0].partial, 1)
  assert.equal(state.resultUrls.length, 1)
  assert.match(state.resultUrls[0], /source=review_today/)
  assert.equal(state.homeRefreshMarks, 1)
  assert.equal(state.cachedResults[0].duration, 75)
})

test('final review result aggregates every group completed in the session', () => {
  const { controller, state } = createHarness()
  state.data.todayDueCount = 2
  state.session.todayTaskTotalCount = 2
  state.session.completedBeforeSession = 0
  const firstQuestion = {
    schedule_id: 1,
    question_id: 101,
    question_version_id: 11,
    occurrence_seq: 0,
    content: { text: '第一组题' },
  }
  const secondQuestion = {
    schedule_id: 2,
    question_id: 102,
    question_version_id: 12,
    occurrence_seq: 0,
    content: { text: '第二组题' },
  }

  state.session.timerElapsedMs = 30000
  controller.apply({
    groupQuestions: [firstQuestion],
    groupResults: [{
      ...firstQuestion,
      wasSubmitted: true,
      isCorrect: true,
      userAnswer: 'A',
      correctAnswer: 'A',
    }],
  })
  state.session.timerElapsedMs = 0
  state.data.currentGroupIdx = 1
  state.session.allQuestions = [secondQuestion]
  state.session.timerElapsedMs = 45000
  controller.apply({
    groupQuestions: [secondQuestion],
    groupResults: [{
      ...secondQuestion,
      wasSubmitted: true,
      isCorrect: false,
      userAnswer: 'B',
      correctAnswer: 'C',
    }],
  })

  const payload = state.cachedResults[0]
  assert.equal(payload.total, 2)
  assert.equal(payload.correct, 1)
  assert.equal(payload.wrong, 1)
  assert.deepEqual(payload.results.map(item => item.question_id), [101, 102])
  assert.deepEqual(payload.questions.map(item => item.id), [101, 102])
  assert.equal(payload.questions[0].stem, '第一组题')
  assert.equal(payload.questions[1].stem, '第二组题')
  assert.equal(payload.subject_name, '今日复习')
  assert.equal(payload._source, 'review_today')
  assert.equal(payload.duration, 75)
  assert.equal(state.session.reviewTotalElapsedMs, 75000)
})
