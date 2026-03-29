const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Blocked resource types and domains for speed
const BLOCKED_TYPES = new Set(["image", "stylesheet", "font", "media"]);
const BLOCKED_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "facebook.net",
  "analytics.google.com",
  "adservice.google.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "juicyads.com",
  "exoclick.com",
  "trafficjunky.com",
  "ad.doubleclick.net",
];

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Dreed Resolver" });
});

// Main resolver endpoint
app.get("/resolve", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
      ],
    });

    const page = await browser.newPage();

    // Collect media URLs
    const mediaUrls = [];

    // Intercept requests
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const reqUrl = request.url();
      const type = request.resourceType();

      // Block ads and unnecessary resources
      if (BLOCKED_TYPES.has(type)) {
        return request.abort();
      }
      if (BLOCKED_DOMAINS.some((d) => reqUrl.includes(d))) {
        return request.abort();
      }

      request.continue();
    });

    // Listen for media responses
    page.on("response", (response) => {
      const respUrl = response.url();
      const contentType = response.headers()["content-type"] || "";

      const isMedia =
        respUrl.includes(".m3u8") ||
        respUrl.includes(".mp4") ||
        respUrl.includes("/playlist") ||
        contentType.includes("application/vnd.apple.mpegurl") ||
        contentType.includes("application/x-mpegURL") ||
        contentType.includes("video/mp4") ||
        contentType.includes("video/mp2t");

      if (isMedia) {
        mediaUrls.push({
          url: respUrl,
          type: respUrl.includes(".m3u8") ? "hls" : "mp4",
          contentType,
          status: response.status(),
        });
      }
    });

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate and wait for network to settle
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait extra time for lazy-loaded players
    await new Promise((r) => setTimeout(r, 5000));

    // Try clicking play buttons if they exist
    try {
      await page.evaluate(() => {
        const btns = document.querySelectorAll(
          'button, [class*="play"], [id*="play"], .jw-icon-display, .vjs-big-play-button'
        );
        if (btns.length > 0) btns[0].click();
      });
      await new Promise((r) => setTimeout(r, 3000));
    } catch (_) {
      // Ignore click errors
    }

    // Also try to extract from video/source tags directly
    const domSources = await page.evaluate(() => {
      const sources = [];
      document.querySelectorAll("video source, video").forEach((el) => {
        const src = el.getAttribute("src");
        if (src && (src.includes(".m3u8") || src.includes(".mp4"))) {
          sources.push({
            url: src.startsWith("http") ? src : new URL(src, location.href).href,
            type: src.includes(".m3u8") ? "hls" : "mp4",
            source: "dom",
          });
        }
      });
      return sources;
    });

    const allSources = [...mediaUrls, ...domSources];

    // Deduplicate
    const unique = [];
    const seen = new Set();
    for (const s of allSources) {
      if (!seen.has(s.url)) {
        seen.add(s.url);
        unique.push(s);
      }
    }

    // Prioritize: HLS first, then MP4
    unique.sort((a, b) => {
      if (a.type === "hls" && b.type !== "hls") return -1;
      if (a.type !== "hls" && b.type === "hls") return 1;
      return 0;
    });

    await browser.close();

    if (unique.length === 0) {
      return res.json({
        success: false,
        message: "No media streams found",
        sourceUrl: url,
        streams: [],
      });
    }

    return res.json({
      success: true,
      sourceUrl: url,
      primary: unique[0],
      streams: unique,
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({
      success: false,
      error: err.message,
      sourceUrl: url,
    });
  }
});

// Multi-source resolver — tries multiple providers for a TMDB ID
app.get("/resolve-tmdb", async (req, res) => {
  const { id, type, season, episode } = req.query;

  if (!id || !type) {
    return res.status(400).json({ error: "Missing ?id= and ?type= parameters" });
  }

  const s = season || 1;
  const e = episode || 1;

  const providers = [
    type === "tv"
      ? `https://vidsrc.pro/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.pro/embed/movie/${id}`,
    type === "tv"
      ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.to/embed/movie/${id}`,
    type === "tv"
      ? `https://vidsrc.xyz/embed/tv/${id}/${s}-${e}`
      : `https://vidsrc.xyz/embed/movie/${id}`,
    type === "tv"
      ? `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`
      : `https://vidsrc.cc/v2/embed/movie/${id}`,
    type === "tv"
      ? `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`
      : `https://multiembed.mov/?video_id=${id}&tmdb=1`,
  ];

  // Try each provider sequentially until one returns streams
  for (const providerUrl of providers) {
    try {
      const response = await fetch(
        `http://localhost:${PORT}/resolve?url=${encodeURIComponent(providerUrl)}`
      );
      const data = await response.json();
      if (data.success && data.streams.length > 0) {
        return res.json({
          ...data,
          provider: providerUrl,
        });
      }
    } catch (_) {
      continue;
    }
  }

  return res.json({
    success: false,
    message: "No streams found from any provider",
    tmdbId: id,
    type,
  });
});

app.listen(PORT, () => {
  console.log(`Dreed Resolver running on port ${PORT}`);
});
