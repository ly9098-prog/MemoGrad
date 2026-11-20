const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('shared choice-sheet visual contract matches the review batch-size drawer', () => {
  const css = read('styles/choice-grid-sheet.wxss')

  assert.match(css, /\.mini-choice-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /\.mini-choice-grid\s*\{[^}]*gap:\s*16rpx/)
  assert.match(css, /\.mini-choice-option\s*\{[^}]*min-height:\s*128rpx/)
  assert.match(css, /\.mini-choice-option\s*\{[^}]*border-radius:\s*24rpx/)
  assert.match(css, /\.mini-choice-option\.is-selected\s*\{[^}]*border-color:\s*#55C89B;[^}]*background:\s*#EAF9F4/)
  assert.match(css, /\.mini-choice-sheet-action\s*\{[^}]*min-height:\s*88rpx/)
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/)
})

test('every four-grid selection drawer uses the shared visual layer and current SVG marks', () => {
  const targets = [
    {
      markup: 'subpackages/study/practice/practice.wxml',
      styles: 'subpackages/study/practice/practice.wxss',
      event: 'chooseChildSubject',
    },
    {
      markup: 'pages/dashboard/dashboard.wxml',
      styles: 'pages/dashboard/dashboard.wxss',
      event: 'selectKnowledgeDiagnosisSubject',
    },
    {
      markup: 'subpackages/formulas/library/index.wxml',
      styles: 'subpackages/formulas/library/index.wxss',
      event: 'onTagSelect',
    },
    {
      markup: 'subpackages/study/wrong-detail/wrong-detail.wxml',
      styles: 'subpackages/study/wrong-detail/wrong-detail.wxss',
      event: 'selectDiagnosisPrimary',
    },
  ]

  for (const target of targets) {
    const markup = read(target.markup)
    const styles = read(target.styles)

    assert.match(styles, /@import\s+['"][^'"]*styles\/choice-grid-sheet\.wxss['"]/, target.markup)
    assert.match(markup, /mini-choice-grid/, target.markup)
    assert.match(markup, /mini-choice-option/, target.markup)
    assert.match(markup, new RegExp(target.event), `${target.markup} preserves its selection handler`)
  }

  const dashboard = read('pages/dashboard/dashboard.wxml')
  assert.doesNotMatch(dashboard, /line-icon icon-close/, 'close icons use sourced SVG assets')
  assert.match(dashboard, /mobile-controls\/x\.svg/)
})

test('practice subject picker keeps circular horizontal swiping and stable action wiring', () => {
  const markup = read('subpackages/study/practice/practice.wxml')

  assert.match(markup, /<swiper[^>]*current="\{\{subjectSheetCurrent\}\}"/)
  assert.match(markup, /circular="\{\{subjectSheetPages\.length > 1\}\}"/)
  assert.match(markup, /autoplay="\{\{false\}\}"/)
  assert.match(markup, /display-multiple-items="1"/)
  assert.match(markup, /bindchange="toggleParentExpansion"/)
  assert.match(markup, /catchtap="chooseChildSubject"[^>]*data-action="confirm">确定选择/)
})

test('wrong-detail diagnosis keeps two columns even on narrow phones', () => {
  const css = read('subpackages/study/wrong-detail/wrong-detail.wxss')
  const matches = [...css.matchAll(/@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.diagnosis-sheet-shell \.diagnosis-option-grid\s*\{([^}]*)\}/g)]

  assert.ok(matches.length, 'the responsive diagnosis override exists')
  assert.match(matches.at(-1)[1], /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
})
