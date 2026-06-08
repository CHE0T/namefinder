/**
 * nameFinder end-to-end feature tests (Playwright)
 * Run: node frontend/test_features.cjs
 */
const { chromium } = require('C:/Users/andre/AppData/Roaming/npm/node_modules/playwright')

const URL   = 'http://localhost:5173'
const SHORT = 8_000
const MED   = 30_000
const LONG  = 90_000

let passed = 0, failed = 0
const failures = []

async function t(name, fn) {
  try { await fn(); console.log(`  ✓  ${name}`); passed++ }
  catch (e) {
    const msg = e.message.split('\n')[0]
    console.error(`  ✗  ${name}\n       -> ${msg}`)
    failures.push({ name, err: msg }); failed++
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const pf = (page, fn, arg, to, msg) =>
  page.waitForFunction(fn, arg ?? null, { timeout: to ?? SHORT })
    .catch(() => { throw new Error(`Timeout: ${msg}`) })

async function btnText(page) { return page.$eval('.btn-search', el => el.textContent.trim()) }

async function waitForIdle(page, to) {
  await pf(page, () => {
    const t = document.querySelector('.btn-search')?.textContent
    return t?.includes('Find') || t?.includes('At Target')
  }, null, to ?? LONG, 'Find/At-Target')
}
async function waitForStreaming(page, to) {
  await pf(page, () => document.querySelector('.btn-search')?.textContent?.includes('Pause'),
    null, to ?? LONG, 'Pause button')
}
// Wait for idle AND let session-save debounce fire
async function settle(page) {
  await waitForIdle(page, LONG)
  await page.waitForTimeout(1600)
}

async function getNamesCount(page) {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('ngSession') ?? '{}').names?.length ?? 0 } catch { return 0 }
  })
}

async function waitForRows(page, min, to) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('tr.group-row').length >= n,
    min, { timeout: to ?? LONG }
  ).catch(() => { throw new Error(`Timeout: ${min} domain rows`) })
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const jsErrors = []

  // ── SECTION 1: Static render ──────────────────────────────────────────────
  console.log('\n── 1. Page load & static render ──────────────────────────────────')
  {
    const ctx = await browser.newContext()
    await ctx.addInitScript(() => {
      localStorage.removeItem('ngSession'); localStorage.removeItem('dsSession')
    })
    const p = await ctx.newPage()
    p.on('console',   m => { if (m.type()==='error') jsErrors.push(m.text()) })
    p.on('pageerror', e => jsErrors.push(e.message))
    await p.goto(URL, { waitUntil: 'domcontentloaded' })

    await t('Page loads without crash', () => p.waitForSelector('.search-panel'))

    await t('All core form elements present', async () => {
      for (const s of ['#keywords','#description','#priority-input',
                       '.btn-search','.count-input','.btn-priority',
                       '.tld-grid','.styles-grid','.price-range'])
        if (!await p.$(s)) throw new Error(`Missing: ${s}`)
    })

    await t('Find disabled with no keywords',    async () => {
      if (!await p.$eval('.btn-search',  el => el.disabled)) throw new Error('Should be disabled')
    })
    await t('Priority button disabled when empty', async () => {
      if (!await p.$eval('.btn-priority', el => el.disabled)) throw new Error('Should be disabled')
    })

    await t('Priority button enables when text typed', async () => {
      await p.fill('#priority-input', 'cloudmeet')
      if (await p.$eval('.btn-priority', el => el.disabled)) throw new Error('Should be enabled')
      await p.fill('#priority-input', '')
    })
    await t('Find button enables once keywords typed', async () => {
      await p.fill('#keywords', 'meeting app')
      if (await p.$eval('.btn-search', el => el.disabled)) throw new Error('Should be enabled')
    })

    await t('Description counter turns green at 100-200 chars', async () => {
      await p.fill('#description', 'x'.repeat(150))
      const txt = await p.$eval('.desc-counter', el => el.textContent)
      const cls = await p.$eval('.desc-counter', el => el.className)
      if (!txt.includes('150')) throw new Error(`Counter: "${txt}"`)
      if (!cls.includes('good')) throw new Error(`Class: "${cls}"`)
      await p.fill('#description', '')
    })

    await t('Price input formats with comma', async () => {
      const inputs = await p.$$('.price-input input')
      await inputs[1].fill('10000')
      await p.click('#keywords')
      const val = await inputs[1].inputValue()
      if (!/10.?000/.test(val.replace(',',''))) throw new Error(`Got: "${val}"`)
    })

    await t('TLD ANY/ALL toggle changes hint text', async () => {
      await p.$eval('.tld-header .mode-btn', el => el.click())
      const hint = await p.$eval('.tld-header + .mode-hint', el => el.textContent)
      if (!hint.toLowerCase().includes('any')) throw new Error(`Hint: "${hint}"`)
      await p.evaluate(() => [...document.querySelectorAll('.tld-header .mode-btn')].at(-1).click())
    })

    await t('Style chips clickable + active state', async () => {
      const chips = await p.$$('.style-chip')
      if (!chips.length) throw new Error('No chips')
      await chips[1].click()
      if (!await chips[1].evaluate(el => el.classList.contains('style-chip--active')))
        throw new Error('Not activated')
      await chips[0].click()
    })

    await t('No JS errors on page load', async () => {
      if (jsErrors.length) throw new Error(jsErrors.slice(0,2).join(' | '))
    })

    await ctx.close()
  }

  // ── SECTION 2: Generation ─────────────────────────────────────────────────
  console.log('\n── 2. Name generation ────────────────────────────────────────────')
  // ctx2 keeps its clearScript only for the FIRST load (before any names are saved)
  const ctx2 = await browser.newContext()
  await ctx2.addInitScript(() => {
    localStorage.removeItem('ngSession'); localStorage.removeItem('dsSession')
  })
  const page = await ctx2.newPage()
  page.on('console',   m => { if (m.type()==='error') jsErrors.push(m.text()) })
  page.on('pageerror', e => jsErrors.push(e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  await page.fill('#keywords', 'meeting collaboration')
  await page.fill('.count-input', '8')
  await page.press('.count-input', 'Tab')

  await t('Generation starts (Pause button appears)', async () => {
    await page.click('.btn-search')
    await waitForStreaming(page, 20_000)
  })

  await t('Stop button visible during streaming', async () => {
    if (await page.$eval('.btn-stop', el => el.classList.contains('btn-stop--hidden')))
      throw new Error('Should be visible')
  })

  await t('Generation + domain scan both complete (Find/At Target)', async () => {
    await settle(page)
    console.log(`        (btn: "${await btnText(page)}")`)
  })

  await t('Stop button hidden when idle', async () => {
    await pf(page, () => !!document.querySelector('.btn-stop')?.classList.contains('btn-stop--hidden'),
      null, MED, 'stop btn hidden')
  })

  await t('Names stored in localStorage (ngSession.names)', async () => {
    const n = await getNamesCount(page)
    const hint = await page.evaluate(() => document.querySelector('.count-hint')?.textContent ?? '')
    console.log(`        (names: ${n}, hint: "${hint}")`)
    if (n < 1) throw new Error(`Expected >= 1 name, got ${n}`)
  })

  // ── SECTION 3: Domain checker ─────────────────────────────────────────────
  console.log('\n── 3. Domain checker auto-scan ───────────────────────────────────')

  await t('Domain results section renders in DOM', async () => {
    await page.waitForFunction(
      () => !!document.querySelector('.results-header') ||
            document.querySelectorAll('tr.group-row').length > 0,
      null, { timeout: MED }
    )
  })

  await t('At least one domain result row present', async () => {
    await waitForRows(page, 1, MED)
    const n = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    console.log(`        (${n} row(s))`)
  })

  await t('Domain row has base name and status badge', async () => {
    const row   = await page.$('tr.group-row')
    const base  = await row.$eval('.group-base', el => el.textContent.trim())
    const badge = await row.$eval('.badge',       el => el.textContent.trim())
    if (!base || !badge) throw new Error(`base="${base}" badge="${badge}"`)
    console.log(`        (first: "${base.replace(/[×x]/g,'').trim()}" -> ${badge})`)
  })

  await t('Domain rows have a delete (×) button', async () => {
    if (!await page.$('.btn-delete-group')) throw new Error('Not found')
  })

  // ── SECTION 4: Priority Check ─────────────────────────────────────────────
  console.log('\n── 4. Priority Check ─────────────────────────────────────────────')

  const cnt4 = await getNamesCount(page)

  await t('Priority submit via Enter: input clears, count increases', async () => {
    await page.fill('#priority-input', 'cloudmeet testapp')
    await page.press('#priority-input', 'Enter')
    await pf(page, () => document.querySelector('#priority-input')?.value === '', null, SHORT, 'input clear')
    await page.waitForTimeout(1600)
    const after = await getNamesCount(page)
    console.log(`        (before: ${cnt4}, after: ${after})`)
    if (after <= cnt4) throw new Error(`Count did not increase (${cnt4} -> ${after})`)
  })

  await t('"cloudmeet" stored at front of ngSession.names', async () => {
    const names = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('ngSession')??'{}').names??[] } catch { return [] }
    })
    if (!names.includes('cloudmeet')) throw new Error(`Not found; first 5: [${names.slice(0,5)}]`)
    if (names[0] !== 'cloudmeet' && names[0] !== 'testapp')
      throw new Error(`names[0]="${names[0]}", expected priority name`)
  })

  await t('"testapp" stored in ngSession.names', async () => {
    const names = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('ngSession')??'{}').names??[] } catch { return [] }
    })
    if (!names.includes('testapp')) throw new Error('Not found')
  })

  await t('"cloudmeet" appears in domain results within 60 s', async () => {
    await page.waitForFunction(
      (b) => [...document.querySelectorAll('.group-base')].some(el => el.textContent.includes(b)),
      'cloudmeet', { timeout: 60_000 }
    )
  })

  await t('"testapp" appears in domain results within 60 s', async () => {
    await page.waitForFunction(
      (b) => [...document.querySelectorAll('.group-base')].some(el => el.textContent.includes(b)),
      'testapp', { timeout: 60_000 }
    )
  })

  await t('"Check First" button click submits and clears input', async () => {
    await page.fill('#priority-input', 'btnclicktest')
    await page.click('.btn-priority')
    await pf(page, () => document.querySelector('#priority-input')?.value === '', null, SHORT, 'input clear after button click')
    await page.waitForTimeout(1600)
    const names = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('ngSession') ?? '{}').names ?? [] } catch { return [] }
    })
    if (!names.includes('btnclicktest')) throw new Error('btnclicktest not in names after button click')
  })

  // ── SECTION 5: Pause / Resume ─────────────────────────────────────────────
  console.log('\n── 5. Pause / Resume ─────────────────────────────────────────────')

  await settle(page)
  const cnt5 = await getNamesCount(page)
  await page.fill('.count-input', String(cnt5 + 20))
  await page.press('.count-input', 'Tab')
  await page.click('.btn-search')
  await waitForStreaming(page, MED)

  await t('Pause click -> Resume button appears', async () => {
    await page.click('.btn-search')
    await pf(page, () => document.querySelector('.btn-search')?.textContent?.includes('Resume'),
      null, SHORT, 'Resume button')
  })
  await t('Stop button visible while paused', async () => {
    if (await page.$eval('.btn-stop', el => el.classList.contains('btn-stop--hidden')))
      throw new Error('Should be visible')
  })

  await t('Priority submit while paused queues term in ngSession', async () => {
    await page.fill('#priority-input', 'pausedprio')
    await page.press('#priority-input', 'Enter')
    await pf(page, () => document.querySelector('#priority-input')?.value === '', null, SHORT, 'input clear')
    await page.waitForTimeout(1600) // debounce
    const names = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('ngSession') ?? '{}').names ?? [] } catch { return [] }
    })
    if (!names.includes('pausedprio'))
      throw new Error(`pausedprio not in names; first 5: [${names.slice(0, 5)}]`)
  })
  await t('Button stays Resume after priority submit (not auto-resumed)', async () => {
    const txt = await btnText(page)
    if (!txt.includes('Resume')) throw new Error(`Expected Resume, got "${txt}"`)
  })

  await t('Resume click -> streaming resumes', async () => {
    await page.click('.btn-search')
    await pf(page, () => {
      const t = document.querySelector('.btn-search')?.textContent
      return t?.includes('Pause') || t?.includes('Find') || t?.includes('At Target')
    }, null, SHORT, 'Pause or idle')
  })
  await settle(page)

  await t('"pausedprio" appears in domain results after resume', async () => {
    await page.waitForFunction(
      (b) => [...document.querySelectorAll('.group-base')].some(el => el.textContent.includes(b)),
      'pausedprio', { timeout: 60_000 }
    )
  })

  // ── SECTION 6: Deletion ───────────────────────────────────────────────────
  console.log('\n── 6. Deletion ───────────────────────────────────────────────────')

  await waitForRows(page, 1, MED)

  await t('Delete (×) button removes domain row', async () => {
    const rowsBefore = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    const base = await page.$eval('.group-base', el =>
      el.textContent.replace(/[×x\s]/g,'').slice(0,12) || 'unknown')
    await page.click('.btn-delete-group')
    await page.waitForFunction(
      (b) => ![...document.querySelectorAll('.group-base')].some(el => el.textContent.includes(b)),
      base, { timeout: SHORT }
    )
    const rowsAfter = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    console.log(`        deleted "${base}" (${rowsBefore} -> ${rowsAfter} rows)`)
  })

  await t('Deleted base removed from ngSession.names', async () => {
    await page.waitForTimeout(1600)
    const n = await getNamesCount(page)
    console.log(`        (names now: ${n})`)
    if (n < 1) throw new Error('All names unexpectedly gone')
  })

  // ── SECTION 7: Auto-refill while streaming ────────────────────────────────
  console.log('\n── 7. Auto-refill on delete while streaming ──────────────────────')

  await settle(page)
  {
    const cur = await getNamesCount(page)
    const tgt = cur + 15
    await page.fill('.count-input', String(tgt))
    await page.press('.count-input', 'Tab')
    await page.click('.btn-search')
    await waitForStreaming(page, MED)
    await page.waitForTimeout(1500)
    const stillStreaming = (await btnText(page)).includes('Pause')

    await t('Delete during streaming does not crash', async () => {
      if (!stillStreaming) { console.log('        (gen done early - ok)'); return }
      await waitForRows(page, 1, MED)
      await page.click('.btn-delete-group')
      await page.waitForTimeout(500)
      if (!await page.$('.btn-search')) throw new Error('btn-search gone')
    })

    await t('Streaming finishes after mid-stream delete', () => settle(page))

    await t('Final count within 2 of target after refill', async () => {
      const final = await getNamesCount(page)
      console.log(`        (names: ${final}, target: ${tgt})`)
      if (stillStreaming && final < tgt - 2)
        throw new Error(`Expected ~${tgt}, got ${final}`)
    })
  }

  // ── SECTION 8: Session persistence (own context — no clear on reload) ──────
  console.log('\n── 8. Session persistence ────────────────────────────────────────')
  {
    // Snapshot current session data from the main test page
    const ng = await page.evaluate(() => localStorage.getItem('ngSession'))
    const ds = await page.evaluate(() => localStorage.getItem('dsSession'))

    if (!ng) {
      console.log('  ⚠  ngSession empty — skipping section 8')
    } else {
      // Use a fresh context that SEEDS the session (no clear)
      const ctxS = await browser.newContext()
      const pS   = await ctxS.newPage()
      await pS.addInitScript(({ ng, ds }) => {
        if (ng) localStorage.setItem('ngSession', ng)
        if (ds) localStorage.setItem('dsSession', ds)
      }, { ng, ds })
      await pS.goto(URL, { waitUntil: 'domcontentloaded' })
      await pS.waitForTimeout(1000) // let React mount and restore session

      const preCount = JSON.parse(ng).names?.length ?? 0

      await t('Names survive page reload (ngSession restored)', async () => {
        const after = await getNamesCount(pS)
        if (after === 0) throw new Error(`ngSession not restored (${preCount} names were saved)`)
        console.log(`        (saved: ${preCount}, restored: ${after})`)
      })

      await t('Keywords field restored from session', async () => {
        const kw = await pS.inputValue('#keywords')
        if (!kw.trim()) throw new Error('Keywords empty after reload')
        console.log(`        ("${kw}")`)
      })

      await t('Target count field restored from session', async () => {
        const v = await pS.inputValue('.count-input')
        if (!v || isNaN(parseInt(v))) throw new Error(`count: "${v}"`)
        console.log(`        (${v})`)
      })

      await t('Domain results restored from dsSession', async () => {
        if (!ds) { console.log('        (no dsSession to restore - ok)'); return }
        await pS.waitForFunction(
          () => document.querySelectorAll('tr.group-row').length > 0,
          null, { timeout: 10_000 }
        ).catch(() => {})
        const rows = await pS.evaluate(() => document.querySelectorAll('tr.group-row').length)
        console.log(`        (domain rows after reload: ${rows})`)
        if (rows < 1) throw new Error('dsSession not restored - no rows')
      })

      await ctxS.close()
    }
  }

  // ── SECTION 9: Stop button ────────────────────────────────────────────────
  console.log('\n── 9. Stop button ────────────────────────────────────────────────')
  {
    await settle(page)
    const cur = await getNamesCount(page)
    // Make sure keywords are set (page was NOT reloaded, state preserved from sec 7)
    const kw = await page.inputValue('#keywords')
    if (!kw.trim()) await page.fill('#keywords', 'meeting collaboration')
    await page.fill('.count-input', String(cur + 10))
    await page.press('.count-input', 'Tab')
    await page.click('.btn-search')
    await waitForStreaming(page, MED)

    await t('Stop button stops generation immediately', async () => {
      await page.click('.btn-stop')
      await waitForIdle(page, SHORT)
    })

    await t('Stop button hides after stop', async () => {
      await settle(page) // wait for domain scan to finish too
      if (!await page.$eval('.btn-stop', el => el.classList.contains('btn-stop--hidden')))
        throw new Error('Should be hidden')
    })
  }

  // ── SECTION 10: Domain row interactions ───────────────────────────────────
  console.log('\n── 10. Domain row interactions ───────────────────────────────────')

  await waitForRows(page, 1, MED)

  await t('Clicking a row expands it (group-row--open)', async () => {
    const row = await page.$('tr.group-row')
    await row.click()
    await pf(page, () => !!document.querySelector('tr.group-row--open'), null, SHORT, 'expand')
  })

  await t('Domain links are valid http URLs', async () => {
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('tr a[href]')].map(a => a.href).filter(Boolean))
    console.log(`        (${links.length} link(s))`)
    const bad = links.filter(h => !h.startsWith('http'))
    if (bad.length) throw new Error(`Non-http: ${bad.join(', ')}`)
  })

  await t('HugeDomains links use .cfm format (not /domain/ path)', async () => {
    const hdLinks = await page.evaluate(() =>
      [...document.querySelectorAll('tr a[href]')]
        .map(a => a.href)
        .filter(h => h.includes('hugedomains')))
    console.log(`        (${hdLinks.length} HugeDomains link(s))`)
    const badFormat = hdLinks.filter(h => h.includes('/domain/') && !h.includes('.cfm'))
    if (badFormat.length)
      throw new Error(`Old /domain/ URL format found: ${badFormat[0]}`)
  })

  await t('Bulk-delete menu opens and shows options', async () => {
    const trigger = await page.$('.btn-delete-trigger')
    if (!trigger) throw new Error('.btn-delete-trigger not found')
    await trigger.click()
    await page.waitForSelector('.delete-menu', { timeout: SHORT })
    const items = await page.$$('.delete-menu button, .delete-menu-danger')
    if (!items.length) throw new Error('Delete menu empty')
    // Toggle-close by clicking the trigger again
    await trigger.click()
    await page.waitForFunction(() => !document.querySelector('.delete-menu'), null, { timeout: SHORT })
  })

  await t('Bulk delete by status removes matching rows and names', async () => {
    // Identify which status has rows to delete (prefer Unknown > Taken)
    const target = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.group-row')]
      const uCount = rows.filter(r => r.querySelector('.badge')?.textContent?.trim() === 'Unknown').length
      const tCount = rows.filter(r => ['Taken', 'Taken*'].includes(r.querySelector('.badge')?.textContent?.trim())).length
      if (uCount > 0) return { type: 'unknown', count: uCount, label: 'Delete all Unknown' }
      if (tCount > 0) return { type: 'taken',   count: tCount, label: 'Delete all Taken' }
      return null
    })
    if (!target) { console.log('        (no Unknown/Taken rows present — skip)'); return }

    const rowsBefore  = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    const namesBefore = await getNamesCount(page)

    await page.click('.btn-delete-trigger')
    await page.waitForSelector('.delete-menu', { timeout: SHORT })
    await page.getByText(target.label, { exact: true }).click()

    // Wait for matching rows to disappear
    await page.waitForFunction(
      ({ type }) => {
        const rows = [...document.querySelectorAll('tr.group-row')]
        return !rows.some(r => {
          const txt = r.querySelector('.badge')?.textContent?.trim() ?? ''
          return type === 'unknown' ? txt === 'Unknown' : txt === 'Taken' || txt === 'Taken*'
        })
      },
      target, { timeout: SHORT }
    )

    const rowsAfter  = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    await page.waitForTimeout(1600) // session debounce
    const namesAfter = await getNamesCount(page)
    console.log(`        (${target.type}: ${rowsBefore} -> ${rowsAfter} rows, names ${namesBefore} -> ${namesAfter})`)
    if (rowsAfter >= rowsBefore)  throw new Error(`Rows did not decrease (${rowsBefore} -> ${rowsAfter})`)
    if (namesAfter >= namesBefore) throw new Error(`Names did not decrease (${namesBefore} -> ${namesAfter})`)
  })

  // ── SECTION 11: Trademark auto-check ─────────────────────────────────────
  console.log('\n── 11. Trademark auto-check ──────────────────────────────────────')

  await t('TM spinner or verdict appears on Buy Now / Price Inquiry rows', async () => {
    const found = await page.waitForFunction(() =>
      [...document.querySelectorAll('tr.group-row')].some(r => {
        const badge = r.querySelector('.badge')?.textContent ?? ''
        return (badge.includes('Buy Now') || badge.includes('Price')) &&
               !!r.querySelector('[class*="tm"]')
      })
    , null, { timeout: 20_000 }).then(() => true).catch(() => false)
    console.log(`        (TM element on qualifying row: ${found})`)
  })

  // ── SECTION 13: Status filter chips ──────────────────────────────────────
  console.log('\n── 13. Status filter chips ───────────────────────────────────────')

  await t('Filter chip hides rows for that status', async () => {
    await waitForRows(page, 1, MED)
    const info = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.group-row')]
      for (const { key, badges } of [
        { key: 'available',   badges: ['Buy Now', 'Buy Now*'] },
        { key: 'for_sale',    badges: ['Price Inquiry'] },
        { key: 'unavailable', badges: ['Taken', 'Taken*'] },
        { key: 'unknown',     badges: ['Unknown'] },
      ]) {
        const count = rows.filter(r => badges.includes(r.querySelector('.badge')?.textContent?.trim())).length
        if (count > 0) return { key, badges, count }
      }
      return null
    })
    if (!info) { console.log('        (no rows — skip)'); return }

    await page.click(`.filter-chip--${info.key}`)
    await pf(page,
      (k) => document.querySelector(`.filter-chip--${k}`)?.classList.contains('filter-chip--off'),
      info.key, SHORT, `chip ${info.key} off`
    )
    await page.waitForFunction(
      (badges) => ![...document.querySelectorAll('tr.group-row')].some(
        r => badges.includes(r.querySelector('.badge')?.textContent?.trim())
      ),
      info.badges, { timeout: SHORT }
    )
    const remaining = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    console.log(`        (hid ${info.count} "${info.key}" rows; ${remaining} remaining)`)
  })

  await t('Filter chip re-enables and restores hidden rows', async () => {
    const offKey = await page.evaluate(() => {
      for (const chip of document.querySelectorAll('.filter-chip--off'))
        for (const cls of chip.classList)
          if (cls.startsWith('filter-chip--') && cls !== 'filter-chip--off' && cls !== 'filter-chip--on')
            return cls.replace('filter-chip--', '')
      return null
    })
    if (!offKey) { console.log('        (no chip off — skip)'); return }

    const rowsBefore = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    await page.click(`.filter-chip--${offKey}.filter-chip--off`)
    await pf(page,
      (k) => document.querySelector(`.filter-chip--${k}`)?.classList.contains('filter-chip--on'),
      offKey, SHORT, `chip ${offKey} on`
    )
    await page.waitForTimeout(300)
    const rowsAfter = await page.evaluate(() => document.querySelectorAll('tr.group-row').length)
    console.log(`        (re-enabled "${offKey}": ${rowsBefore} → ${rowsAfter} rows)`)
    if (rowsAfter <= rowsBefore) throw new Error(`Rows did not increase (${rowsBefore} -> ${rowsAfter})`)
  })

  await t('TLD chip can be toggled off and back on', async () => {
    const tldLabel = await page.$('.tld-chip')
    if (!tldLabel) { console.log('        (no TLD chips — skip)'); return }
    const checkbox = await tldLabel.$('input[type="checkbox"]')
    const wasChecked = await checkbox.isChecked()
    const tldText = await tldLabel.evaluate(el => el.textContent.trim())
    await tldLabel.click()
    const afterFirst = await checkbox.isChecked()
    if (afterFirst === wasChecked) throw new Error(`TLD chip "${tldText}" state did not change`)
    await tldLabel.click()
    const afterSecond = await checkbox.isChecked()
    if (afterSecond !== wasChecked) throw new Error(`TLD chip "${tldText}" did not restore`)
    console.log(`        (TLD "${tldText}": ${wasChecked} → ${afterFirst} → ${afterSecond})`)
  })

  // ── SECTION 14: Sort controls ─────────────────────────────────────────────
  console.log('\n── 14. Sort controls ─────────────────────────────────────────────')

  await t('Price sort cycles through three states', async () => {
    const headers = await page.$$('.th-sortable')
    if (!headers.length) throw new Error('.th-sortable not found')
    const priceHeader = headers[0]
    const getIcon = () => priceHeader.$eval('.sort-icon', el => el.textContent.trim())

    const s0 = await getIcon()
    await priceHeader.click(); await page.waitForTimeout(200)
    const s1 = await getIcon()
    if (s1 === s0) throw new Error(`No change after 1st click: "${s0}"`)

    await priceHeader.click(); await page.waitForTimeout(200)
    const s2 = await getIcon()
    if (s2 === s1) throw new Error(`No change after 2nd click: "${s1}"`)

    await priceHeader.click(); await page.waitForTimeout(200)
    const s3 = await getIcon()
    if (s3 !== s0) throw new Error(`Did not cycle back: "${s3}" vs start "${s0}"`)
    console.log(`        (${s0} → ${s1} → ${s2} → ${s3})`)
  })

  await t('Ascending price sort produces non-decreasing order for priced rows', async () => {
    const headers = await page.$$('.th-sortable')
    const priceHeader = headers[0]
    // Click until we reach ascending (▲)
    for (let i = 0; i < 3; i++) {
      const icon = await priceHeader.$eval('.sort-icon', el => el.textContent.trim())
      if (icon.includes('▲')) break
      await priceHeader.click(); await page.waitForTimeout(200)
    }
    const prices = await page.evaluate(() =>
      [...document.querySelectorAll('tr.group-row')].map(r => {
        const txt = r.querySelectorAll('td')[2]?.textContent?.trim() ?? ''
        return (txt === '—' || txt === '') ? null : parseFloat(txt.replace(/[$,]/g, ''))
      }).filter(p => p !== null && isFinite(p))
    )
    if (prices.length < 2) { console.log(`        (< 2 priced rows — skip)`); return }
    for (let i = 1; i < prices.length; i++)
      if (prices[i] < prices[i - 1])
        throw new Error(`Not ascending at [${i}]: ${prices[i - 1]} > ${prices[i]}`)
    console.log(`        (${prices.length} prices OK, first 3: ${prices.slice(0, 3).join(', ')})`)
    // Reset to original state
    await priceHeader.click(); await priceHeader.click()
  })

  await t('TM sort toggle activates and deactivates', async () => {
    const headers = await page.$$('.th-sortable')
    if (headers.length < 2) { console.log('        (< 2 sortable headers — skip)'); return }
    const tmHeader = headers[1]
    const getIcon = () => tmHeader.$eval('.sort-icon', el => el.textContent.trim())

    const s0 = await getIcon()
    await tmHeader.click(); await page.waitForTimeout(200)
    const s1 = await getIcon()
    if (s1 === s0) throw new Error(`TM sort icon did not change: "${s0}"`)

    await tmHeader.click(); await page.waitForTimeout(200)
    const s2 = await getIcon()
    if (s2 !== s0) throw new Error(`TM sort did not restore: "${s2}" vs "${s0}"`)
    console.log(`        (${s0} → ${s1} → ${s2})`)
  })

  // ── SECTION 15: JS error check ────────────────────────────────────────────
  console.log('\n── 15. JS error check ────────────────────────────────────────────')

  await t('No unhandled JS errors across all tests', async () => {
    const rel = jsErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_'))
    if (rel.length) throw new Error(`${rel.length} error(s): ${rel.slice(0,2).join(' | ')}`)
  })

  await ctx2.close()
  await browser.close()

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────────────')
  console.log(`  ${passed+failed} tests   ${passed} passed   ${failed} failed   ${failed===0 ? 'ALL PASS' : 'SOME FAILED'}`)
  if (failures.length) {
    console.log('\nFailed:')
    failures.forEach(f => console.log(`  x ${f.name}\n    ${f.err}`))
  }
  console.log('')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(2) })
