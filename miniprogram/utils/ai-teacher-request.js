const CHECKING_TIMEOUT_MS = 65000

function availabilityError(state) {
  const error = new Error(state.message || 'AI 服务暂不可用，请稍后重试')
  error.statusCode = 503
  error.detail = { ...state, code: 'ai_service_unavailable' }
  return error
}

function assertCurrent(isCurrent) {
  if (!isCurrent()) throw new Error('本次 AI 讲解请求已取消')
}

async function waitForAvailability(api, isCurrent, deadline) {
  for (let attempt = 0; attempt < 65 && Date.now() < deadline; attempt++) {
    assertCurrent(isCurrent)
    const state = await api.get('/ai/error-analysis/availability', {}, {
      timeout: Math.min(5000, Math.max(1, deadline - Date.now())),
      suppressNetworkToast: true,
    })
    assertCurrent(isCurrent)
    if (Date.now() >= deadline) break
    if (state && state.enabled === true) return
    if (!state || state.status !== 'checking' || state.reason !== 'checking') {
      throw availabilityError(state || {})
    }
    const remaining = deadline - Date.now()
    const delay = Math.min(remaining, Math.max(1000, Math.min(5000, Number(state.retry_after_ms) || 2000)))
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  assertCurrent(isCurrent)
  throw availabilityError({ reason: 'checking', message: 'AI 服务检查超时，请稍后重新尝试' })
}

async function requestTeacher(api, payload, { timeout = 55000, isCurrent = () => true } = {}) {
  const deadline = Date.now() + CHECKING_TIMEOUT_MS
  await waitForAvailability(api, isCurrent, deadline)
  try {
    return await api.post('/ai/408-teacher', payload, { timeout })
  } catch (error) {
    const detail = error && error.detail
    if (!detail || detail.code !== 'ai_service_unavailable' ||
        detail.status !== 'checking' || detail.reason !== 'checking') throw error
    await waitForAvailability(api, isCurrent, deadline)
    return api.post('/ai/408-teacher', payload, { timeout })
  }
}

module.exports = { requestTeacher }
