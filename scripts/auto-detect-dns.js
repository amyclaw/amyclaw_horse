#!/usr/bin/env node

/**
 * 自动检测服务器地理位置并选择最近的 DNS/机房
 * 根据部署服务器所在地的公网地址自动检测接入的当地 DNS 或机房
 * 确保不跨境远距离接入机房
 */

const fs = require('fs');
const https = require('https');
const http = require('http');

// 使用 path.join 和 __dirname 确保路径正确（支持宿主机和容器环境）
const path = require('path');
const DNS_RULES_PATH = path.join(__dirname, '../config/dns-rules.json');
// 运行时路径：供 amy_resolver 快速访问（可能在清空 memory 时被删除）
const NETWORK_MAP_RUNTIME_PATH = '/home/node/.openclaw/workspace/memory/network_map.json';
// 持久化路径：仓库代码路径，不会被清空记忆时删除（版本控制）
const NETWORK_MAP_PERSISTENT_PATH = path.join(__dirname, '../config/workspace/memory/network_map.json');

class AutoDNSDetector {
    constructor() {
        this.dnsRules = this.loadDNSRules();
        this.publicIP = null;
        this.geoInfo = null;
    }

    loadDNSRules() {
        try {
            const data = fs.readFileSync(DNS_RULES_PATH, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error(`无法加载 DNS 规则配置: ${e.message}`);
            process.exit(1);
        }
    }

    /**
     * 获取服务器公网 IP
     */
    async getPublicIP() {
        if (this.publicIP) {
            return this.publicIP;
        }

        const services = this.dnsRules.public_ip_services || [];
        
        for (const service of services.sort((a, b) => a.priority - b.priority)) {
            try {
                const ip = await this.fetchPublicIP(service);
                if (ip) {
                    this.publicIP = ip;
                    console.log(`✓ 检测到公网 IP: ${ip} (来源: ${service.name})`);
                    return ip;
                }
            } catch (e) {
                console.warn(`⚠ ${service.name} 获取 IP 失败: ${e.message}`);
            }
        }

        throw new Error('无法获取服务器公网 IP');
    }

    fetchPublicIP(service) {
        return new Promise((resolve, reject) => {
            const url = new URL(service.url);
            const client = url.protocol === 'https:' ? https : http;
            
            const req = client.get(url.href, { timeout: service.timeout || 3000 }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (service.name === 'api.ipify') {
                            const json = JSON.parse(data);
                            resolve(json.ip);
                        } else {
                            resolve(data.trim());
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
        });
    }

    /**
     * 获取地理位置信息
     */
    async getGeoInfo(ip) {
        if (this.geoInfo) {
            return this.geoInfo;
        }

        const services = this.dnsRules.geoip_services || [];
        
        for (const service of services.sort((a, b) => a.priority - b.priority)) {
            try {
                const geo = await this.fetchGeoInfo(service, ip);
                if (geo && geo.countryCode) {
                    this.geoInfo = geo;
                    console.log(`✓ 检测到地理位置: ${geo.country} (${geo.countryCode}) - ${geo.city || '未知城市'} (来源: ${service.name})`);
                    return geo;
                }
            } catch (e) {
                console.warn(`⚠ ${service.name} 获取地理位置失败: ${e.message}`);
            }
        }

        throw new Error('无法获取服务器地理位置信息');
    }

    fetchGeoInfo(service, ip) {
        return new Promise((resolve, reject) => {
            const url = new URL(service.url.replace('{ip}', ip));
            const client = url.protocol === 'https:' ? https : http;
            
            const req = client.get(url.href, { timeout: service.timeout || 5000 }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        
                        // 适配不同的 GeoIP 服务响应格式
                        if (service.name === 'ip-api') {
                            if (json.status === 'success') {
                                resolve({
                                    country: json.country,
                                    countryCode: json.countryCode,
                                    city: json.city,
                                    lat: json.lat,
                                    lon: json.lon,
                                    ip: json.query
                                });
                            } else {
                                reject(new Error(json.message || '查询失败'));
                            }
                        } else if (service.name === 'ipapi') {
                            if (!json.error) {
                                resolve({
                                    country: json.country_name,
                                    countryCode: json.country_code,
                                    city: json.city,
                                    lat: json.latitude,
                                    lon: json.longitude,
                                    ip: json.ip
                                });
                            } else {
                                reject(new Error(json.reason || '查询失败'));
                            }
                        } else if (service.name === 'ipinfo') {
                            resolve({
                                country: json.country_name || json.country,
                                countryCode: json.country,
                                city: json.city,
                                lat: json.loc ? parseFloat(json.loc.split(',')[0]) : null,
                                lon: json.loc ? parseFloat(json.loc.split(',')[1]) : null,
                                ip: json.ip
                            });
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
        });
    }

    /**
     * 根据地理位置选择最近的 DNS/机房配置
     */
    selectOptimalDNS(channel, countryCode) {
        const channelConfig = this.dnsRules.channels[channel];
        if (!channelConfig) {
            throw new Error(`未找到通道 ${channel} 的配置`);
        }

        const regions = channelConfig.regions || {};
        const crossRegionRules = channelConfig.cross_region_rules || {};

        // 1. 优先选择同国家/地区的配置
        if (regions[countryCode]) {
            console.log(`✓ 选择同地区配置: ${regions[countryCode].name} (${countryCode})`);
            return regions[countryCode];
        }

        // 2. 检查跨区域规则，选择允许的最近地区
        const rules = crossRegionRules[countryCode];
        if (rules && rules.allowed_regions) {
            // 按优先级排序允许的地区
            const allowedRegions = rules.allowed_regions
                .map(code => ({ code, config: regions[code] }))
                .filter(r => r.config)
                .sort((a, b) => (a.config.priority || 999) - (b.config.priority || 999));

            if (allowedRegions.length > 0) {
                const selected = allowedRegions[0];
                console.log(`✓ 选择允许的最近地区: ${selected.config.name} (${selected.code})`);
                return selected.config;
            }
        }

        // 3. 如果没有匹配的规则，优先使用香港作为 fallback（通用 fallback）
        if (regions['HK']) {
            console.log(`⚠ 未找到匹配的地区配置，使用香港作为 fallback: ${regions['HK'].name} (HK)`);
            return regions['HK'];
        }

        // 4. 如果香港也不可用，选择优先级最高的配置
        const fallback = Object.values(regions)
            .sort((a, b) => (a.priority || 999) - (b.priority || 999))[0];
        
        if (fallback) {
            console.log(`⚠ 使用默认配置: ${fallback.name} (可能不是最优选择)`);
            return fallback;
        }

        throw new Error(`无法为通道 ${channel} 找到合适的 DNS 配置`);
    }

    /**
     * 生成 network_map.json
     */
    generateNetworkMap(geoInfo) {
        const mappings = {};
        const countryCode = geoInfo.countryCode;
        let fallbackUsed = false;
        const selectedConfigs = {};

        // 为每个通道生成 DNS 映射
        for (const [channelName, channelConfig] of Object.entries(this.dnsRules.channels)) {
            try {
                const selectedConfig = this.selectOptimalDNS(channelName, countryCode);
                selectedConfigs[channelName] = selectedConfig;
                
                // 检查是否使用了 fallback
                const hasExactMatch = channelConfig.regions && channelConfig.regions[countryCode];
                const crossRegionRules = channelConfig.cross_region_rules || {};
                const rules = crossRegionRules[countryCode];
                const hasAllowedRegion = rules && rules.allowed_regions && rules.allowed_regions.length > 0;
                
                if (!hasExactMatch && !hasAllowedRegion && selectedConfig.countryCode === 'HK') {
                    fallbackUsed = true;
                }
                
                // 为每个域名创建映射
                if (selectedConfig.api_domains && selectedConfig.dns_ips && selectedConfig.dns_ips.length > 0) {
                    const primaryIP = selectedConfig.dns_ips[0];
                    selectedConfig.api_domains.forEach(domain => {
                        mappings[domain] = primaryIP;
                    });
                    console.log(`  ✓ ${channelName}: ${selectedConfig.api_domains.length} 个域名映射到 ${primaryIP} (${selectedConfig.name})`);
                }
            } catch (e) {
                console.warn(`  ⚠ ${channelName}: ${e.message}`);
            }
        }

        const networkMap = {
            version: "1.0.0",
            last_updated: new Date().toISOString(),
            region: countryCode,
            detected_location: {
                country: geoInfo.country,
                countryCode: geoInfo.countryCode,
                city: geoInfo.city || null,
                ip: geoInfo.ip || this.publicIP
            },
            mappings: mappings,
            metadata: {
                provider: "Auto-detected",
                optimized_for: "Low Latency (RTT < 5ms)",
                auto_generated: true,
                fallback_used: fallbackUsed,
                note: fallbackUsed 
                    ? `当前使用香港作为 fallback（服务器位于 ${geoInfo.country}）。系统会根据服务器地理位置自动选择最近的 DNS/机房。运行 'node /home/node/jim/scripts/auto-detect-dns.js' 可重新检测。`
                    : `系统根据服务器地理位置（${geoInfo.country}）自动选择最近的 DNS/机房。运行 'node /home/node/jim/scripts/auto-detect-dns.js' 可重新检测。`
            }
        };

        return networkMap;
    }

    /**
     * 保存 network_map.json（同时保存到运行时路径和持久化路径）
     */
    saveNetworkMap(networkMap) {
        const jsonContent = JSON.stringify(networkMap, null, 2);
        let savedCount = 0;
        const errors = [];

        // 1. 保存到运行时路径（供 amy_resolver 快速访问）
        try {
            const runtimeDir = require('path').dirname(NETWORK_MAP_RUNTIME_PATH);
            if (!fs.existsSync(runtimeDir)) {
                fs.mkdirSync(runtimeDir, { recursive: true });
            }
            fs.writeFileSync(NETWORK_MAP_RUNTIME_PATH, jsonContent, 'utf8');
            console.log(`✓ 已保存到运行时路径: ${NETWORK_MAP_RUNTIME_PATH}`);
            savedCount++;
        } catch (e) {
            errors.push(`运行时路径: ${e.message}`);
        }

        // 2. 保存到持久化路径（仓库代码路径，不会被清空记忆时删除）
        try {
            const persistentDir = require('path').dirname(NETWORK_MAP_PERSISTENT_PATH);
            if (!fs.existsSync(persistentDir)) {
                fs.mkdirSync(persistentDir, { recursive: true });
            }
            fs.writeFileSync(NETWORK_MAP_PERSISTENT_PATH, jsonContent, 'utf8');
            console.log(`✓ 已保存到持久化路径: ${NETWORK_MAP_PERSISTENT_PATH}`);
            savedCount++;
        } catch (e) {
            errors.push(`持久化路径: ${e.message}`);
        }

        if (savedCount === 0) {
            console.error(`✗ 保存 network_map.json 失败:`);
            errors.forEach(err => console.error(`   - ${err}`));
            return false;
        } else if (savedCount === 1) {
            console.warn(`⚠ 只保存到 ${savedCount} 个位置，部分路径保存失败:`);
            errors.forEach(err => console.warn(`   - ${err}`));
        }

        return true;
    }

    /**
     * 主执行流程
     */
    async run() {
        console.log('=== 自动 DNS 检测和配置 ===\n');

        try {
            // 1. 获取公网 IP
            const ip = await this.getPublicIP();

            // 2. 获取地理位置信息
            const geoInfo = await this.getGeoInfo(ip);

            // 3. 生成 network_map.json
            console.log('\n生成 DNS 映射配置...');
            const networkMap = this.generateNetworkMap(geoInfo);

            // 4. 保存配置
            console.log('\n保存配置...');
            if (this.saveNetworkMap(networkMap)) {
                console.log('\n✓ DNS 自动配置完成！');
                console.log(`\n检测结果:`);
                console.log(`  公网 IP: ${ip}`);
                console.log(`  地理位置: ${geoInfo.country} (${geoInfo.countryCode})`);
                console.log(`  城市: ${geoInfo.city || '未知'}`);
                console.log(`  已配置 ${Object.keys(networkMap.mappings).length} 个域名映射`);
                return 0;
            } else {
                return 1;
            }
        } catch (e) {
            console.error(`\n✗ 错误: ${e.message}`);
            return 1;
        }
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const detector = new AutoDNSDetector();
    detector.run().then(code => process.exit(code));
}

module.exports = AutoDNSDetector;
