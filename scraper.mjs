#!/usr/bin/env node
/**
 * STGBLOG X (Twitter) Content Scraper v3.0
 *
 * 使用 X 内部 API + Cookie + Guest Token
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const CONFIG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf-8"));
const STATE_FILE = new URL("./state.json", import.meta.url);

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dbtdguasdbmlzpodfeht.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  "sb_publishable_skyyIapm1MfIpT5R5NcleQ_-reVf604";
const TWITTER_COOKIE = process.env.TWITTER_COOKIE || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// ─── State ───
function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  return { accounts: {} };
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Cookie parsing ───
function parseCookies(str) {
  const c = {};
  for (const p of str.split(";")) {
    const [k, ...v] = p.trim().split("=");
    if (k && v.length) c[k.trim()] = v.join("=").trim();
  }
  return c;
}

// ─── Get Guest Token (fallback) ───
async function getGuestToken() {
  try {
    const res = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.guest_token;
    }
  } catch (e) {
    console.log(`  ⚠️ Guest token failed: ${e.message}`);
  }
  return null;
}

// ─── Build request headers ───
function buildHeaders(cookieStr, guestToken) {
  const cookies = parseCookies(cookieStr);
  const h = {
    Authorization: `Bearer ${BEARER_TOKEN}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://x.com/",
    "Content-Type": "application/json",
  };

  if (cookieStr) {
    h.Cookie = cookieStr;
    if (cookies.ct0) h["x-csrf-token"] = cookies.ct0;
    h["x-twitter-auth-type"] = "OAuth2Session";
    h["x-twitter-active-user"] = "yes";
    h["x-twitter-client-language"] = "en";
  }

  if (guestToken) {
    h["x-guest-token"] = guestToken;
  }

  return h;
}

// ─── Try to get user ID via multiple methods ───
async function getUserId(screenName, headers) {
  // Method 1: GraphQL API
  const variables = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
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

  const url = `https://x.com/i/api/graphql/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  console.log(`  📡 GraphQL: UserByScreenName @${screenName}`);
  let res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  let body = await res.text();
  console.log(`  📊 HTTP ${res.status} | Body: ${body.length} bytes`);

  if (body.length > 0) {
    try {
      const data = JSON.parse(body);
      const user = data?.data?.user?.result;
      if (user?.rest_id) {
        return { id: user.rest_id, name: user.legacy?.name || screenName };
      }
    } catch {}
  }

  // Method 2: Try the v1.1 API endpoint
  console.log(`  📡 Trying v1.1 API...`);
  const v1Url = `https://api.twitter.com/1.1/users/show.json?screen_name=${screenName}`;
  res = await fetch(v1Url, { headers, signal: AbortSignal.timeout(15000) });
  body = await res.text();
  console.log(`  📊 v1.1 HTTP ${res.status} | Body: ${body.length} bytes`);

  if (res.ok && body.length > 0) {
    try {
      const data = JSON.parse(body);
      if (data.id_str) {
        return { id: data.id_str, name: data.name || screenName };
      }
    } catch {}
  }

  // Method 3: Try Twitter syndication/embed
  console.log(`  📡 Trying syndication API...`);
  const synUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${screenName}`;
  res = await fetch(synUrl, {
    headers: { ...headers, Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  body = await res.text();
  console.log(`  📊 Syndication HTTP ${res.status} | Body: ${body.length} bytes`);

  if (body.length > 100) {
    // Extract tweet data from syndication HTML
    const tweetMatches = [...body.matchAll(/data-tweet-id="(\d+)"/g)];
    if (tweetMatches.length > 0) {
      return { id: "syndication", name: screenName, syndication: true, html: body };
    }
  }

  throw new Error(`Could not find user @${screenName} via any method`);
}

// ─── Get user tweets ───
async function getUserTweets(userId, headers) {
  if (userId === "syndication") return null; // handled separately

  const variables = JSON.stringify({
    userId,
    count: 20,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
    withV2Timeline: true,
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

  const url = `https://x.com/i/api/graphql/UserTweets?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const body = await res.text();
  console.log(`  📊 UserTweets HTTP ${res.status} | Body: ${body.length} bytes`);

  if (!res.ok || body.length === 0) return null;
  return JSON.parse(body);
}

// Parse syndication HTML for tweets
function parseSyndicationHtml(html, screenName) {
  const tweets = [];
  // Match tweet blocks in syndication HTML
  const tweetBlocks = html.match(/<div[^>]*class="[^"]*timeline-Tweet[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];

  for (const block of tweetBlocks) {
    const idMatch = block.match(/data-tweet-id="(\d+)"/);
    const textMatch = block.match(/<p[^>]*class="[^"]*timeline-Tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    if (idMatch && textMatch) {
      let text = textMatch[1].replace(/<[^>]+>/g, "").trim();
      text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (text.length > 5) {
        tweets.push({ tweetId: idMatch[1], text, author: screenName, authorName: screenName });
      }
    }
  }
  return tweets;
}

// Parse tweets from GraphQL response
function parseTweets(apiResponse) {
  const tweets = [];
  const instructions =
    apiResponse?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
    apiResponse?.data?.user?.result?.timeline?.timeline?.instructions ||
    [];

  for (const instruction of instructions) {
    if (instruction.type === "TimelineAddEntries" || instruction.type === "TimelineAddToModule") {
      for (const entry of instruction.entries || instruction.moduleItems || []) {
        if (entry.entryId?.startsWith("cursor")) continue;
        const tweetResult =
          entry.content?.itemContent?.tweet_results?.result ||
          entry.content?.items?.[0]?.item?.itemContent?.tweet_results?.result;
        if (tweetResult) {
          const t = tweetResult?.tweet || tweetResult;
          const legacy = t?.legacy;
          if (!legacy?.full_text || legacy.retweeted_status_result) continue;
          let text = legacy.full_text;
          if (legacy.entities?.urls) for (const u of legacy.entities.urls) text = text.replace(u.url, u.expanded_url || "");
          if (legacy.entities?.media) for (const m of legacy.entities.media) text = text.replace(m.url, "");
          text = text.replace(/\s+/g, " ").trim();
          const author = legacy.user_results?.result?.legacy?.screen_name || "unknown";
          const authorName = legacy.user_results?.result?.legacy?.name || author;
          tweets.push({ tweetId: legacy.id_str || t.rest_id, text, author, authorName });
        }
      }
    }
  }
  return tweets;
}

// ─── Supabase ───
async function insertPost(tweet) {
  const link = `https://x.com/${tweet.author}/status/${tweet.tweetId}`;
  const postData = {
    title: `[@${tweet.author}] ${tweet.text.slice(0, 50)}${tweet.text.length > 50 ? "..." : ""}`,
    content: `📢 @${tweet.author}\n\n${tweet.text}\n\n🔗 原文: ${link}`,
    author: `@${tweet.author}`,
    category: CONFIG.category || "X搬运",
    likes: 0, views: 0, reposts: 0, pinned: false, edited: false,
  };
  const { data, error } = await supabase.from("posts").insert([postData]).select("*").single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`Supabase: ${error.message}`);
  }
  return data;
}

// ─── Main ───
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeAccount(screenName, state, headers) {
  console.log(`\n🐦 @${screenName}`);
  if (!state.accounts[screenName]) state.accounts[screenName] = { lastId: "0", totalImported: 0 };
  const lastId = state.accounts[screenName].lastId || "0";
  console.log(`  📌 Last ID: ${lastId}`);

  let userInfo;
  try {
    userInfo = await getUserId(screenName, headers);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    return 0;
  }
  console.log(`  👤 ${userInfo.name} (ID: ${userInfo.id})`);

  let tweets;
  if (userInfo.syndication) {
    tweets = parseSyndicationHtml(userInfo.html, screenName);
    console.log(`  📰 Syndication: ${tweets.length} tweets`);
  } else {
    const apiRes = await getUserTweets(userInfo.id, headers);
    if (!apiRes) { console.log(`  ❌ Failed to get tweets`); return 0; }
    tweets = parseTweets(apiRes);
    console.log(`  📰 GraphQL: ${tweets.length} tweets`);
  }

  const newTweets = tweets.filter((t) => BigInt(t.tweetId) > BigInt(lastId));
  console.log(`  🆕 ${newTweets.length} new`);
  if (newTweets.length === 0) return 0;

  newTweets.sort((a, b) => (BigInt(a.tweetId) < BigInt(b.tweetId) ? -1 : 1));
  const batch = newTweets.slice(0, CONFIG.batchSize || 15);

  let imported = 0;
  let maxId = lastId;
  for (const tweet of batch) {
    if (!tweet.text || tweet.text.length < 5) continue;
    try {
      const result = await insertPost(tweet);
      if (result) { imported++; console.log(`  ✅ ${tweet.text.slice(0, 60)}...`); }
      if (BigInt(tweet.tweetId) > BigInt(maxId)) maxId = tweet.tweetId;
    } catch (e) { console.log(`  ❌ ${e.message}`); }
    await sleep(500);
  }

  state.accounts[screenName] = { lastId: maxId, lastRun: new Date().toISOString(), totalImported: (state.accounts[screenName]?.totalImported || 0) + imported };
  return imported;
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  STGBLOG X Scraper v3.0");
  console.log("═══════════════════════════════════════\n");

  const accounts = CONFIG.accounts || [];
  if (accounts.length === 0) { console.log("⚠️  No accounts. Edit config.json."); process.exit(0); }
  if (!TWITTER_COOKIE) { console.log("❌ TWITTER_COOKIE not set!"); process.exit(1); }

  console.log(`📋 Accounts: ${accounts.map((a) => "@" + a).join(", ")}`);

  // Try to get guest token as well
  const guestToken = await getGuestToken();
  if (guestToken) console.log(`🔑 Guest token: ${guestToken.slice(0, 10)}...`);

  const headers = buildHeaders(TWITTER_COOKIE, guestToken);
  const state = loadState();
  let total = 0;

  for (const account of accounts) {
    try { total += await scrapeAccount(account, state, headers); }
    catch (e) { console.log(`\n❌ ${e.message}`); }
    if (accounts.indexOf(account) < accounts.length - 1) await sleep(2000);
  }

  saveState(state);
  console.log("\n═══════════════════════════════════════");
  console.log(`  ✅ Done! Imported ${total} new post(s)`);
  console.log("═══════════════════════════════════════");
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
