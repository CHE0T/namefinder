import { test, expect } from "@playwright/test";

test("ui sanity", async ({ page }) => {
  const errors = [];
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", err => errors.push("PAGE ERROR: " + err.message));

  await page.goto("http://localhost:5175");
  await page.waitForLoadState("networkidle");

  const labels = await page.$$eval("label", ls => ls.map(l => l.innerText.trim()).filter(Boolean));
  console.log("LABELS:", JSON.stringify(labels));

  const findDisabled = await page.$eval(".btn-search", b => b.disabled);
  console.log("FIND_DISABLED_NO_KW:", findDisabled);

  await page.fill("#keywords", "test startup");
  const findEnabled = await page.$eval(".btn-search", b => !b.disabled);
  console.log("FIND_ENABLED_WITH_KW:", findEnabled);

  const chips = await page.$$eval(".tld-chip", cs =>
    cs.map(c => c.textContent.trim() + "=" + c.querySelector("input").checked)
  );
  console.log("TLD_CHIPS:", JSON.stringify(chips));

  const priorityDisabled = await page.$eval(".btn-priority", b => b.disabled);
  console.log("PRIORITY_DISABLED_EMPTY:", priorityDisabled);

  await page.fill("#priority-input", "myname");
  const priorityEnabled = await page.$eval(".btn-priority", b => !b.disabled);
  console.log("PRIORITY_ENABLED:", priorityEnabled);

  const stopHidden = await page.$eval(".btn-stop", b => b.classList.contains("btn-stop--hidden"));
  console.log("STOP_HIDDEN:", stopHidden);

  const namesGrid = await page.$(".names-grid");
  console.log("NAMES_GRID_ABSENT:", namesGrid === null);

  await page.click(".btn-theme");
  const theme = await page.$eval("html", el => el.getAttribute("data-theme"));
  console.log("DARK_MODE_ON:", theme === "dark");

  await page.screenshot({ path: "pw-test/screenshot.png", fullPage: true });
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
});
