const playwrightPath = '/home/node/.openclaw/skills/playwright-heavy-scraper/node_modules/playwright-core';
const { chromium } = require(playwrightPath);

async function run() {
  const browser = await chromium.connectOverCDP('ws://amyclaw-browser:9222');
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  
  const sites = [
    { name: "SMCPS", url: "https://www.smcps.edu.hk/" }, // 圣玛加利男女英文中小学
    { name: "YWC", url: "https://www.ywc.edu.hk/" }, // 英华
    { name: "SPC", url: "https://www.spc.edu.hk/" }, // 圣保罗
    { name: "Logos", url: "https://www.logosacademy.edu.hk/tw/admission/s1-admission/" }, // 港大同学会/真道
    { name: "St Pauls Co-ed", url: "https://www.spcc.edu.hk/" },
    { name: "DBS", url: "https://www.dbs.edu.hk/" },
    { name: "GT College", url: "http://www.gtcollege.edu.hk/" }
  ];

  for (const site of sites) {
    try {
      await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30000 });
      const scPath = `/home/node/jim/William/s1/site_${site.name}.png`;
      await page.screenshot({ path: scPath, fullPage: true });
      console.log(`SITE:${site.name} MEDIA:${scPath}`);
    } catch (e) {
      console.log(`FAILED:${site.name}`);
    }
  }
  await context.close();
}
run();
