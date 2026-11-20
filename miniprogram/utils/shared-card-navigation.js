// (2) One-use, in-memory geometry only. No account data or durable cache.
const transitions = new Map()
let serial = 0

function take(key) {
  const value = transitions.get(key)
  transitions.delete(key)
  return value && Date.now() - value.createdAt < 5000 ? value : null
}

function open(page, event, url, title, isCurrent = () => true) {
  if (page._sharedCardOpening) return
  const id = event && event.currentTarget && event.currentTarget.id
  page._sharedCardOpening = true
  const navigate = rect => {
    if (!isCurrent() || page._pageAlive === false || page._visible === false) {
      page._sharedCardOpening = false
      return
    }
    const key = 'card-' + (++serial)
    const hasRect = rect && rect.width > 0 && rect.height > 0
    if (hasRect) {
      transitions.clear()
      transitions.set(key, { rect, title: String(title || '速记卡'), createdAt: Date.now() })
    }
    wx.navigateTo({
      url: hasRect ? url + (url.includes('?') ? '&' : '?') + '_motion=' + key : url,
      animationType: hasRect ? 'fade-in' : 'slide-in-right',
      animationDuration: hasRect ? 0 : 300,
      complete() { page._sharedCardOpening = false },
      fail() { transitions.delete(key) },
    })
  }
  if (!id || !wx.createSelectorQuery) return navigate(null)
  wx.createSelectorQuery().in(page).select('#' + id).boundingClientRect(navigate).exec()
}

function back(page, navigate, cancelled) {
  const transition = typeof page.selectComponent === 'function' && page.selectComponent('#readerSharedTransition')
  const restore = () => {
    // (2) A rejected native return must not leave the completed surface visible.
    if (transition) transition.cancel()
    if (cancelled) cancelled()
  }
  if (transition && transition.leave(() => navigate(true, restore), cancelled)) return
  navigate(false, cancelled)
}

module.exports = { open, take, back }
