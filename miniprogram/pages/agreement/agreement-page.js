const { getNavigationMetrics } = require('../../utils/navigation')
const { PAGE_CONTENT } = require('./agreement-content')

function createAgreementPage(pageKey) {
  const content = PAGE_CONTENT[pageKey]
  if (!content) throw new Error(`Unknown agreement page: ${pageKey}`)
  const updatedLabel = content.version.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1 年 $2 月 $3 日')

  return {
    data: {
      navHeight: 88,
      statusBarHeight: 20,
      navContentHeight: 44,
      navRightPadding: 116,
      pageKey,
      title: content.title,
      intro: content.intro,
      summary: content.summary,
      sections: content.sections,
      versionLabel: `版本 ${content.version}`,
      updatedLabel: `最后更新 ${updatedLabel}`,
    },

    onLoad() {
      this.setData(getNavigationMetrics())
    },

    goBack() {
      const pages = getCurrentPages()
      if (pages && pages.length > 1) {
        wx.navigateBack({ delta: 1 })
        return
      }
      wx.reLaunch({ url: '/pages/login/login' })
    },
  }
}

module.exports = {
  createAgreementPage,
}
