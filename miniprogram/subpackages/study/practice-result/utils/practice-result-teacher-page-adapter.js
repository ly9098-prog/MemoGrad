// Page capability assembly for miniprogram/subpackages/study/practice-result/index.js.
// Assemble live page ports here; the page keeps lazy controller memoisation.

const aiTeacher408 = require('../../utils/ai-teacher-408')
const { requestTeacher } = require('../../../../utils/ai-teacher-request')

function buildReview408TeacherPageCapabilities(page, deps) {
  const { api } = deps
  return {
    getTeacherLoading: () => page.data.teacherLoading,
    getReviewDialog: () => page.data.reviewDialog,
    setData: patch => page.setData(patch),
    buildCacheKey: (dialog, action) => page._teacherCacheKey(dialog, action),
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
    isPageAlive: () => page._pageAlive,
    postTeacher: payload => {
      const sequence = page._teacherRequestSeq
      return requestTeacher(api, payload, {
        isCurrent: () => page._pageAlive && page._resultVisible && page._teacherRequestSeq === sequence &&
          Number((page.data.reviewDialog || {}).questionId) === Number(payload.question_id),
      })
    },
    normalizeResult: raw => aiTeacher408.normalizeResult(raw),
    errorMessage: error => aiTeacher408.errorMessage(error, api),
  }
}

module.exports = {
  buildReview408TeacherPageCapabilities,
}
