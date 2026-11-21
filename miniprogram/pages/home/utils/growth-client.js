function fetchGrowthResponses(apiClient, options = {}) {
  if (!apiClient || typeof apiClient.get !== 'function') {
    return Promise.reject(new TypeError('growth API client must expose get()'))
  }
  const refresh = options && options.refresh === true
  const getStats = url => refresh
    ? apiClient.get(url, { refresh: true })
    : apiClient.get(url)
  return Promise.all([
    getStats('/stats/dashboard'),
    getStats('/stats/growth').catch(() => null),
    apiClient.get('/study-hub/overview').catch((error) => {
      console.warn('加载智能学习中心失败，回退基础首页', error)
      return null
    }),
    apiClient.get('/study-plan/overview').catch((error) => {
      console.warn('加载长期学习计划失败', error)
      return null
    }),
  ]).then((responses) => ({
    dashboard: responses[0],
    growth: responses[1],
    hub: responses[2],
    plan: responses[3],
  }))
}

function isGrowthStale(options = {}) {
  return !(
    options.alive &&
    options.visible &&
    options.requestSeq === options.growthSeq &&
    options.showSeq === options.currentShowSeq
  )
}

function reviewRemainingCount(responses = {}) {
  const hub = responses.hub
  if (hub && hub.scope_ready !== false && hub.review) {
    const remaining = Number(hub.review.remaining_count)
    if (Number.isFinite(remaining)) return remaining
  }
  const overview = responses.dashboard && responses.dashboard.overview
  const fallback = Number(overview && overview.due_review_count)
  return Number.isFinite(fallback) ? fallback : 0
}

function needsReviewCompletionRetry(responses) {
  return reviewRemainingCount(responses) > 0
}

module.exports = { fetchGrowthResponses, isGrowthStale, needsReviewCompletionRetry }
