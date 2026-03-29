const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// حظر الإعلانات والملفات الثقيلة لتسريع العملية
const BLOCKED_TYPES = new Set(["image", "stylesheet", "font", "media"]);
const BLOCKED_DOMAINS = ["doubleclick.net", "googlesyndication.com", "popads.net", "propellerads.com"];

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Dreed Resolver Engine", environment: "Production" });
});

// المحرك الرئيسي
app.get("/resolve", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url" });

  let browser;
  try {
    browser = await puppeteer.launch({
      // هذا السطر هو الأهم: يربط الكود بمسار الكروم الموجود في الـ Dockerfile
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    const mediaUrls = [];

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (BLOCKED_TYPES.has(request.resourceType()) || BLOCKED_DOMAINS.some(d => request.url().includes(d))) {
        return request.abort();
      }
      request.continue();
    });

    page.on("response", (response) => {
      const respUrl = response.url();
      if (respUrl.includes(".m3u8") || respUrl.includes(".mp4")) {
        mediaUrls.push({ url: respUrl, type: respUrl.includes(".m3u8") ? "hls" : "mp4" });
      }
    });

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    
    // الدخول للموقع مع مهلة انتظار أطول
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // محاولة الضغط على أي زر تشغيل يظهر
    await page.evaluate(() => {
      const b = document.querySelector('button, [class*="play"]');
      if (b) b.click();
    });
    
    await new Promise(r => setTimeout(r, 8000)); // انتظار التحميل

    await browser.close();

    const unique = Array.from(new Map(mediaUrls.map(item => [item['url'], item])).values());

    return res.json({ success: unique.length > 0, streams: unique });
  } catch (err) {
    if (browser) await browser.close();
    return res.status(500).json({ success: false, error: err.message });
  }
});

// محرك البحث العالمي (TMDB) - معدل ليعمل داخلياً
app.get("/resolve-tmdb", async (req, res) => {
  const { id, type, season, episode } = req.query;
  const s = season || 1;
  const e = episode || 1;

  const providers = [
    type === "tv" ? `https://vidsrc.pro/embed/tv/${id}/${s}/${e}` : `https://vidsrc.pro/embed/movie/${id}`,
    type === "tv" ? `https://vidsrc.to/embed/tv/${id}/${s}/${e}` : `https://vidsrc.to/embed/movie/${id}`
  ];

  for (const providerUrl of providers) {
    try {
      // ملاحظة: هنا استخدمنا 127.0.0.1 للاتصال الداخلي السريع والمضمون في ريلوي
      const response = await fetch(`http://127.0.0.1:${PORT}/resolve?url=${encodeURIComponent(providerUrl)}`);
      const data = await response.json();
      if (data.success) return res.json({ ...data, provider: providerUrl });
    } catch (err) { continue; }
  }

  return res.json({ success: false, message: "No streams found" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
