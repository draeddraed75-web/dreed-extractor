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

const BLOCKED_DOMAINS = [
    'googlesyndication.com', 'adservice.google.com', 'popads.net', 
    'propellerads.com', 'doubleclick.net', 'analytics.google.com'
];

app.get('/', (req, res) => {
    res.json({ status: "online", service: "Dreed Extractor", version: "3.0.0 (Pro)" });
});

app.get('/api/extract', async (req, res) => {
    const { url, tmdb_id } = req.query;

    if (!url || !tmdb_id) {
        return res.status(400).json({ error: "Missing url or tmdb_id" });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setRequestInterception(true);

        page.on('request', (request) => {
            const url = request.url();
            if (BLOCKED_DOMAINS.some(domain => url.includes(domain)) || 
                ['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        let videoUrl = null;
        let subtitles = [];

        // مراقبة الشبكة لصيد الفيديو والترجمة
        page.on('response', async (response) => {
            const url = response.url();
            // صيد الفيديو
            if (url.includes('.m3u8') || url.includes('.mp4')) {
                if (!videoUrl || url.includes('master')) videoUrl = url;
            }
            // صيد ملفات الترجمة إذا وجدت
            if (url.includes('.vtt') || url.includes('.srt')) {
                subtitles.push({
                    label: url.includes('ar') ? "العربية" : "English",
                    src: url,
                    srclang: url.includes('ar') ? "ar" : "en"
                });
            }
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        if (!videoUrl) {
            await page.click('body').catch(() => {});
            await new Promise(r => setTimeout(r, 8000)); // ننتظر شوي زيادة
        }

        if (videoUrl) {
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}&language=ar-SA`);
            const movieData = tmdbRes.data;

            // التنسيق الجديد اللي طلبه "المحبوب" بالفيديو
            const payload = {
                tmdb_id: parseInt(tmdb_id),
                title: movieData.title,
                stream_url: videoUrl,
                stream_type: videoUrl.includes('.m3u8') ? "hls" : "mp4",
                quality: "1080p", // افتراضي
                language: "ar",
                subtitles: subtitles.length > 0 ? subtitles : [
                    { label: "العربية", src: "", srclang: "ar" } // مكان فارغ للترجمة إذا لم يجد
                ]
            };

            await axios.post(MAHBOUB_WEBHOOK, payload);
            res.json({ success: true, message: "Movie Ingested Successfully!", data: payload });
        } else {
            res.status(404).json({ success: false, error: "No video found" });
        }

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Dreed Pro Extractor running on port ${PORT}`));
