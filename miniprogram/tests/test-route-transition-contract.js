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

  assert.match(styles, /\.route-enter-page\s*\{[^}]+animation:\s*route-content-enter-page 250ms/)
  assert.match(styles, /\.route-enter-detail\s*\{[^}]+animation:\s*route-content-enter-detail 240ms/)
  assert.match(styles, /\.route-enter-task\s*\{[^}]+animation:\s*route-content-enter-task 180ms/)
  assert.match(styles, /\.route-enter-opacity\s*\{[^}]+animation:\s*route-content-enter 160ms/)
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
  assert.ok(read('subpackages', 'formulas', 'reader', 'index.wxml').includes('route-enter-detail'))
  assert.ok(read('subpackages', 'exam', 'paper-list', 'index.wxml').includes('route-enter-page'))
  assert.ok(read('subpackages', 'exam', 'history', 'index.wxml').includes('route-enter-page'))
  assert.ok(read('subpackages', 'exam', 'result', 'index.wxml').includes('route-enter-opacity'))
  assert.ok(read('subpackages', 'study', 'study-plan', 'index.wxml').includes('route-enter-page'))
})

test('remaining pages use a single classified transition system', () => {
  const cases = {
    'pages/home/home.wxml': ['route-enter-page'],
    'pages/login/login.wxml': ['route-enter-page'],
    'pages/dashboard/dashboard.wxml': ['route-enter-opacity'],
    'pages/agreement/user.wxml': ['route-enter-page'],
    'pages/agreement/privacy.wxml': ['route-enter-page'],
    'pages/agreement/ai.wxml': ['route-enter-page'],
    'subpackages/animation/animation-index/animation-index.wxml': ['route-enter-opacity'],
    'subpackages/export/export-config/export-config.wxml': ['route-enter-page'],
    'subpackages/export/export-records/export-records.wxml': ['route-enter-page'],
    'subpackages/knowledge/knowledge-detail/index.wxml': ['route-enter-opacity'],
    'subpackages/productivity/pomodoro-stats/index.wxml': ['route-enter-opacity'],
    'subpackages/study/practice/practice.wxml': ['route-enter-task'],
    'subpackages/study/wrong-book/wrong-book.wxml': ['route-enter-page'],
    'subpackages/study/wrong-detail/wrong-detail.wxml': ['route-enter-detail'],
    'subpackages/study/review-today/review-today.wxml': ['route-enter-task'],
    'subpackages/study/practice-result/index.wxml': ['route-enter-page'],
    'subpackages/exam/exam-runner/index.wxml': ['route-enter-task'],
  }

  for (const [file, expected] of Object.entries(cases)) {
    const source = read(...file.split('/'))
    for (const className of expected) assert.ok(source.includes(className), `${file} should use ${className}`)
  }
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
})

test('study plan refreshes silently on return without toggling route enter', () => {
  const page = read('subpackages', 'study', 'study-plan', 'index.js')
  assert.match(page, /onShow\(\) \{[\s\S]*if \(this\._loadedOnce\) this\.loadOverview\(\{ silent: true \}\)/)
  assert.match(page, /async loadOverview\(options = \{\}\) \{[\s\S]*const silent = options\.silent === true/)
})
