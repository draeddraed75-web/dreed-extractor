const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/extract', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "No URL provided" });

    try {
        // هذا السيرفر يعمل كـ "وسيط" لجلب الفيديو بدون إعلانات المصدر
        const response = await axios.get(targetUrl);
        // هنا سنضع لاحقاً منطق التنظيف الخاص بكل موقع
        res.json({ 
            message: "Extractor Ready",
            source: targetUrl,
            status: "Connected"
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to connect to source" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
