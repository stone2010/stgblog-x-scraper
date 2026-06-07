#!/usr/bin/env node
/**
 * STGBLOG X Scraper v4.0
 *
 * 使用 yt-dlp 提取 X 帖子（最可靠的免费方案）
 * yt-dlp 有专门的 Twitter/X 提取器，能绕过大部分限制
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const CONFIG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf-8"));
const STATE_FILE = new URL("./state.json", import.meta.url);
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dbtdguasdbmlzpodfeht.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_skyyIapm1MfIpT5R5NcleQ_-reVf604";
const TWITTER_COOKIE = process.env.TWITTER_COOKIE || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── State ───
function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  return { accounts: {} };
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Fetch user timeline via yt-dlp ───
function fetchTimelineYtdlp(screenName) {
  console.log(`  📡 yt-dlp: fetching @${screenName} timeline...`);

  // Write cookie file if available
  let cookieArgs = "";
  if (TWITTER_COOKIE) {
    const cookieFile = "/tmp/x_cookies.txt";
    // Convert "auth_token=xxx; ct0=yyy" to Netscape cookie format
    const parts = TWITTER_COOKIE.split(";").map(s => s.trim());
    let cookieContent = "# Netscape HTTP Cookie File\n";
    for (const p of parts) {
      const [name, ...vals] = p.split("=");
      const value = vals.join("=");
      cookieContent += `.x.com\tTRUE\t/\tTRUE\t2000000000\t${name.trim()}\t${value.trim()}\n`;
    }
    writeFileSync(cookieFile, cookieContent);
    cookieArgs = `--cookies "${cookieFile}"`;
  }

  // Use yt-dlp to get the user's timeline JSON
  // yt-dlp can extract tweet metadata without downloading media
  const url = `https://x.com/${screenName}`;

  try {
    const cmd = [
      "yt-dlp",
      "--dump-json",
      "--flat-playlist",
      "--no-download",
      "--no-warnings",
      cookieArgs,
      "--socket-timeout 15",
      `"${url}"`,
    ].filter(Boolean).join(" ");

    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Each line is a JSON object for one tweet
    const tweets = [];
    for (const line of result.split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        tweets.push({
          tweetId: item.id || item.url?.match(/status\/(\d+)/)?.[1] || "",
          text: item.description || item.title || "",
          author: screenName,
          authorName: item.uploader || item.channel || screenName,
          timestamp: item.timestamp || 0,
        });
      } catch {}
    }
    return tweets;
  } catch (e) {
    console.log(`  ⚠️ yt-dlp error: ${e.message?.slice(0, 200)}`);
    return null;
  }
}

// ─── Alternative: fetch via RSS with cookie ───
function fetchTimelineRss(screenName) {
  console.log(`  📡 RSS fallback for @${screenName}...`);
  try {
    // Use rsshub.app with cookie forwarding (it may work)
    const cmd = `curl -sL --max-time 15 -H "User-Agent: Mozilla/5.0" "https://rsshub.app/twitter/user/${screenName}" 2>&1`;
    const result = execSync(cmd, { encoding: "utf-8", timeout: 20000 });
    if (result.includes("<item>")) {
      const items = [];
      const re = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = re.exec(result)) !== null) {
        const block = m[1];
        const title = extractTag(block, "title");
        const link = extractTag(block, "link");
        const desc = extractTag(block, "description");
        const tweetId = link.match(/status\/(\d+)/)?.[1];
        if (tweetId) {
          const text = desc.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
          items.push({ tweetId, text, author: screenName, authorName: screenName });
        }
      }
      return items;
    }
  } catch {}
  return null;
}

function extractTag(xml, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cm = xml.match(cdataRe);
  if (cm) return cm[1].trim();
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
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

async function scrapeAccount(screenName, state) {
  console.log(`\n🐦 @${screenName}`);
  if (!state.accounts[screenName]) state.accounts[screenName] = { lastId: "0", totalImported: 0 };
  const lastId = state.accounts[screenName].lastId || "0";
  console.log(`  📌 Last ID: ${lastId}`);

  // Try yt-dlp first, then RSS
  let tweets = fetchTimelineYtdlp(screenName);
  if (!tweets || tweets.length === 0) {
    tweets = fetchTimelineRss(screenName);
  }
  if (!tweets || tweets.length === 0) {
    console.log(`  ❌ No tweets found for @${screenName}`);
    return 0;
  }

  console.log(`  📰 Found ${tweets.length} tweets`);

  const newTweets = tweets.filter((t) => t.tweetId && BigInt(t.tweetId) > BigInt(lastId));
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

  state.accounts[screenName] = {
    lastId: maxId, lastRun: new Date().toISOString(),
    totalImported: (state.accounts[screenName]?.totalImported || 0) + imported,
  };
  return imported;
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  STGBLOG X Scraper v4.0");
  console.log("═══════════════════════════════════════\n");

  const accounts = CONFIG.accounts || [];
  if (accounts.length === 0) { console.log("⚠️  No accounts."); process.exit(0); }

  // Check yt-dlp availability
  try {
    const ver = execSync("yt-dlp --version", { encoding: "utf-8" }).trim();
    console.log(`🔧 yt-dlp v${ver}`);
  } catch {
    console.log("❌ yt-dlp not found! Install it first.");
    process.exit(1);
  }

  console.log(`📋 Accounts: ${accounts.map((a) => "@" + a).join(", ")}`);
  const state = loadState();
  let total = 0;

  for (const account of accounts) {
    try { total += await scrapeAccount(account, state); }
    catch (e) { console.log(`\n❌ ${e.message}`); }
    if (accounts.indexOf(account) < accounts.length - 1) await sleep(2000);
  }

  saveState(state);
  console.log("\n═══════════════════════════════════════");
  console.log(`  ✅ Done! Imported ${total} new post(s)`);
  console.log("═══════════════════════════════════════");
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
