const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const shared = 'styles/motion-sheet-panel.wxss'

function templates(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = path.posix.join(directory, entry.name)
    return entry.isDirectory() ? templates(file) : file.endsWith('.wxml') ? [file] : []
  })
}

// Discover consumers instead of freezing a list: new drawers must obey the same
// contract, including consumers in isolated component style scopes.
function sheetHosts() {
  return ['pages', 'subpackages', 'components'].flatMap(templates).flatMap(file => {
    const markup = read(file).replace(/<!--[\s\S]*?-->/g, '')
    return [...markup.matchAll(/<motion-sheet\b[^>]*>([\s\S]*?)<\/motion-sheet>/g)]
      .map((match, index) => ({ file, index, markup: match[0], content: match[1] }))
  })
}

function styleImports(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const match of read(file).matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))
    styleImports(dependency, seen)
  }
  return seen
}

test('every drawer slot root uses the shared layout-only contract', () => {
  const hosts = sheetHosts()
  assert.ok(hosts.length > 0)
  for (const host of hosts) {
    const opening = host.content.trim().match(/^<view\b[^>]*>/)
    assert.ok(opening, `${host.file} #${host.index}: drawer needs one view root`)
    assert.match(opening[0], /class="[^"]*\bmotion-sheet-panel\b/,
      `${host.file} #${host.index}: do not add an independently painted slot root`)
    const inline = opening[0].match(/\sstyle="([^"]*)"/)
    assert.doesNotMatch(inline ? inline[1] : '', /(?:background|border|box-shadow|backdrop-filter)\s*:/,
      `${host.file} #${host.index}: configure the surface on motion-sheet instead`)
    assert.equal((host.markup.match(/<motion-sheet\b/g) || []).length, 1,
      `${host.file}: drawers must not be nested in another drawer's slot`)
  }
})

test('page and isolated component consumers both load the same surface guard', () => {
  const globalImports = styleImports('app.wxss')
  assert.ok(globalImports.has(shared), 'page slots inherit the guard from app.wxss')
  for (const file of new Set(sheetHosts().map(host => host.file))) {
    const config = JSON.parse(read(file.replace(/\.wxml$/, '.json')))
    if (!config.component) continue
    assert.ok(styleImports(file.replace(/\.wxml$/, '.wxss')).has(shared),
      `${file}: component isolation requires a local import; app.wxss is insufficient`)
  }
})

test('legacy page themes cannot paint a second background, outline, blur or shadow', () => {
  const css = read(shared).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  assert.equal(rules.length, 1, 'the guard applies only to the slot root, never its children')
  assert.equal(rules[0][1].trim(), '.motion-sheet-panel.motion-sheet-panel')
  for (const [property, value] of Object.entries({
    background: 'transparent', border: '0', 'border-radius': '0',
    'box-shadow': 'none', 'backdrop-filter': 'none', '-webkit-backdrop-filter': 'none',
  })) {
    assert.match(rules[0][2], new RegExp(`(?:^|;)\\s*${property}:\\s*${value}\\s*!important\\s*;`),
      `${property} must survive later and more specific legacy theme declarations`)
  }
})

test('surface paint stays outside the untransformed rich-text and scroll body', () => {
  const markup = read('components/motion-sheet/index.wxml')
  assert.equal((markup.match(/class="motion-sheet-surface"/g) || []).length, 1)
  assert.match(markup, /class="motion-sheet-surface"[^>]*style="background:\{\{background\}\}"/)
  assert.match(markup, /class="motion-sheet-body" bind:readerresize="onReaderResize"><slot\s*\/>/)
  const css = read('components/motion-sheet/index.wxss')
  assert.match(css, /\.motion-sheet-grip\s*\{[^}]*display:\s*flex/,
    'the grip must contain its button negative margin instead of collapsing it into the body origin')
  assert.match(css, /\.motion-sheet-surface\s*\{[^}]*box-shadow:/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.motion-sheet-body\s*\{\s*clip-path:\s*none\s*!important/,
    'reduced-motion keeps its stationary body aligned with the stationary surface')
  for (const name of ['content', 'body']) {
    const rule = css.match(new RegExp(`\\.motion-sheet-${name}\\s*\\{([^}]*)\\}`))
    assert.ok(rule)
    assert.doesNotMatch(rule[1], /(?:background|box-shadow|transform|overflow)\s*:/,
      'fade-mode math ancestors must not introduce paint, transforms or clipping')
  }
})

test('result review and AI teacher share a single reader surface', () => {
  const file = 'subpackages/study/practice-result/index.wxml'
  const hosts = sheetHosts().filter(host => host.file === file)
  assert.equal(hosts.length, 1, 'half-collapsing AI must never expose a second review sheet')
  assert.match(hosts[0].markup, /reviewDialogVisible \|\| \(!guestMode && teacherSheetVisible\)/)
  assert.match(hosts[0].content, /class="result-reader-sheet/)
})

test('paired drawer actions allow both native buttons to shrink inside the sheet', () => {
  const pairs = [
    ['subpackages/formulas/library/index.wxss', 'fl-filter-footer'],
    ['subpackages/study/review-today/review-today.wxss', 'decision-actions'],
    ['subpackages/study/wrong-detail/wrong-detail.wxss', 'decision-actions'],
    ['subpackages/study/practice-result/index.wxss', 'review-dialog-footer-ai'],
  ]
  for (const [file, selector] of pairs) {
    const rules = [...read(file).matchAll(new RegExp('\\.' + selector + '\\s*\\{([^}]*)\\}', 'g'))]
    assert.ok(rules.length > 0, `${file}: missing ${selector}`)
    assert.match(rules.at(-1)[1], /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
      `${file}: ${selector} must cap both tracks to the available width`)
  }
})

test('learning report subject tiles and AI teacher actions keep visible gutters', () => {
  const dashboardSheets = sheetHosts().filter(host =>
    host.file === 'pages/dashboard/dashboard.wxml' && /label="选择学科"/.test(host.markup))
  assert.equal(dashboardSheets.length, 1)
  assert.doesNotMatch(dashboardSheets[0].content, /mini-choice-selection-mark/)
  assert.match(dashboardSheets[0].content, /<view wx:for="\{\{knowledgeDiagnosisSubjects\}\}"/)
  const dashboardStyles = read('pages/dashboard/dashboard.wxss')
  assert.match(dashboardStyles, /\.knowledge-subject-grid\s*\{[^}]*gap:\s*20rpx/)
  assert.match(dashboardStyles,
    /\.knowledge-subject-grid \.knowledge-subject-tile\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;/)

  const teacherStyles = read('subpackages/study/practice-result/index.wxss')
  const footer = teacherStyles.match(/\.teacher-sheet-footer\s*\{([^}]*)\}/)
  assert.ok(footer)
  assert.match(footer[1], /gap:\s*32rpx/)
  assert.doesNotMatch(teacherStyles, /\.teacher-sheet-footer \.mini-choice-sheet-action-primary\s*\{[^}]*margin-left:\s*24rpx/)
  assert.match(teacherStyles,
    /\.teacher-action-panel \.mini-choice-option\s*\{[^}]*calc\(50% - 14rpx\)[^}]*margin:\s*0 0 24rpx;/)
})
