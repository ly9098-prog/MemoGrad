const revealGate = require('../../../utils/digit-reveal-gate')

// Duration controllers publish one final value; hold only its CSS entrance.
function commitDuration(page, patch) {
  const segments = patch._dispTodayDurationSegments
  if (!segments || !segments.some(item => item.direction)) return page.setData(patch)
  const revision = page._durationRevealRevision
  const date = page.data.selectedDate
  const previous = page._durationRevealCommit
  if (previous && previous.text === patch._dispTodayDurationText &&
      previous.date === date && previous.revision === revision) return page.setData(patch)
  const commit = { text: patch._dispTodayDurationText, date, revision }
  page._durationRevealCommit = commit
  page.setData({ ...patch, _durationRevealPlaying: false }, () => {
    if (page._durationRevealCommit !== commit || revision !== page._durationRevealRevision) return
    revealGate.arm(page, 'duration', '.daily-duration-value-row', () => {
      // Refresh generations do not invalidate content that is already rendered.
      if (page._durationRevealCommit !== commit || revision !== page._durationRevealRevision) return
      page.setData({ _durationRevealPlaying: true })
    })
  })
}

module.exports = { commitDuration, gate: revealGate }
