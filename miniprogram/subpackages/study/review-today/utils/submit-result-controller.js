const { buildGroupOutcome } = require('./group-submission')
const {
  buildReviewResultPayload,
  buildReviewResultUrl,
} = require('./review-result-payload-builder')

function createGroupSubmitResultController(options) {
  return {
    apply(input) {
      const session = options.getSession()
      // Drafts are removed only after the server confirms the immutable occurrence.
      options.clearSubmittedDraft(input.groupQuestions, input.groupResults)
      const outcome = buildGroupOutcome({
        groupResults: input.groupResults,
        groupQuestions: input.groupQuestions,
        groups: options.getGroups(),
        allGroupResults: session.allGroupResults,
        sessionTodayTaskTotalCount: session.todayTaskTotalCount,
        dataTodayDueCount: options.getTodayDueCount(),
        dataTodayCompletedCount: options.getTodayCompletedCount(),
        completedBeforeSession: session.completedBeforeSession,
        currentGroupIdx: options.getCurrentGroupIdx(),
      })
      if (outcome.failureToast) options.showToast({ title: outcome.failureToast, icon: 'none' })
      Object.assign(session, outcome.session)
      options.pauseTimer()
      session.reviewTotalElapsedMs = Math.max(
        0,
        Number(session.reviewTotalElapsedMs || 0)
      ) + Math.max(0, Number(session.timerElapsedMs || 0))
      options.setData({
        phase: 'group-result',
        ...outcome.view,
        groupResults: input.groupResults,
        showGroupDetails: false,
        submittingGroup: false,
        resultDockVisible: true,
      })
      if (outcome.view.todayRemainingCount <= 0 && !options.isGuestMode()) {
        openPracticeResult(options)
      }
      if (outcome.view.todayRemainingCount <= 0) options.showResultDockAndRefreshTimer()
      return outcome
    },
  }
}

function openPracticeResult(options) {
  const session = options.getSession()
  const payload = buildReviewResultPayload({
    groupResults: session.allGroupResults,
    groupQuestions: session.allQuestions,
    durationSec: Math.floor(Number(session.reviewTotalElapsedMs || 0) / 1000),
    reviewSessionOnly: Number(session.completedBeforeSession || 0) > 0,
  })
  try {
    options.writeResultCache(payload)
  } catch (storageError) {
    return false
  }
  const resultUrl = buildReviewResultUrl(payload)
  if (!resultUrl) return false
  options.markHomeGrowthRefresh()
  options.openResultUrl(resultUrl)
  return true
}

module.exports = {
  createGroupSubmitResultController,
}
