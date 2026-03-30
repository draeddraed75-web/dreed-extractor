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

// قائمة المواقع المحظورة لمنع الإعلانات
const BLOCKED_DOMAINS = [
    'googlesyndication.com', 'adservice.google.com', 'popads.net', 
    'propellerads.com', 'doubleclick.net', 'analytics.google.com'
];

app.get('/', (req, res) => {
    res.json({ status: "online", service: "Dreed Extractor", version: "2.0.0" });
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

        // منطق منع الإعلانات وتسريع التصفح
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
        // مراقبة الشبكة لصيد روابط الفيديو (m3u8 أو mp4)
        page.on('response', async (response) => {
            const status = response.status();
            const url = response.url();
            if (status >= 200 && status <= 299) {
                if (url.includes('.m3u8') || url.includes('.mp4')) {
                    videoUrl = url;
                }
            }
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // إذا لم يجد الرابط تلقائياً، نحاول الضغط على زر التشغيل
        if (!videoUrl) {
            await page.click('body').catch(() => {});
            await new Promise(r => setTimeout(r, 5000)); // ننتظر 5 ثواني
        }

        if (videoUrl) {
            // جلب بيانات الفيلم من TMDb
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_API_KEY}&language=ar-SA`);
            const movieData = tmdbRes.data;

            // إرسال البيانات للمحبوب
            const payload = {
                tmdb_id: parseInt(tmdb_id),
                title: movieData.title,
                stream_url: videoUrl,
                stream_type: videoUrl.includes('.m3u8') ? "hls" : "mp4"
            };

            await axios.post(MAHBOUB_WEBHOOK, payload);

            res.json({ success: true, message: "Sent to Al-Mahboub!", data: payload });
        } else {
            res.status(404).json({ success: false, error: "No video stream found" });
        }

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => console.log(`Extractor running on port ${PORT}`));
