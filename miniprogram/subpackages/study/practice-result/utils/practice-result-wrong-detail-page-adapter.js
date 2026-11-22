// Recover missing result-cache identities using the owned wrong-book lookup.
async function openResultWrongDetail(page, { api }, target) {
  if (page._guestMode || page._navigationLocked || page._wrongDetailLookup) return
  const questionId = Number(target && target.questionId)
  const knownId = Number(target && target.wrongQuestionId)
  if (Number.isInteger(knownId) && knownId > 0) return page.navigateToWrongDetail(knownId)
  if (!Number.isInteger(questionId) || questionId <= 0) return
  const payload = page._sessionPayload
  const visibleSequence = page._diagnosisRefreshSeq
  const isCurrent = () => page._pageAlive && page._resultVisible &&
    page._sessionPayload === payload && page._diagnosisRefreshSeq === visibleSequence
  page._wrongDetailLookup = true
  try {
    const result = await api.get(`/wrong-questions/by-question/${questionId}`, {}, {
      timeout: 10000, suppressNetworkToast: true,
    })
    if (!isCurrent()) return
    const id = Number(result && result.wrong_question_id)
    if (Number(result && result.question_id) !== questionId) throw new Error('Mismatched question')
    if (!Number.isInteger(id) || id <= 0) {
      wx.showToast({ title: '该题暂无错题详情', icon: 'none' })
      return
    }
    const update = list => (list || []).map(item => Number(item.questionId) === questionId
      ? { ...item, wrongQuestionId: id } : item)
    const wrongReviewItems = update(page.data.wrongReviewItems)
    page.setData({
      reviewItems: update(page.data.reviewItems),
      filteredReviewItems: update(page.data.filteredReviewItems),
      wrongReviewItems,
      batchSelectableCount: wrongReviewItems.filter(item => Number(item.wrongQuestionId) > 0).length,
    })
    page.navigateToWrongDetail(id)
  } catch (_) {
    if (isCurrent()) wx.showToast({ title: '错题详情加载失败，请重试', icon: 'none' })
  } finally {
    page._wrongDetailLookup = false
  }
}

module.exports = { openResultWrongDetail }
