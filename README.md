# STGBLOG X (Twitter) Content Scraper

全自动、免费的 X 帖子搬运工具，将 X 上的帖子自动搬运到 STGBLOG。

## 🏗️ 工作原理

```
X (Twitter) API (免费) ← Cookie 认证
        ↓
   GitHub Actions (每30分钟)
        ↓
   Supabase 数据库
        ↓
   STGBLOG 展示
```

## ✨ 特性

- ✅ 全自动运行（GitHub Actions 定时任务）
- ✅ 完全免费（无需 X API 付费）
- ✅ 只搬运纯文字内容
- ✅ 每条帖子标注原作者 + 原文链接
- ✅ 去重（不会重复搬运）
- ✅ 支持多个账号同时搬运

## 🚀 快速开始

### 1. 添加要搬运的账号

编辑 `config.json`:

```json
{
  "accounts": ["elonmusk", "sama", "openai"],
  "category": "X搬运",
  "batchSize": 15
}
```

### 2. 获取 X Cookie

```bash
node get-cookie.mjs
```

简要说明：
1. Chrome 打开 x.com 并登录
2. F12 → Application → Cookies → x.com
3. 复制 `auth_token` 和 `ct0`
4. 组合: `auth_token=xxx; ct0=yyy`

### 3. 设置 GitHub Secrets

进入仓库 → Settings → Secrets → Actions，添加:

| Secret | 说明 |
|--------|------|
| `SUPABASE_URL` | `https://dbtdguasdbmlzpodfeht.supabase.co` |
| `SUPABASE_KEY` | Supabase anon publishable key |
| `TWITTER_COOKIE` | `auth_token=xxx; ct0=yyy` |

### 4. 推送代码

```bash
git add .
git commit -m "feat: add x scraper"
git push
```

GitHub Actions 会每30分钟自动运行。

## 📦 文件说明

| 文件 | 用途 |
|------|------|
| `scraper.mjs` | 主爬虫脚本 |
| `config.json` | 配置文件 |
| `add-account.mjs` | 账号管理工具 |
| `get-cookie.mjs` | Cookie 获取说明 |
| `state.json` | 运行状态（自动生成）|
| `.github/workflows/scrape.yml` | GitHub Actions 配置 |

## 🔧 账号管理

```bash
# 添加账号
node add-account.mjs add elonmusk

# 删除账号
node add-account.mjs remove elonmusk

# 查看列表
node add-account.mjs list
```

## 📝 搬运帖子格式

在 STGBLOG 上显示为:

```
📢 @original_author

[原帖文字内容]

🔗 原文: https://x.com/author/status/123456789
```

作者显示为 `@original_author`，与 X 上的用户名一致。

## ⚖️ 合法性

- ✅ 仅抓取公开可见的内容
- ✅ 每条帖子标注原作者和原文链接
- ✅ 不搬运图片/视频
- ✅ 遵守 fair use 原则
- ✅ 用户可随时要求删除

## ⚠️ 常见问题

**Q: Cookie 过期了怎么办？**
A: 重新获取一次 cookie 更新到 GitHub Secrets 即可。state.json 会记住进度。

**Q: 会不会被 X 封号？**
A: 正常使用不会。脚本有频率限制（每30分钟一次，每次最多15条）。

**Q: 能搬运多少个账号？**
A: 理论上不限，但建议不超过20个，避免触发频率限制。
