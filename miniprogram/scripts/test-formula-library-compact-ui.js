const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'subpackages/formulas/library/index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'subpackages/formulas/library/index.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'subpackages/formulas/library/index.js'), 'utf8')

assert(wxml.includes('class="fl-sticky-tools"'), 'subject and content type toolbar should be sticky')
assert(wxml.includes('bindtap="toggleSubjectPicker"'), 'subject dropdown should open a picker')
assert(wxml.includes('bindtap="toggleMoreSheet"'), 'more button should open a bottom sheet')
assert(wxml.includes('搜索函数图像名称或关键词'), 'full-width graph search should remain visible')
assert(wxml.includes('bindtap="toggleFavoritesOnly"') && wxml.includes('bindtap="goToRandom"'), 'favorite and random actions remain available in the current controls')
assert(wxml.includes('<motion-sheet show="{{showSubjectPicker}}"'), 'subject drawer remains mounted through its automatic exit')
assert(wxml.includes('<motion-sheet show="{{showMoreSheet}}"'), 'filter drawer remains mounted through its automatic exit')
assert(!wxml.includes('FORMULA LIBRARY'), 'large English intro should be removed')
assert(!wxml.includes('class="fl-subject-switch"'), 'old full-width subject tabs should be removed')
assert(!wxml.includes('fl-quick-desc'), 'large quick-action descriptions should be removed')

assert(wxss.includes('position: sticky'), 'sticky toolbar style should be present')
assert(wxss.includes('.fl-bottom-sheet'), 'bottom sheet style should be present')
assert(wxss.includes('.fl-random-action'), 'current random action style should be present')

for (const method of [
  'measureNavigation()',
  'toggleSubjectPicker()',
  'toggleMoreSheet()',
  'openTagPickerFromMore()',
  'resetFilters()',
]) {
  assert(js.includes(method), `missing page method: ${method}`)
}

console.log('formula library compact UI regression checks passed')
