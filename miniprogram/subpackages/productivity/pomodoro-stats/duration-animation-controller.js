const { formatMin, buildDurationSegments } = require('./duration-formatter')

function createDurationAnimationController(options) {
  return {
    cancel(resetState) {
      cancelImpl(options, resetState)
    },
    animate(fromSec, toSec, fromSessions, toSessions) {
      animateImpl(options, fromSec, toSec, fromSessions, toSessions)
    },
  }
}

function cancelImpl(options, resetState) {
  options.incrementToken()
  const timer = options.getTimer()
  if (timer) {
    options.clearTimeout(timer)
    options.setTimer(null)
  }
  if (resetState && options.isAlive()) {
    options.setData({ durationValueAnimating: false })
  }
}

// Publish the final value once. CSS owns the alternating digit entrance;
// intermediate numeric ticks would create a second, competing animation.
function animateImpl(options, _fromSec, toSec, _fromSessions, toSessions) {
  cancelImpl(options, false)
  if (!options.isAlive() || !options.isVisible()) return
  const targetValue = Math.max(0, Number(toSec) || 0)
  const text = formatMin(targetValue)
  const display = options.getDurationDisplayPatch
    ? options.getDurationDisplayPatch(text, { reveal: true })
    : { _dispTodayDurationText: text, _dispTodayDurationSegments: buildDurationSegments(text, true) }
  options.setDisplayDurationSec(targetValue)
  options.setData({
    _dispTodaySessions: Math.max(0, Number(toSessions) || 0),
    ...display,
    durationValueAnimating: false,
  })
}

module.exports = { createDurationAnimationController }
