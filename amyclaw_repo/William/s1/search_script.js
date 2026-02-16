const playwrightPath = '/home/node/.openclaw/skills/playwright-heavy-scraper/node_modules/playwright-core';
const { chromium } = require(playwrightPath);

async function run() {
  const browser = await chromium.connectOverCDP('ws://amyclaw-browser:9222');
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  async function setSize() {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080
    });
  }

  await setSize();
  
  const searchQueries = [
    "https://www.google.com/search?q=site:edu.hk+2025/26+中一+补录+Late+Application",
    "https://www.google.com/search?q=site:edu.hk+2026/27+中一+入学+申请+Admission",
    "https://www.google.com/search?q=2025/26+S1+Late+Application+DSS+Secondary+School"
  ];

  let results = "";

  for (let i = 0; i < searchQueries.length; i++) {
    await page.goto(searchQueries[i], { waitUntil: 'networkidle', timeout: 30000 });
    await setSize();
    await page.waitForTimeout(2000);
    const content = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div.g')).map(el => el.innerText).join('\n---\n');
    });
    results += `\n\n### Query ${i+1}\n` + content;
    const scPath = `/home/node/jim/William/s1/search_step_${i}.png`;
    await page.screenshot({ path: scPath, fullPage: true });
    console.log('MEDIA:' + scPath);
  }

  console.log('---SEARCH_RESULTS_START---');
  console.log(results);
  console.log('---SEARCH_RESULTS_END---');

  await context.close();
}
run();
