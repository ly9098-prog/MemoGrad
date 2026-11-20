const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const imageRelativePath = 'assets/images/home/hero-brush-texture.jpg'

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('home hero texture uses a local JPEG supported by the image component on real devices', () => {
  const markup = read('pages/home/home.wxml')
  const imagePath = path.join(root, imageRelativePath)
  const header = fs.readFileSync(imagePath).subarray(0, 3)

  assert.match(markup, new RegExp(`<image[^>]+class="focus-card-texture"[^>]+src="/${imageRelativePath}"`))
  assert.doesNotMatch(markup, /hero-brush-texture\.webp/)
  assert.deepEqual([...header], [0xff, 0xd8, 0xff], 'hero texture must be a baseline JPEG')
  assert.ok(fs.statSync(imagePath).size < 150 * 1024, 'hero texture must stay small enough for the main package')
})
