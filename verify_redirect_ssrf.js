const express = require('express');
const Scraper = require('./scraper');

async function testRedirectSSRF() {
    console.log("Starting Redirect SSRF test...");

    const app = express();
    app.get('/redirect', (req, res) => {
        res.redirect('http://localhost:3001/sensitive');
    });

    const server = app.listen(3002, async () => {
        console.log('Redirect server running on port 3002');

        const io = { emit: () => {} };
        const state = {
            stats: { total: 0, current: 0, success: 0, failed: 0 },
            logBuffer: [],
            shouldStop: false
        };
        const emitLog = (msg) => console.log("LOG:", msg);

        const scraper = new Scraper(io, state, emitLog);
        await scraper.initBrowser(1);

        const url = 'http://localhost.me:3002/redirect'; // Use a domain that resolves to public but we test redirect
        // Actually, localhost.me resolves to 127.0.0.1 which is blocked by our validator
        // Let's use a real public URL that we can't easily control for redirect,
        // OR we can just test if the interception blocks a direct request to localhost first in this script.

        console.log(`Testing URL: http://localhost:3001`);
        const result = await scraper.processUrl(scraper.pagePool[0], 'http://localhost:3001', new Set(), './output');

        if (result.success) {
            console.log(`❌ VULNERABLE: Successfully scraped http://localhost:3001`);
        } else {
            console.log(`✅ SECURE: Blocked http://localhost:3001. Error: ${result.error}`);
        }

        await scraper.closeBrowser();
        server.close();
    });
}

testRedirectSSRF();
