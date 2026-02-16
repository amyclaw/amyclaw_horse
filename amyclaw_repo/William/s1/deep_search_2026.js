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

  const queries = [
    "2026/27 S1 admission Hong Kong secondary school info day",
    "2026/27 中一入学申请 招生简章 直资",
    "Hong Kong Direct Subsidy Scheme Schools Council S1 admission 2026",
    "site:edu.hk 2026/27 admission Secondary 1"
  ];

  for (let i = 0; i < queries.length; i++) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(queries[i])}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await setSize();
    await page.waitForTimeout(3000);
    
    const scPath = `/home/node/jim/William/s1/search_2026_ref_${i}.png`;
    await page.screenshot({ path: scPath, fullPage: true });
    console.log('MEDIA:' + scPath);
    
    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div.g')).map(el => ({
        title: el.querySelector('h3')?.innerText,
        link: el.querySelector('a')?.href,
        snippet: el.innerText
      }));
    });
    console.log(`---DATA_START_${i}---`);
    console.log(JSON.stringify(results, null, 2));
    console.log(`---DATA_END_${i}---`);
  }

  await context.close();
}
run();
