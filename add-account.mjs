#!/usr/bin/env node
/**
 * 账号管理工具 - 添加/删除要搬运的 X 账号
 *
 * 用法:
 *   node add-account.mjs add <username>    添加账号
 *   node add-account.mjs remove <username> 删除账号
 *   node add-account.mjs list              查看所有账号
 */

import { readFileSync, writeFileSync } from "fs";

const configPath = new URL("./config.json", import.meta.url);
const config = JSON.parse(readFileSync(configPath, "utf-8"));
node add-account.mjs add <Morris>
node add-account.mjs add <LanLan>

const [action, username] = process.argv.slice(2);

switch (action) {
  case "add": {
    if (!username) {
      console.log("❌ 请提供用户名: node add-account.mjs add <username>");
      process.exit(1);
    }
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    if (config.accounts.includes(clean)) {
      console.log(`⚠️  @${clean} 已经在列表中`);
    } else {
      config.accounts.push(clean);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`✅ 已添加 @${clean}`);
    }
    break;
  }

  case "remove": {
    if (!username) {
      console.log("❌ 请提供用户名: node add-account.mjs remove <username>");
      process.exit(1);
    }
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    const idx = config.accounts.indexOf(clean);
    if (idx === -1) {
      console.log(`⚠️  @${clean} 不在列表中`);
    } else {
      config.accounts.splice(idx, 1);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`✅ 已移除 @${clean}`);
    }
    break;
  }

  case "list":
  default: {
    if (config.accounts.length === 0) {
      console.log("📋 暂无跟踪账号");
      console.log("   使用: node add-account.mjs add <username>");
    } else {
      console.log(`📋 跟踪 ${config.accounts.length} 个账号:`);
      config.accounts.forEach((a, i) => console.log(`   ${i + 1}. @${a}`));
    }
    break;
  }
}
