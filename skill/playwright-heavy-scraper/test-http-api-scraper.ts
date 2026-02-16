/**
 * 使用 HTTP API 的测试脚本（当 WebSocket CDP 不可用时）
 * 抓取 Quotes to Scrape 网站
 * 
 * 使用方法：
 * cd /home/node/.openclaw/skills/playwright-heavy-scraper
 * npx ts-node test-http-api-scraper.ts
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const BROWSERLESS_URL = 'http://amyclaw-browser:9222';
const OUTPUT_DIR = '/home/node/jim/data/jim/test';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'quotes-scraped-http.json');

interface Quote {
  text: string;
  author: string;
  tags: string[];
}

/**
 * 调用 browserless HTTP API
 */
function callBrowserlessAPI(endpoint: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'amyclaw-browser',
      port: 9222,
      path: `${endpoint}?timeout=60000`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(responseData));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * 抓取单页内容
 */
async function scrapePage(url: string): Promise<Quote[]> {
  console.log(`📄 抓取页面: ${url}`);
  
  // 使用 scrape API 提取数据
  const result = await callBrowserlessAPI('/scrape', {
    url: url,
    elements: [
      { selector: '.quote' }
    ]
  });

  // 解析 HTML 内容
  const quotes: Quote[] = [];
  if (result.data && result.data.length > 0) {
    for (const item of result.data) {
      const html = item.html || '';
      // 简单的 HTML 解析（实际应该使用 cheerio 等库）
      const textMatch = html.match(/<span class="text"[^>]*>(.*?)<\/span>/);
      const authorMatch = html.match(/<small class="author"[^>]*>(.*?)<\/small>/);
      const tagMatches = html.matchAll(/<a class="tag"[^>]*>(.*?)<\/a>/g);
      
      const tags = Array.from(tagMatches).map(m => m[1]?.trim() || '').filter(Boolean);
      
      quotes.push({
        text: textMatch ? textMatch[1].replace(/&quot;/g, '"') : '',
        author: authorMatch ? authorMatch[1].trim() : '',
        tags: tags
      });
    }
  }

  return quotes;
}

/**
 * 查找下一页链接
 */
async function findNextPageUrl(currentUrl: string): Promise<string | null> {
  try {
    const result = await callBrowserlessAPI('/evaluate', {
      url: currentUrl,
      code: `
        (() => {
          const nextLink = document.querySelector('.next a');
          return nextLink ? nextLink.href : null;
        })()
      `
    });
    return result.result || null;
  } catch (error) {
    console.warn('查找下一页失败:', error);
    return null;
  }
}

async function main() {
  console.log('🚀 开始使用 HTTP API 抓取 Quotes to Scrape...');
  console.log('📁 输出目录:', OUTPUT_DIR);
  
  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allQuotes: Quote[] = [];
  let currentUrl = 'http://quotes.toscrape.com/';
  let pageCount = 0;
  const maxPages = 10;

  try {
    while (currentUrl && pageCount < maxPages) {
      pageCount++;
      console.log(`\n📖 第 ${pageCount} 页...`);

      const quotes = await scrapePage(currentUrl);
      allQuotes.push(...quotes);
      console.log(`✅ 本页抓取 ${quotes.length} 条名言`);

      // 查找下一页
      const nextUrl = await findNextPageUrl(currentUrl);
      if (nextUrl) {
        currentUrl = nextUrl;
        // 等待一下，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log('📄 没有更多页面了');
        break;
      }
    }

    console.log(`\n✅ 总共抓取 ${allQuotes.length} 条名言`);

    // 保存到 JSON 文件
    const output = {
      source: 'http://quotes.toscrape.com/',
      method: 'HTTP API',
      scrapedAt: new Date().toISOString(),
      totalPages: pageCount,
      totalQuotes: allQuotes.length,
      quotes: allQuotes
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`💾 数据已保存到: ${OUTPUT_FILE}`);

    // 显示前几条数据
    console.log('\n📝 前 3 条数据示例:');
    allQuotes.slice(0, 3).forEach((quote, index) => {
      console.log(`${index + 1}. "${quote.text}" - ${quote.author}`);
      console.log(`   标签: ${quote.tags.join(', ')}`);
    });

  } catch (error) {
    console.error('❌ 抓取失败:', error);
    process.exit(1);
  }
}

main();
