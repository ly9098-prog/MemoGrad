const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert')

const miniprogramRoot = path.resolve(__dirname, '..')

function read(...segments) {
  return fs.readFileSync(path.join(miniprogramRoot, ...segments), 'utf8')
}

test('route transition styles provide classified enter animations', () => {
  const styles = read('styles', 'route-transition.wxss')

  assert.match(styles, /\.route-enter-page\s*\{[^}]+animation:\s*route-content-enter-page 250ms[^;]+backwards/)
  assert.match(styles, /\.route-enter-detail\s*\{[^}]+animation:\s*route-content-enter-detail 240ms[^;]+backwards/)
  assert.match(styles, /\.route-enter-task\s*\{[^}]+animation:\s*route-content-enter-task 180ms[^;]+backwards/)
  assert.match(styles, /\.route-enter-opacity\s*\{[^}]+animation:\s*route-content-enter 160ms[^;]+backwards/)
  assert.match(styles, /cubic-bezier\(\.16, 1, \.3, 1\)/)
})

test('route transition styles remain reduced-motion and canvas safe', () => {
  const styles = read('styles', 'route-transition.wxss')
  const reducedMotion = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\n\}/)

  assert.ok(reducedMotion)
  for (const className of ['.route-enter', '.route-enter-page', '.route-enter-detail', '.route-enter-task', '.route-enter-opacity']) {
    assert.ok(reducedMotion[0].includes(className))
  }
  assert.ok(styles.includes('.route-enter-opacity'))
  const opacityBlock = styles.match(/\.route-enter-opacity\s*\{[^}]+\}/)
  assert.doesNotMatch(opacityBlock[0], /transform/)
})

test('first batch pages use transition classes without return replay', () => {
  assert.ok(read('subpackages', 'formulas', 'library', 'index.wxml').includes('route-enter-page'))
  assert.ok(read('subpackages', 'exam', 'paper-list', 'index.wxml').includes('route-enter-page'))
  assert.ok(read('subpackages', 'exam', 'history', 'index.wxml').includes('route-enter-page'))
  assert.ok(read('subpackages', 'exam', 'result', 'index.wxml').includes('route-enter-opacity'))
  assert.ok(read('subpackages', 'study', 'study-plan', 'index.wxml').includes('route-enter-opacity'))
})

test('formula reader keeps native rich-text on opacity-only layers without return replay', () => {
  const markup = read('subpackages', 'formulas', 'reader', 'index.wxml')
  const styles = read('subpackages', 'formulas', 'reader', 'index.wxss')
  const source = read('subpackages', 'formulas', 'reader', 'index.js')
  assert.doesNotMatch(markup, /route-enter(?:-(?:page|detail|task|opacity))?\b/,
    'reader ancestors must not replay route animations or translate native rich-text')
  assert.match(markup, /fr-transition-stage \{\{transitionClass\}\}/)
  assert.match(styles, /\.fr-transition-stage\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none\s*!important;[^}]*transition:\s*opacity\s+[^;]+;/)
  assert.match(styles, /\.fr-slide-out-left,\s*\.fr-slide-out-right,\s*\.fr-slide-in-left,\s*\.fr-slide-in-right\s*\{\s*opacity:\s*0;\s*\}/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.fr-transition-stage,[\s\S]*transition:\s*none\s*!important;/)

  let definition
  require('node:vm').runInNewContext(source, {
    require: () => ({}), Page: value => { definition = value }, console,
  })
  const writes = []
  const reader = Object.assign({}, definition, {
    data: { ...definition.data, loading: false, currentCard: { id: 1 } },
    readerSessionValid: () => true,
    setData(patch) { writes.push(patch); Object.assign(this.data, patch) },
  })
  const currentCard = reader.data.currentCard
  reader.onShow()
  reader.onShow()
  assert.deepStrictEqual(writes, [], 'returning with the same session does not replay entrance or loading')
  assert.strictEqual(reader.data.currentCard, currentCard)
})

test('remaining pages use a single classified transition system', () => {
  const cases = {
    'pages/home/home.wxml': ['route-enter-page'],
    'pages/login/login.wxml': ['route-enter-page'],
    'pages/dashboard/dashboard.wxml': ['route-enter-opacity'],
    'pages/agreement/agreement-document.wxml': ['route-enter-page'],
    'subpackages/animation/animation-index/animation-index.wxml': ['route-enter-opacity'],
    'subpackages/export/export-config/export-config.wxml': ['route-enter-page'],
    'subpackages/export/export-records/export-records.wxml': ['route-enter-page'],
    'subpackages/knowledge/knowledge-detail/index.wxml': ['route-enter-opacity'],
    'subpackages/productivity/pomodoro-stats/index.wxml': ['route-enter-opacity'],
    'subpackages/study/practice/practice.wxml': ['route-enter-task'],
    'subpackages/study/wrong-book/wrong-book.wxml': ['route-enter-opacity'],
    'subpackages/study/wrong-detail/wrong-detail.wxml': ['route-enter-opacity'],
    'subpackages/study/review-today/review-today.wxml': ['route-enter-task'],
    'subpackages/study/practice-result/index.wxml': ['route-enter-page'],
    'subpackages/exam/exam-runner/index.wxml': ['route-enter-opacity'],
  }

  for (const [file, expected] of Object.entries(cases)) {
    const source = read(...file.split('/'))
    for (const className of expected) assert.ok(source.includes(className), `${file} should use ${className}`)
  }
})

test('agreement pages share one versioned reading surface', () => {
  for (const page of ['user', 'privacy', 'ai']) {
    assert.match(
      read('pages', 'agreement', `${page}.wxml`),
      /<include src="\.\/agreement-document\.wxml" \/>/,
      `${page} agreement page must use the shared document template`,
    )
  }

  const content = require(path.join(miniprogramRoot, 'pages', 'agreement', 'agreement-content.js'))
  const config = require(path.join(miniprogramRoot, 'config.js'))
  for (const key of ['user', 'privacy', 'ai']) {
    assert.equal(content.PAGE_CONTENT[key].version,
      key === 'privacy' ? config.PRIVACY_POLICY_VERSION : config.AGREEMENT_VERSION)
    assert.ok(content.PAGE_CONTENT[key].title)
    assert.ok(content.PAGE_CONTENT[key].intro)
    assert.ok(content.PAGE_CONTENT[key].summary.length >= 3)
    assert.ok(content.PAGE_CONTENT[key].sections.length >= 5)
    assert.ok(content.PAGE_CONTENT[key].sections.every(section =>
      Array.isArray(section.paragraphs) && Array.isArray(section.bullets)))
  }
})

test('privacy policy discloses optional profile uploads and their use', () => {
  const { PAGE_CONTENT } = require(path.join(miniprogramRoot, 'pages', 'agreement', 'agreement-content.js'))
  const collection = PAGE_CONTENT.privacy.sections.find(section => section.title === '收集的信息与用途')
  assert.ok(collection)
  assert.ok(collection.bullets.some(bullet =>
    /昵称/.test(bullet) && /头像/.test(bullet) && /可选/.test(bullet) && /上传/.test(bullet)))
})

test('canvas and legacy reveal pages retain local opacity-safe entrances', () => {
  const pomodoroStyles = read('pages', 'pomodoro', 'pomodoro.wxss')
  const knowledgeStyles = read('subpackages', 'knowledge', 'knowledge-subject', 'index.wxss')
  assert.match(pomodoroStyles, /animation-entrance[\s\S]*opacity:\s*0;[\s\S]*@keyframes page-enter[\s\S]*to\s*\{\s*opacity:\s*1;/)
  assert.match(knowledgeStyles, /\.page-reveal\{opacity: 0;transform: translate3d\(0,18rpx,0\);\}/)
  assert.match(knowledgeStyles, /@media \(prefers-reduced-motion: reduce\)\{\.page-reveal,\.page-entered \.page-reveal\{opacity: 1;transform: none;transition: none;/)
})

test('legacy page-enter definitions are removed after migration', () => {
  const files = [
    'pages/home/home.wxss',
    'pages/login/login.wxss',
    'pages/agreement/user.wxss',
  ]
  for (const file of files) {
    const source = read(...file.split('/'))
    assert.doesNotMatch(source, /\.page-enter|@keyframes pageEnter/)
  }
  assert.doesNotMatch(read('pages', 'agreement', 'user.wxss'), /\.wechat-login-btn/)
})

test('study plan refreshes silently on return without toggling route enter', () => {
  const page = read('subpackages', 'study', 'study-plan', 'index.js')
  assert.match(page, /onShow\(\) \{[\s\S]*if \(this\._loadedOnce\) this\.loadOverview\(\{ silent: true \}\)/)
  assert.match(page, /async loadOverview\(options = \{\}\) \{[\s\S]*const silent = options\.silent === true/)
})

test('wrong book enters once and does not replay after an empty refresh', () => {
  const markup = read('subpackages', 'study', 'wrong-book', 'wrong-book.wxml')
  const page = read('subpackages', 'study', 'wrong-book', 'wrong-book.js')
  const lifecycle = read('subpackages', 'study', 'wrong-book', 'utils', 'wrong-book-lifecycle.js')
  const requestFlow = read('subpackages', 'study', 'wrong-book', 'utils', 'wrong-book-request-flow.js')

  assert.match(markup, /\{\{contentEntered \? 'route-enter-opacity' : ''\}\}/)
  assert.doesNotMatch(page, /contentEntered/)
  assert.match(lifecycle, /contentEntered: false/)
  assert.match(lifecycle, /contentEntered: true/)
  assert.match(requestFlow, /loading: false,\s*contentEntered: true,\s*\}\)/)
})
