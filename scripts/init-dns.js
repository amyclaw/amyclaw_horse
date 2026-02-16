#!/usr/bin/env node

/**
 * DNS 初始化脚本
 * 在系统启动时自动检测并配置 DNS
 * 如果 network_map.json 不存在或已过期，则自动重新检测
 */

const fs = require('fs');
const path = require('path');
const AutoDNSDetector = require('./auto-detect-dns');

// 运行时路径和持久化路径
const NETWORK_MAP_RUNTIME_PATH = '/home/node/.openclaw/workspace/memory/network_map.json';
const NETWORK_MAP_PERSISTENT_PATH = '/home/node/jim/config/workspace/memory/network_map.json';
const MAX_AGE_HOURS = 24; // 24 小时后重新检测

class DNSInitializer {
    constructor() {
        this.detector = new AutoDNSDetector();
    }

    /**
     * 检查 network_map.json 是否需要更新
     * 优先检查运行时路径，如果不存在则检查持久化路径
     */
    needsUpdate() {
        // 优先检查运行时路径
        let configPath = NETWORK_MAP_RUNTIME_PATH;
        if (!fs.existsSync(configPath)) {
            // 运行时路径不存在，检查持久化路径
            if (fs.existsSync(NETWORK_MAP_PERSISTENT_PATH)) {
                console.log('运行时 network_map.json 不存在，但找到持久化配置，将复制到运行时路径');
                configPath = NETWORK_MAP_PERSISTENT_PATH;
                // 尝试复制持久化配置到运行时路径
                try {
                    const persistentDir = require('path').dirname(NETWORK_MAP_RUNTIME_PATH);
                    if (!fs.existsSync(persistentDir)) {
                        fs.mkdirSync(persistentDir, { recursive: true });
                    }
                    fs.copyFileSync(NETWORK_MAP_PERSISTENT_PATH, NETWORK_MAP_RUNTIME_PATH);
                    console.log(`✓ 已从持久化路径复制到运行时路径`);
                } catch (e) {
                    console.warn(`⚠ 复制持久化配置失败: ${e.message}，将继续使用持久化路径`);
                }
            } else {
                console.log('network_map.json 不存在（运行时和持久化路径都不存在），需要初始化');
                return true;
            }
        }

        try {
            const data = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(data);
            
            if (!config.last_updated) {
                console.log('network_map.json 缺少更新时间，需要更新');
                return true;
            }

            const lastUpdated = new Date(config.last_updated);
            const now = new Date();
            const ageHours = (now - lastUpdated) / (1000 * 60 * 60);

            if (ageHours > MAX_AGE_HOURS) {
                console.log(`network_map.json 已过期 (${ageHours.toFixed(1)} 小时)，需要更新`);
                return true;
            }

            console.log(`network_map.json 仍然有效 (${ageHours.toFixed(1)} 小时前更新，来源: ${configPath === NETWORK_MAP_RUNTIME_PATH ? '运行时' : '持久化'})`);
            return false;
        } catch (e) {
            console.warn(`检查 network_map.json 时出错: ${e.message}，将重新生成`);
            return true;
        }
    }

    /**
     * 初始化 DNS 配置
     */
    async initialize() {
        console.log('=== DNS 初始化 ===\n');

        if (!this.needsUpdate()) {
            console.log('✓ DNS 配置已是最新，跳过初始化');
            return 0;
        }

        console.log('开始自动检测和配置 DNS...\n');
        return await this.detector.run();
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const initializer = new DNSInitializer();
    initializer.initialize().then(code => process.exit(code));
}

module.exports = DNSInitializer;
