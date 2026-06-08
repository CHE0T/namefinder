const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' });

  const labels = await page.$$eval('label', ls => ls.map(l => l.innerText.trim()).filter(Boolean));
  console.log('LABELS:', JSON.stringify(labels));

  const btnText = await page.$eval('.btn-search', b => b.textContent.trim());
  const btnDisabled = await page.$eval('.btn-search', b => b.disabled);
  console.log('FIND_BTN:', btnText, '| disabled:', btnDisabled);

  const tldChips = await page.$$eval('.tld-chip', cs => cs.map(c => ({ label: c.textContent.trim(), checked: c.querySelector('input').checked })));
  console.log('TLD_CHIPS:', JSON.stringify(tldChips));

  await page.fill('#keywords', 'test startup');
  const disabledAfter = await page.$eval('.btn-search', b => b.disabled);
  console.log('FIND_ENABLED_WITH_KW:', !disabledAfter);

  await page.fill('#priority-input', 'myname');
  const priorityEnabled = await page.$eval('.btn-priority', b => !b.disabled);
  console.log('PRIORITY_BTN_ENABLED:', priorityEnabled);

  const stopHidden = await page.$eval('.btn-stop', b => b.classList.contains('btn-stop--hidden'));
  console.log('STOP_HIDDEN_INITIALLY:', stopHidden);

  await page.screenshot({ path: 'screenshot_tested.png', fullPage: true });
  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
