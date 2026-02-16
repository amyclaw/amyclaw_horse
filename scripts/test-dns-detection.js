#!/usr/bin/env node

/**
 * DNS 检测测试脚本
 * 用于测试 DNS 自动检测功能是否正常工作
 */

const AutoDNSDetector = require('./auto-detect-dns');

async function test() {
    console.log('=== DNS 检测功能测试 ===\n');
    
    const detector = new AutoDNSDetector();
    
    try {
        // 测试获取公网 IP
        console.log('1. 测试获取公网 IP...');
        const ip = await detector.getPublicIP();
        console.log(`   ✓ 公网 IP: ${ip}\n`);
        
        // 测试获取地理位置
        console.log('2. 测试获取地理位置...');
        const geo = await detector.getGeoInfo(ip);
        console.log(`   ✓ 国家: ${geo.country} (${geo.countryCode})`);
        console.log(`   ✓ 城市: ${geo.city || '未知'}\n`);
        
        // 测试选择 DNS 配置
        console.log('3. 测试选择 DNS 配置...');
        const feishuConfig = detector.selectOptimalDNS('feishu', geo.countryCode);
        console.log(`   ✓ 飞书: ${feishuConfig.name} (${feishuConfig.countryCode})`);
        console.log(`   ✓ DNS IP: ${feishuConfig.dns_ips[0]}`);
        console.log(`   ✓ API 域名: ${feishuConfig.api_domains.join(', ')}\n`);
        
        const telegramConfig = detector.selectOptimalDNS('telegram', geo.countryCode);
        console.log(`   ✓ Telegram: ${telegramConfig.name} (${telegramConfig.countryCode})`);
        console.log(`   ✓ DNS IP: ${telegramConfig.dns_ips[0]}`);
        console.log(`   ✓ API 域名: ${telegramConfig.api_domains.join(', ')}\n`);
        
        // 测试生成 network_map
        console.log('4. 测试生成 network_map...');
        const networkMap = detector.generateNetworkMap(geo);
        console.log(`   ✓ 已生成 ${Object.keys(networkMap.mappings).length} 个域名映射`);
        console.log(`   ✓ 区域: ${networkMap.region}`);
        console.log(`   ✓ 映射示例:`);
        Object.entries(networkMap.mappings).slice(0, 3).forEach(([domain, ip]) => {
            console.log(`     - ${domain} -> ${ip}`);
        });
        
        console.log('\n✓ 所有测试通过！');
        return 0;
    } catch (e) {
        console.error(`\n✗ 测试失败: ${e.message}`);
        console.error(e.stack);
        return 1;
    }
}

if (require.main === module) {
    test().then(code => process.exit(code));
}

module.exports = test;
