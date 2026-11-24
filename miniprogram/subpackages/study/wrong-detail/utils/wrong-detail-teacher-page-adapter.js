const { requestTeacher } = require('../../../../utils/ai-teacher-request')

function buildTeacherActionPageCapabilities(page, { api, aiTeacher408, presentTeacherResult, AI_REQUEST_TIMEOUT_MS }) {
return {
        getAiLoading: () => page.data.aiLoading,
        getAiRegenerating: () => page.data.aiRegenerating,
        getTeacherLoadingAction: () => page.data.teacherLoadingAction,
        getAiAvailabilityEnabled: () => page.data.aiAvailabilityEnabled === true,
        getAiAvailabilityMessage: () => page.data.aiAvailabilityMessage,
        getWq: () => page.data.wq,
        getErrorDiagnosis: () => page.data.errorDiagnosis,
        setData: patch => page.setData(patch),
        showToast: options => wx.showToast(options),
        buildCacheKey: (wq, diagnosis, action) => page._teacherCacheKeyForWrong(wq, diagnosis, action),
        getCacheEntry: key => page._teacherCache && page._teacherCache[key],
        setCacheEntry: (key, value) => {
          if (!page._teacherCache) page._teacherCache = Object.create(null)
          page._teacherCache[key] = value
        },
        getInflight: key => {
          if (!page._teacherInflight) page._teacherInflight = Object.create(null)
          return page._teacherInflight[key]
        },
        setInflight: (key, promise) => {
          if (!page._teacherInflight) page._teacherInflight = Object.create(null)
          page._teacherInflight[key] = promise
        },
        deleteInflight: key => { delete page._teacherInflight[key] },
        nextRequestSequence: () => ++page._teacherRequestSeq,
        getRequestSequence: () => page._teacherRequestSeq,
        isAlive: () => page._alive,
        postTeacher: payload => {
          const sequence = page._teacherRequestSeq
          const wrongId = (page.data.wq || {}).id
          return requestTeacher(api, payload, {
            timeout: AI_REQUEST_TIMEOUT_MS,
            isCurrent: () => page._alive && !page._aiAvailabilityPaused &&
              page._teacherRequestSeq === sequence && (page.data.wq || {}).id === wrongId,
          })
        },
        normalizeResult: raw => aiTeacher408.normalizeResult(raw),
        presentResult: normalized => presentTeacherResult(normalized),
        errorMessage: error => aiTeacher408.errorMessage(error, api),
        getAvailabilityFromError: error => page._availabilityFromAiError(error),
        applyAvailability: state => page._applyAiAvailability(state),
      }
}

module.exports = { buildTeacherActionPageCapabilities }
