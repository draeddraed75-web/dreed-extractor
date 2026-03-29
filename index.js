const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
// الرابط المباشر لموقعك على ريلوي
const BASE_URL = "https://dreed-extractor-production.up.railway.app";

// قائمة المواقع والملفات المحظورة لتسريع الاستخراج
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
];

// فحص حالة السيرفر
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Dreed Resolver Engine", version: "2.0" });
});

// المحرك الرئيسي لاستخراج الروابط
app.get("/resolve", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    const mediaUrls = [];

    // تفعيل نظام اعتراض الطلبات لحظر الإعلانات
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const reqUrl = request.url();
      const type = request.resourceType();

      if (BLOCKED_TYPES.has(type) || BLOCKED_DOMAINS.some((d) => reqUrl.includes(d))) {
        return request.abort();
      }
      request.continue();
    });

    // مراقبة الردود للبحث عن روابط الفيديو (m3u8, mp4)
    page.on("response", (response) => {
      const respUrl = response.url();
      const contentType = response.headers()["content-type"] || "";

      const isMedia =
        respUrl.includes(".m3u8") ||
        respUrl.includes(".mp4") ||
        contentType.includes("application/vnd.apple.mpegurl") ||
        contentType.includes("video/mp4");

      if (isMedia) {
        mediaUrls.push({
          url: respUrl,
          type: respUrl.includes(".m3u8") ? "hls" : "mp4",
        });
      }
    });

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

    // الدخول للموقع والانتظار حتى يستقر
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // محاكاة ضغطة زر التشغيل لتنشيط السيرفر
    try {
      await page.evaluate(() => {
        const playBtn = document.querySelector('button, [class*="play"], [id*="play"]');
        if (playBtn) playBtn.click();
      });
      await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {}

    await browser.close();

    // ترتيب النتائج: الـ HLS أولاً
    const uniqueStreams = Array.from(new Set(mediaUrls.map(s => s.url)))
      .map(url => mediaUrls.find(s => s.url === url));

    if (uniqueStreams.length === 0) {
      return res.json({ success: false, message: "No streams found", source: url });
    }

    return res.json({
      success: true,
      primary: uniqueStreams[0],
      streams: uniqueStreams,
    });
  } catch (err) {
    if (browser) await browser.close();
    return res.status(500).json({ success: false, error: err.message });
  }
});

// محرك البحث العالمي باستخدام رقم الفيلم (TMDB)
app.get("/resolve-tmdb", async (req, res) => {
  const { id, type, season, episode } = req.query;
  if (!id || !type) return res.status(400).json({ error: "Missing id/type" });

  const s = season || 1;
  const e = episode || 1;

  // قائمة بأفضل السيرفرات العالمية للتجربة
  const providers = [
    type === "tv" ? `https://vidsrc.pro/embed/tv/${id}/${s}/${e}` : `https://vidsrc.pro/embed/movie/${id}`,
    type === "tv" ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}` : `https://vidsrc.to/embed/movie/${id}`,
    type === "tv" ? `https://vidsrc.xyz/embed/tv/${id}/${s}-${e}` : `https://vidsrc.xyz/embed/movie/${id}`
  ];

  for (const providerUrl of providers) {
    try {
      // هنا تم تعديل الرابط ليستخدم الرابط المباشر بدلاً من localhost
      const fetchUrl = `${BASE_URL}/resolve?url=${encodeURIComponent(providerUrl)}`;
      const response = await fetch(fetchUrl);
      const data = await response.json();
      
      if (data.success) {
        return res.json({ ...data, provider: providerUrl });
      }
    } catch (err) {
      continue;
    }
  }

  return res.json({ success: false, message: "All providers failed", tmdbId: id });
});

app.listen(PORT, () => {
  console.log(`Dreed Resolver is live on ${BASE_URL}`);
});
