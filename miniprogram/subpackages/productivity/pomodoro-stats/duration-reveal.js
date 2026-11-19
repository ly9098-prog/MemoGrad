const revealGate = require('../../../utils/digit-reveal-gate')

// Duration controllers publish one final value; hold only its CSS entrance.
function commitDuration(page, patch) {
  const segments = patch._dispTodayDurationSegments
  if (!segments || !segments.some(item => item.direction)) return page.setData(patch)
  const revision = page._durationRevealRevision
  page.setData({ ...patch, _durationRevealPlaying: false }, () => {
    if (revision !== page._durationRevealRevision) return
    revealGate.arm(page, 'duration', '.daily-duration-value-row', () => {
      // Refresh generations do not invalidate content that is already rendered.
      if (revision !== page._durationRevealRevision) return
      page.setData({ _durationRevealPlaying: true })
    })
  })
}

module.exports = { commitDuration, gate: revealGate }
