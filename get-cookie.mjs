#!/usr/bin/env node
/**
 * 获取 X (Twitter) Cookie 的辅助说明
 *
 * 运行: node get-cookie.mjs
 */

console.log(`
╔══════════════════════════════════════════════════╗
║   如何获取 X (Twitter) Cookie                     ║
╚══════════════════════════════════════════════════╝

🔑 你需要获取两个值: auth_token 和 ct0

📋 步骤:

  1. 用 Chrome 打开 https://x.com 并登录你的账号

  2. 按 F12 打开开发者工具

  3. 切换到 "Application" (应用) 标签

  4. 左侧找到 "Cookies" → "https://x.com"

  5. 找到并复制这两个值:
     - auth_token  (长字符串，如: 1a2b3c4d5e6f...)
     - ct0         (长字符串，如: abc123def456...)

  6. 组合成 Cookie 格式:
     auth_token=你复制的值; ct0=你复制的值

⚠️  注意:
  - Cookie 有效期通常为几个月，过期后需要重新获取
  - 如果搬运停止工作，大概率是 Cookie 过期了
  - 重新获取一次即可，state.json 会记住已搬运的帖子

🔒 安全:
  - Cookie 只存在 GitHub Secrets 中，不会泄露
  - 不要分享给任何人

📝 设置 GitHub Secrets:

  进入仓库 → Settings → Secrets and variables → Actions → New repository secret

  添加以下 Secrets:
  ┌─────────────────┬──────────────────────────────────┐
  │ Name            │ Value                            │
  ├─────────────────┼──────────────────────────────────┤
  │ SUPABASE_URL    │ https://dbtdguasdbmlzpodfeht...  │
  │ SUPABASE_KEY    │ sb_publishable_...               │
  │ TWITTER_COOKIE  │ auth_token=xxx; ct0=yyy          │
  └─────────────────┴──────────────────────────────────┘
`);
