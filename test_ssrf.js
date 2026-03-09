const Scraper = require('./scraper');
const http = require('http');

async function testSSRF() {
    console.log("Starting SSRF test...");

    // Mock IO and state
    const io = { emit: () => {} };
    const state = {
        stats: { total: 0, current: 0, success: 0, failed: 0 },
        logBuffer: [],
        shouldStop: false
    };
    const emitLog = (msg) => console.log("LOG:", msg);

    const scraper = new Scraper(io, state, emitLog);
    await scraper.initBrowser(1);

    const testUrls = [
        'http://localhost:3000/api/config',
        'http://127.0.0.1:3000/api/config'
    ];

    for (const url of testUrls) {
        console.log(`Testing URL: ${url}`);
        const result = await scraper.processUrl(scraper.pagePool[0], url, new Set(), './output');
        if (result.success) {
            console.log(`❌ VULNERABLE: Successfully scraped ${url}`);
        } else {
            console.log(`✅ SECURE: Failed to scrape ${url}. Error: ${result.error}`);
        }
    }

    await scraper.closeBrowser();
}

// Start a dummy server to see if we can reach it
const dummyServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Sensitive Internal Data</h1></body></html>');
});

dummyServer.listen(3001, async () => {
    console.log('Dummy internal server running on port 3001');

    const Scraper = require('./scraper');
    const io = { emit: () => {} };
    const state = {
        stats: { total: 0, current: 0, success: 0, failed: 0 },
        logBuffer: [],
        shouldStop: false
    };
    const emitLog = (msg) => console.log("LOG:", msg);

    const scraper = new Scraper(io, state, emitLog);
    await scraper.initBrowser(1);

    const url = 'http://localhost:3001';
    console.log(`Testing URL: ${url}`);
    const result = await scraper.processUrl(scraper.pagePool[0], url, new Set(), './output');

    if (result.success) {
        console.log(`❌ VULNERABLE: Successfully scraped ${url}`);
    } else {
        console.log(`✅ SECURE: Failed to scrape ${url}. Error: ${result.error}`);
    }

    await scraper.closeBrowser();
    dummyServer.close();
});
