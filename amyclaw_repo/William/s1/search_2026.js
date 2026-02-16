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
    "https://www.google.com/search?q=2026/27+中一入学申请+直资+私立+香港+admission",
    "https://www.google.com/search?q=site:edu.hk+2026/27+S1+admission+Secondary+1",
    "https://www.google.com/search?q=2026+Secondary+1+Admission+Hong+Kong+DSS+Schools"
  ];

  for (let i = 0; i < searchQueries.length; i++) {
    await page.goto(searchQueries[i], { waitUntil: 'networkidle', timeout: 30000 });
    await setSize();
    await page.waitForTimeout(2000);
    const scPath = `/home/node/jim/William/s1/search_2026_step_${i}.png`;
    await page.screenshot({ path: scPath, fullPage: true });
    console.log('MEDIA:' + scPath);
    
    // Extract titles and snippets
    const results = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div.g')).map(el => {
            const title = el.querySelector('h3')?.innerText;
            const link = el.querySelector('a')?.href;
            const snippet = el.innerText;
            return { title, link, snippet };
        });
    });
    console.log(`---DATA_START_${i}---`);
    console.log(JSON.stringify(results));
    console.log(`---DATA_END_${i}---`);
  }

  await context.close();
}
run();
