const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = "193c909f9dcb815ea536c783dab59ff5";
const MAHBOUB_WEBHOOK = "https://knbcvkymdrcoljmoderr.supabase.co/functions/v1/ingest";

const BLOCKED_DOMAINS = ['googlesyndication.com', 'adservice.google.com', 'popads.net', 'propellerads.com'];

app.get('/', (req, res) => {
    res.json({ status: "online", service: "Dreed Bulldozer", version: "4.0.0" });
});

app.get('/api/extract', async (req, res) => {
    const { url, tmdb_id } = req.query;
    if (!url || !tmdb_id) return res.status(400).json({ error: "Missing data" });

    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setRequestInterception(true);

        page.on('request', (request) => {
            if (BLOCKED_DOMAINS.some(d => request.url().includes(d))) request.abort();
            else request.continue();
        });

        let videoUrl = null;
        let subtitles = [];

        page.on('response', (response) => {
            const u = response.url();
            // صيد أي فيديو m3u8 أو mp4 فوراً
            if (u.includes('.m3u8') || u.includes('.mp4')) videoUrl = u;
            // صيد الترجمة إذا وجدت (اختياري)
            if (u.includes('.vtt') || u.includes('.srt')) {
                subtitles.push({ label: u.includes('ar') ? "العربية" : "English", src: u, srclang: u.includes('ar') ? "ar" : "en" });
            }
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        if (!videoUrl) {
            await page.click('body').catch(() => {});
            await new Promise(r => setTimeout(r, 10000));
        }

        if (videoUrl) {
            // جلب البيانات من TMDb (عالمي وعربي)
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}&language=ar-SA`);
            const movie = tmdbRes.data;

            const payload = {
                tmdb_id: parseInt(tmdb_id),
                title: movie.title || "Unknown Title",
                stream_url: videoUrl,
                stream_type: videoUrl.includes('.m3u8') ? "hls" : "mp4",
                subtitles: subtitles // حتى لو فارغة سيرسلها
            };

            await axios.post(MAHBOUB_WEBHOOK, payload);
            res.json({ success: true, data: payload });
        } else {
            res.status(404).json({ error: "No video found" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Bulldozer running`));
