import { chromium } from 'playwright-core';

/**
 * 通过 CDP 连接到 Sidecar 浏览器容器，避免端口冲突
 * 连接到 amyclaw-browser 容器的 9222 端口
 */
export async function runScraper(url: string) {
  // 关键：连接到 Sidecar 容器，避开本地 9222 端口争抢
  // 在 Docker 网络中使用服务名 amyclaw-browser 进行连接
  const browser = await chromium.connectOverCDP('ws://amyclaw-browser:9222');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('正在通过 Playwright-Skill 大规模抓取...');
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // 这里写你的高并发抓取逻辑
  const data = await page.title();
  
  await context.close();
  await browser.close();
  return data;
}

/**
 * 大规模翻页爬取函数
 * @param startUrl 起始 URL
 * @param maxPages 最大翻页数
 * @param extractor 数据提取函数
 */
export async function scrapePaginated(
  startUrl: string,
  maxPages: number = 10,
  extractor?: (page: any) => Promise<any>
) {
  const browser = await chromium.connectOverCDP('ws://amyclaw-browser:9222');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const results: any[] = [];
  
  try {
    await page.goto(startUrl, { waitUntil: 'networkidle' });
    
    for (let i = 0; i < maxPages; i++) {
      console.log(`正在抓取第 ${i + 1} 页...`);
      
      // 提取当前页数据
      if (extractor) {
        const pageData = await extractor(page);
        results.push(...(Array.isArray(pageData) ? pageData : [pageData]));
      } else {
        // 默认提取标题
        const title = await page.title();
        results.push({ page: i + 1, title });
      }
      
      // 查找并点击下一页按钮（根据实际网站调整选择器）
      const nextButton = await page.$('a[aria-label="Next"], .next-page, button:has-text("下一页")');
      if (!nextButton) {
        console.log('没有找到下一页按钮，停止翻页');
        break;
      }
      
      await nextButton.click();
      await page.waitForLoadState('networkidle');
    }
  } finally {
    await context.close();
    await browser.close();
  }
  
  return results;
}
