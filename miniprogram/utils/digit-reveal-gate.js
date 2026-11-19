// A reveal is armed by a rendered data commit, then released only on a ready,
// visible page and inside the viewport. No delay is measured from request start.
function visible(page) {
  return page._alive && (page._isVisible === undefined ? page._visible : page._isVisible)
}

function jobs(page) {
  if (!page._digitRevealJobs) page._digitRevealJobs = new Map()
  return page._digitRevealJobs
}

function cancel(page, key) {
  const pending = jobs(page).get(key)
  if (pending && pending.observer) pending.observer.disconnect()
  jobs(page).delete(key)
}

function watch(page, key, job) {
  if (!page._digitRevealReady || !visible(page) || job.observer) return
  const platform = typeof wx === 'undefined' ? {} : wx
  const nextTick = platform.nextTick || (callback => setTimeout(callback, 0))
  const generation = job.generation
  nextTick(() => {
    if (jobs(page).get(key) !== job || generation !== job.generation || !visible(page) || job.observer) return
    const release = () => {
      if (jobs(page).get(key) !== job || generation !== job.generation || !visible(page)) return
      if (job.canStart && !job.canStart()) return
      cancel(page, key)
      job.start()
    }
    const create = page.createIntersectionObserver
      ? () => page.createIntersectionObserver({ thresholds: [0], initialRatio: 0 })
      : platform.createIntersectionObserver
        ? () => platform.createIntersectionObserver(page, { thresholds: [0], initialRatio: 0 })
        : null
    // Older runtimes still wait for ready + the rendered setData callback.
    if (!create) return release()
    job.observer = create()
    job.observer.relativeToViewport().observe(job.selector, entry => {
      if (entry.intersectionRatio > 0) release()
    })
  })
}

function arm(page, key, selector, start, canStart) {
  cancel(page, key)
  const job = { selector, start, canStart, observer: null, generation: 0 }
  jobs(page).set(key, job)
  watch(page, key, job)
}

function resume(page, ready = false) {
  if (ready) page._digitRevealReady = true
  jobs(page).forEach((job, key) => watch(page, key, job))
}

function suspend(page) {
  jobs(page).forEach(job => {
    job.generation += 1
    if (job.observer) job.observer.disconnect()
    job.observer = null
  })
}

function clear(page) {
  suspend(page)
  jobs(page).clear()
}

module.exports = { arm, cancel, resume, suspend, clear }
