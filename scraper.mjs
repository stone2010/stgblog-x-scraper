#!/usr/bin/env node
/**
 * STGBLOG X Scraper v5.0
 *
 * 使用自建 RSSHub 实例 + Supabase
 * RSSHub 运行在 Docker 中，能可靠地抓取 X 内容
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const CONFIG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf-8"));
const STATE_FILE = new URL("./state.json", import.meta.url);
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dbtdguasdbmlzpodfeht.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_skyyIapm1MfIpT5R5NcleQ_-reVf604";
const RSSHUB_URL = process.env.RSSHUB_URL || "http://localhost:1200";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  return { accounts: {} };
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── RSS Fetching ───
async function fetchRSS(screenName) {
  const url = `${RSSHUB_URL}/twitter/user/${screenName}`;
  console.log(`  📡 RSSHub: ${url}`);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(25000),
      });

      if (res.status === 429) {
        console.log(`  ⏳ Rate limited, waiting ${(attempt + 1) * 5}s...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }

      if (res.status === 503) {
        console.log(`  ⚠️ 503, retrying in ${(attempt + 1) * 3}s...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }

      if (!res.ok) {
        console.log(`  ⚠️ HTTP ${res.status}`);
        return null;
      }

      const xml = await res.text();
      if (xml.includes("<item>")) return xml;
      console.log(`  ⚠️ No items in RSS feed`);
      return null;
    } catch (e) {
      console.log(`  ⚠️ ${e.message}`);
      if (attempt < 4) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

// ─── RSS Parsing ───
function parseRSSItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      description: extractTag(block, "description"),
      pubDate: extractTag(block, "pubDate"),
    });
  }
  return items;
}

function extractTag(xml, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cm = xml.match(cdataRe);
  if (cm) return cm[1].trim();
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function cleanContent(desc, title) {
  let text = desc;
  // Remove media embeds (video, img, hr dividers)
  text = text.replace(/<video[\s\S]*?<\/video>/gi, "");
  text = text.replace(/<img[^>]*>/gi, "");
  text = text.replace(/<hr[^>]*>/gi, "");
  // Remove links but keep link text
  text = text.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  // Remove all remaining HTML tags
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  // Decode HTML entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");
  // Clean whitespace
  text = text.replace(/\n\s*\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (text.length < 10 && title) text = title.replace(/^[^:]+:\s*/, "").trim();
  return text;
}

function extractTweetId(link) {
  const m = link.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function extractAuthor(link) {
  const m = link.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status/);
  return m ? m[1] : null;
}

// ─── Supabase ───
async function insertPost(author, tweetId, content, link) {
  const postData = {
    title: `[@${author}] ${content.slice(0, 50)}${content.length > 50 ? "..." : ""}`,
    content: `📢 @${author}\n\n${content}\n\n🔗 原文: ${link}`,
    author: `@${author}`,
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

  const xml = await fetchRSS(screenName);
  if (!xml) { console.log(`  ❌ Failed to fetch RSS`); return 0; }

  const items = parseRSSItems(xml);
  console.log(`  📰 ${items.length} items`);

  const newItems = items.filter((item) => {
    const tid = extractTweetId(item.link);
    return tid && BigInt(tid) > BigInt(lastId);
  });
  console.log(`  🆕 ${newItems.length} new`);
  if (newItems.length === 0) return 0;

  newItems.sort((a, b) => {
    const idA = BigInt(extractTweetId(a.link));
    const idB = BigInt(extractTweetId(b.link));
    return idA < idB ? -1 : 1;
  });

  const batch = newItems.slice(0, CONFIG.batchSize || 15);
  let imported = 0;
  let maxId = lastId;

  for (const item of batch) {
    const tweetId = extractTweetId(item.link);
    const content = cleanContent(item.description, item.title);
    if (!content || content.length < 5) continue;

    const author = extractAuthor(item.link) || screenName;
    const link = `https://x.com/${author}/status/${tweetId}`;

    try {
      const result = await insertPost(author, tweetId, content, link);
      if (result) { imported++; console.log(`  ✅ ${content.slice(0, 60)}...`); }
      if (BigInt(tweetId) > BigInt(maxId)) maxId = tweetId;
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
  console.log("  STGBLOG X Scraper v5.0 (RSSHub)");
  console.log("═══════════════════════════════════════\n");

  const accounts = CONFIG.accounts || [];
  if (accounts.length === 0) { console.log("⚠️  No accounts."); process.exit(0); }

  console.log(`📋 Accounts: ${accounts.map((a) => "@" + a).join(", ")}`);
  console.log(`📡 RSSHub: ${RSSHUB_URL}`);

  const state = loadState();
  let total = 0;

  for (const account of accounts) {
    try { total += await scrapeAccount(account, state); }
    catch (e) { console.log(`\n❌ ${e.message}`); }
    if (accounts.indexOf(account) < accounts.length - 1) await sleep(3000);
  }

  saveState(state);
  console.log("\n═══════════════════════════════════════");
  console.log(`  ✅ Done! Imported ${total} new post(s)`);
  console.log("═══════════════════════════════════════");
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
