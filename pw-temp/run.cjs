const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' });

  const r = {};

  r.findDisabledNoKW = await page.$eval('.btn-search', b => b.disabled);
  await page.fill('#keywords', 'startup tech');
  r.findEnabledWithKW = await page.$eval('.btn-search', b => !b.disabled);
  r.findText = await page.$eval('.btn-search', b => b.textContent.trim());
  r.stopHiddenInit = await page.$eval('.btn-stop', b => b.classList.contains('btn-stop--hidden'));

  await page.click('button:has-text("Evocative")');
  r.evocativeActive = await page.$$eval('.style-chip--active', cs => cs.map(c => c.textContent.trim()));
  await page.click('button:has-text("Brandable Names")');
  r.brandableRestored = await page.$$eval('.style-chip--active', cs => cs.map(c => c.textContent.trim()));

  await page.click('button.mode-btn:has-text("Low")');
  r.lowActive = await page.$eval('button.mode-btn:has-text("Low")', b => b.classList.contains('active'));
  r.medInactiveAfterLow = !(await page.$eval('button.mode-btn:has-text("Medium")', b => b.classList.contains('active')));
  await page.click('button.mode-btn:has-text("Medium")');

  r.defaultTlds = await page.$$eval('.tld-chip', cs => cs.filter(c => c.querySelector('input').checked).map(c => c.textContent.trim()));
  await page.click('.tld-chip:nth-child(2)');
  r.afterNetToggle = await page.$$eval('.tld-chip', cs => cs.filter(c => c.querySelector('input').checked).map(c => c.textContent.trim()));
  await page.click('.tld-chip:nth-child(2)');
  r.afterNetUntoggle = await page.$$eval('.tld-chip', cs => cs.filter(c => c.querySelector('input').checked).map(c => c.textContent.trim()));

  await page.click('button.mode-btn:has-text("ANY")');
  r.anyActive = await page.$eval('button.mode-btn:has-text("ANY")', b => b.classList.contains('active'));
  r.allInactive = !(await page.$eval('button.mode-btn:has-text("ALL")', b => b.classList.contains('active')));
  const hints = await page.$$eval('.mode-hint', hs => hs.map(h => h.textContent.trim()));
  r.anyHintText = hints.find(h => h.includes('any'));
  await page.click('button.mode-btn:has-text("ALL")');

  const priceInputs = await page.$$('.price-input input');
  await priceInputs[0].fill('5000');
  await priceInputs[1].fill('100');
  await page.waitForTimeout(200);
  r.rangeErrorShown = (await page.$('.field-error')) !== null;
  await priceInputs[0].fill('');
  await priceInputs[1].fill('10000');

  r.priorityDisabledEmpty = await page.$eval('.btn-priority', b => b.disabled);
  await page.fill('#priority-input', 'myname1 myname2');
  r.priorityEnabledWithInput = await page.$eval('.btn-priority', b => !b.disabled);

  await page.fill('#description', 'A'.repeat(150));
  r.descCounter = await page.$eval('.desc-counter', el => el.textContent.trim());
  r.descCounterGood = (await page.$eval('.desc-counter', el => el.className)).includes('good');

  await page.fill('#description', 'A'.repeat(260));
  r.descCounterDanger = (await page.$eval('.desc-counter', el => el.className)).includes('danger');

  await page.fill('#count', '500');
  r.countValue = await page.$eval('#count', el => el.value);

  r.namesGridAbsent = (await page.$('.names-grid')) === null;

  await page.click('.btn-theme');
  r.darkModeOn = (await page.$eval('html', el => el.getAttribute('data-theme'))) === 'dark';
  await page.screenshot({ path: '../frontend/ss_dark_ui.png', fullPage: true });
  await page.click('.btn-theme');
  r.lightModeRestored = (await page.$eval('html', el => el.getAttribute('data-theme'))) !== 'dark';

  r.consoleErrors = errors;

  const fs = require('fs');
  fs.writeFileSync('results.json', JSON.stringify(r, null, 2));
  await browser.close();
  console.log('DONE');
})().catch(e => { require('fs').writeFileSync('error.txt', e.stack); process.exit(1); });
