#!/usr/bin/env node
/**
 * STGBLOG X (Twitter) Content Scraper v2.0
 *
 * 方案: 直接调用 X 内部 GraphQL API（使用登录 cookie）
 * - 免费、无需 X API 付费
 * - 只搬运纯文字
 * - 每条注明原作者和原文链接
 * - GitHub Actions 每30分钟自动运行
 *
 * 合法性:
 * - 仅抓取公开可见内容
 * - 标注原作者 + 原文链接
 * - 不搬运多媒体
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ─── Config ───
const CONFIG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf-8"));
const STATE_FILE = new URL("./state.json", import.meta.url);

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dbtdguasdbmlzpodfeht.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  "sb_publishable_skyyIapm1MfIpT5R5NcleQ_-reVf604";
const TWITTER_COOKIE = process.env.TWITTER_COOKIE || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── X API Constants ───
const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const GRAPHQL_BASE = "https://x.com/i/api/graphql";

// ─── State ───
function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return { accounts: {} };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── X API Client ───
function parseCookies(cookieStr) {
  const cookies = {};
  for (const part of cookieStr.split(";")) {
    const [key, ...vals] = part.trim().split("=");
    if (key && vals.length) cookies[key.trim()] = vals.join("=").trim();
  }
  return cookies;
}

function buildHeaders(cookieStr) {
  const cookies = parseCookies(cookieStr);
  return {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    Cookie: cookieStr,
    "x-csrf-token": cookies.ct0 || "",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://x.com/",
    "Content-Type": "application/json",
  };
}

// Step 1: Get user ID from screen name
async function getUserId(screenName, headers) {
  const variables = JSON.stringify({
    screen_name: screenName,
    withSafetyModeUserFields: true,
  });
  const features = JSON.stringify({
    hidden_profile_subscriptions_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });

  const url = `${GRAPHQL_BASE}/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  console.log(`  📡 Requesting UserByScreenName for @${screenName}...`);
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  const rawBody = await res.text();
  console.log(`  📊 HTTP ${res.status} | Body length: ${rawBody.length}`);

  if (!res.ok) {
    console.log(`  🔍 Response (first 500):`, rawBody.slice(0, 500));
    throw new Error(`UserByScreenName failed: HTTP ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    console.log(`  🔍 JSON parse failed. Body (first 500):`, rawBody.slice(0, 500));
    throw new Error(`UserByScreenName: invalid JSON response`);
  }
  const user = data?.data?.user?.result;
  if (!user?.rest_id) {
    throw new Error(`User @${screenName} not found`);
  }

  return {
    id: user.rest_id,
    name: user.legacy?.name || screenName,
    description: user.legacy?.description || "",
  };
}

// Step 2: Get user tweets
async function getUserTweets(userId, cursor, headers) {
  const variables = JSON.stringify({
    userId,
    count: 20,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
    ...(cursor ? { cursor } : {}),
  });
  const features = JSON.stringify({
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });

  const url = `${GRAPHQL_BASE}/UserTweets?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`UserTweets failed: HTTP ${res.status}`);
  }

  return await res.json();
}

// Parse tweet from X API response
function parseTweet(tweetResult) {
  const tweet = tweetResult?.tweet || tweetResult;
  const legacy = tweet?.legacy;

  if (!legacy || !legacy.full_text) return null;

  // Skip retweets (we want original content)
  if (legacy.retweeted_status_result) return null;

  // Clean content: remove t.co media URLs
  let text = legacy.full_text;
  if (legacy.entities?.urls) {
    for (const url of legacy.entities.urls) {
      text = text.replace(url.url, url.expanded_url || "");
    }
  }
  // Remove media URLs
  if (legacy.entities?.media) {
    for (const m of legacy.entities.media) {
      text = text.replace(m.url, "");
    }
  }
  text = text.replace(/\s+/g, " ").trim();

  const tweetId = legacy.id_str || tweet.rest_id;
  const author = legacy.user_results?.result?.legacy?.screen_name || "unknown";
  const authorName = legacy.user_results?.result?.legacy?.name || author;
  const createdAt = legacy.created_at;

  return { tweetId, text, author, authorName, createdAt };
}

// Extract tweets from timeline response
function extractTweets(apiResponse) {
  const tweets = [];
  const instructions =
    apiResponse?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
    apiResponse?.data?.user?.result?.timeline?.timeline?.instructions ||
    [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" || instruction.type === "TimelineAddToModule") {
      const entries = instruction.entries || instruction.moduleItems || [];
      for (const entry of entries) {
        // Handle cursor entries
        if (entry.entryId?.startsWith("cursor-bottom")) continue;
        if (entry.entryId?.startsWith("cursor-top")) continue;

        // Handle tweet entries
        const tweetResult =
          entry.content?.itemContent?.tweet_results?.result ||
          entry.content?.items?.[0]?.item?.itemContent?.tweet_results?.result;

        if (tweetResult) {
          const parsed = parseTweet(tweetResult);
          if (parsed) tweets.push(parsed);
        }
      }
    }
  }

  return tweets;
}

// Extract bottom cursor for pagination
function extractCursor(apiResponse) {
  const instructions =
    apiResponse?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
    apiResponse?.data?.user?.result?.timeline?.timeline?.instructions ||
    [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries") {
      for (const entry of instruction.entries || []) {
        if (entry.entryId?.startsWith("cursor-bottom")) {
          return entry.content?.value;
        }
      }
    }
  }
  return null;
}

// ─── Supabase Operations ───
async function insertPost(tweet) {
  const link = `https://x.com/${tweet.author}/status/${tweet.tweetId}`;

  const postData = {
    title: `[@${tweet.author}] ${tweet.text.slice(0, 50)}${tweet.text.length > 50 ? "..." : ""}`,
    content: `📢 @${tweet.author}\n\n${tweet.text}\n\n🔗 原文: ${link}`,
    author: `@${tweet.author}`,
    category: CONFIG.category || "X搬运",
    likes: 0,
    views: 0,
    reposts: 0,
    pinned: false,
    edited: false,
  };

  const { data, error } = await supabase.from("posts").insert([postData]).select("*").single();

  if (error) {
    if (error.code === "23505" || error.message?.includes("duplicate")) {
      return null;
    }
    throw new Error(`Supabase error: ${error.message}`);
  }

  return data;
}

// ─── Main ───
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeAccount(screenName, state, headers) {
  console.log(`\n🐦 Scraping @${screenName}...`);

  if (!state.accounts[screenName]) {
    state.accounts[screenName] = { lastId: "0", totalImported: 0 };
  }
  const lastId = state.accounts[screenName].lastId || "0";
  console.log(`  📌 Last ID: ${lastId}`);

  // Get user ID
  let userInfo;
  try {
    userInfo = await getUserId(screenName, headers);
    console.log(`  👤 Found: ${userInfo.name} (ID: ${userInfo.id})`);
  } catch (e) {
    console.log(`  ❌ Failed to get user: ${e.message}`);
    return 0;
  }

  // Get tweets
  let apiResponse;
  try {
    apiResponse = await getUserTweets(userInfo.id, null, headers);
  } catch (e) {
    console.log(`  ❌ Failed to get tweets: ${e.message}`);
    return 0;
  }

  const tweets = extractTweets(apiResponse);
  console.log(`  📰 Found ${tweets.length} tweets`);

  // Filter new tweets
  const newTweets = tweets.filter((t) => BigInt(t.tweetId) > BigInt(lastId));
  console.log(`  🆕 ${newTweets.length} new tweets`);

  if (newTweets.length === 0) return 0;

  // Sort ascending by ID
  newTweets.sort((a, b) => (BigInt(a.tweetId) < BigInt(b.tweetId) ? -1 : 1));

  // Limit batch
  const batch = newTweets.slice(0, CONFIG.batchSize || 15);

  let imported = 0;
  let maxId = lastId;

  for (const tweet of batch) {
    if (!tweet.text || tweet.text.length < 5) continue;

    try {
      const result = await insertPost(tweet);
      if (result) {
        imported++;
        console.log(`  ✅ [${tweet.tweetId}] ${tweet.text.slice(0, 60)}...`);
      }
      if (BigInt(tweet.tweetId) > BigInt(maxId)) maxId = tweet.tweetId;
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }

    await sleep(500);
  }

  state.accounts[screenName] = {
    lastId: maxId,
    lastRun: new Date().toISOString(),
    totalImported: (state.accounts[screenName]?.totalImported || 0) + imported,
  };

  return imported;
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  STGBLOG X Scraper v2.0");
  console.log("═══════════════════════════════════════\n");

  const accounts = CONFIG.accounts || [];

  if (accounts.length === 0) {
    console.log("⚠️  No accounts configured.");
    console.log('   Edit config.json: "accounts": ["username1", "username2"]');
    process.exit(0);
  }

  if (!TWITTER_COOKIE) {
    console.log("❌ TWITTER_COOKIE not set!");
    console.log("   Set it as a GitHub Secret or environment variable.");
    console.log("   Format: auth_token=xxx; ct0=yyy");
    process.exit(1);
  }

  // Debug: show cookie format (masked)
  const parts = TWITTER_COOKIE.split(";").map(s => s.trim());
  console.log(`🔑 Cookie parts: ${parts.length}`);
  for (const p of parts) {
    const [k] = p.split("=");
    console.log(`   ${k}: ${p.length > 20 ? p.slice(0, 10) + "..." + p.slice(-5) : p}`);
  }

  console.log(`📋 Accounts: ${accounts.map((a) => "@" + a).join(", ")}`);
  const headers = buildHeaders(TWITTER_COOKIE);
  const state = loadState();
  let total = 0;

  for (const account of accounts) {
    try {
      total += await scrapeAccount(account, state, headers);
    } catch (e) {
      console.log(`\n❌ Fatal for @${account}: ${e.message}`);
    }
    if (accounts.indexOf(account) < accounts.length - 1) await sleep(2000);
  }

  saveState(state);

  console.log("\n═══════════════════════════════════════");
  console.log(`  ✅ Done! Imported ${total} new post(s)`);
  console.log("═══════════════════════════════════════");
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
