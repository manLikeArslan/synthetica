const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const slugify = require('slugify');
const path = require('path');
const fs = require('fs');
const config = require('./config');

puppeteer.use(StealthPlugin());

// Shared turndown instance (default)
const turndownService = new TurndownService();
turndownService.addRule('remove-images', {
    filter: ['img', 'picture'],
    replacement: () => ''
});

class Scraper {
    constructor(io, scrapingState, emitLog) {
        this.io = io;
        this.state = scrapingState;
        this.emitLog = emitLog;
        this.browser = null;
        this.pagePool = []; // Connection pooling

        // Track failed URLs dynamically
        this.failedUrlsPath = path.join(__dirname, 'failed_urls.json');
        this.failedUrls = this.loadFailedUrls();
    }

    loadFailedUrls() {
        if (fs.existsSync(this.failedUrlsPath)) {
            try { return JSON.parse(fs.readFileSync(this.failedUrlsPath, 'utf8')); } catch (e) { }
        }
        return {};
    }

    saveFailedUrl(url, error) {
        if (!this.failedUrls[url]) {
            this.failedUrls[url] = { attempts: 0, error: '' };
        }
        this.failedUrls[url].attempts++;
        this.failedUrls[url].error = error;
        this.failedUrls[url].lastAttempt = Date.now();
        // Batch this in production, but synchronous for now given low volume
        fs.writeFileSync(this.failedUrlsPath, JSON.stringify(this.failedUrls, null, 2));
    }

    removeFailedUrl(url) {
        if (this.failedUrls[url]) {
            delete this.failedUrls[url];
            fs.writeFileSync(this.failedUrlsPath, JSON.stringify(this.failedUrls, null, 2));
        }
    }

    async initBrowser(concurrency) {
        this.emitLog(`Launching headless browser (Concurrency: ${concurrency})...`);
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        // Initialize connection pool
        this.emitLog(`Initializing page pool (${concurrency} pages)...`);
        for (let i = 0; i < concurrency; i++) {
            const page = await this.browser.newPage();
            this.pagePool.push(page);
        }
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.pagePool = [];
        }
    }

    async processUrl(page, url, processedSet, outputDir, attempt = 1) {
        const currentConfig = config.getConfig();
        const maxRetries = currentConfig.maxRetries || 3;

        try {
            const startTime = Date.now();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: currentConfig.timeoutMs });

            // Check for 429 Too Many Requests (Adaptive Concurrency Hook)
            const content = await page.content();
            if (content.toLowerCase().includes('too many requests') || content.includes('429')) {
                throw new Error("HTTP 429: Too Many Requests");
            }

            const responseTimeMs = Date.now() - startTime;
            const doc = new JSDOM(content, { url });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (!article || !article.content) {
                throw new Error("Readability couldn't extract content");
            }

            let markdownContent = '';
            if (!currentConfig.stripImages) {
                const defaultTurndown = new TurndownService();
                markdownContent = defaultTurndown.turndown(article.content);
            } else {
                markdownContent = turndownService.turndown(article.content);
            }

            const safeTitle = article.title ? article.title.trim() : `article-${Date.now()}`;
            const slug = slugify(safeTitle, { lower: true, strict: true });
            const filename = (currentConfig.filenamePattern === 'title' ? slug : `url-${Date.now()}`) + `.${currentConfig.outputFormat}`;
            const filePath = path.join(outputDir, filename);
            const finalMarkdown = `# ${safeTitle}\n\n*Original URL: ${url}*\n\n---\n\n${markdownContent}`;

            fs.writeFileSync(filePath, finalMarkdown);

            // Success: Clean up failed log if it was there
            this.removeFailedUrl(url);

            return { success: true, url, filename, responseTimeMs };

        } catch (err) {
            if (attempt < maxRetries && !this.state.shouldStop) {
                this.emitLog(`<span style="color:#ffbca3">Warning:</span> ${url} failed (Attempt ${attempt}/${maxRetries}). Retrying in ${currentConfig.retryDelayMs}ms...`);
                await new Promise(r => setTimeout(r, currentConfig.retryDelayMs));
                return this.processUrl(page, url, processedSet, outputDir, attempt + 1);
            } else {
                this.saveFailedUrl(url, err.message);
                return { success: false, url, error: err.message };
            }
        }
    }

    async run(urls, processedSet, PROCESSED_FILES_PATH) {
        const currentConfig = config.getConfig();
        const outputDir = path.resolve(__dirname, currentConfig.outputDir);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        // Adaptive concurrency tracking
        let activeConcurrency = currentConfig.concurrency;

        await this.initBrowser(activeConcurrency);

        let index = 0;
        let lastProcessedSave = Date.now();

        // ETA Tracking
        const runStartTime = Date.now();
        const recentTimings = []; // queue of {time, currentCount}

        const worker = async () => {
            while (index < urls.length) {
                if (this.state.shouldStop) break;

                if (this.state.isPaused) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                const i = index++;
                const url = urls[i];

                if (processedSet.has(url)) {
                    this.state.stats.success++;
                    this.state.stats.current++;
                    this.emitLog(`[${i + 1}/${urls.length}] <span style="color:#aaa">Skipping already processed:</span> ${url}`);
                    this.io.emit('stats', this.state.stats);
                    this.io.emit('progress', { total: urls.length, current: this.state.stats.current });
                    continue;
                }

                this.emitLog(`[${i + 1}/${urls.length}] Scraping: ${url}`);

                // Get a page from the pool
                const page = this.pagePool.pop();
                if (!page) {
                    // Pool is empty (shouldn't happen with strict worker loop, but fallback just in case)
                    index--;
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                const result = await this.processUrl(page, url, processedSet, outputDir);

                // Return page to pool
                this.pagePool.push(page);

                if (result.success) {
                    this.state.stats.success++;
                    processedSet.add(url);
                    this.emitLog(`<span style="color:#0f0">Success:</span> Saved ${result.filename}`);
                    this.io.emit('waveform-data', { type: 'success', responseMs: result.responseTimeMs });

                    // Batch write processed_urls.json every 5 seconds to reduce I/O disk thrashing
                    if (Date.now() - lastProcessedSave > 5000) {
                        fs.writeFileSync(PROCESSED_FILES_PATH, JSON.stringify(Array.from(processedSet), null, 2));
                        lastProcessedSave = Date.now();
                    }

                } else {
                    this.state.stats.failed++;
                    this.emitLog(`<span style="color:#f00">Failed:</span> ${url} - ${result.error}`);
                    this.io.emit('waveform-data', { type: 'error', responseMs: -1 });

                    // Adaptive Concurrency hook: if 429, back off
                    if (result.error.includes('429') && activeConcurrency > 1) {
                        activeConcurrency = Math.max(1, Math.floor(activeConcurrency / 2));
                        this.emitLog(`<span style="color:#ffbca3">[SYSTEM] Heavy rate limiting detected. Throttling concurrency down to ${activeConcurrency}...</span>`);
                        // Note: we don't destroy pool pages here yet to keep it simple, just limit active workers
                    }
                }

                this.state.stats.current++;

                // ETA Calculation (Rolling window)
                recentTimings.push({ time: Date.now(), current: this.state.stats.current });
                if (recentTimings.length > 20) recentTimings.shift(); // keep last 20 samples

                let etaSeconds = 0;
                if (recentTimings.length > 5) {
                    const first = recentTimings[0];
                    const last = recentTimings[recentTimings.length - 1];
                    const timeDiff = last.time - first.time;
                    const itemsDiff = last.current - first.current;

                    if (itemsDiff > 0) {
                        const msPerItem = timeDiff / itemsDiff;
                        const remainingItems = urls.length - this.state.stats.current;
                        etaSeconds = Math.round((remainingItems * msPerItem) / 1000);
                    }
                }

                this.io.emit('stats', this.state.stats);
                this.io.emit('progress', {
                    total: urls.length,
                    current: this.state.stats.current,
                    etaSeconds
                });
            }
        };

        const workers = [];
        for (let w = 0; w < activeConcurrency; w++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        // Final flush
        fs.writeFileSync(PROCESSED_FILES_PATH, JSON.stringify(Array.from(processedSet), null, 2));

        await this.closeBrowser();

        // Save to History
        this.saveRunHistory();

        this.emitLog('Scraping Sequence Complete!');
        this.io.emit('done');
    }

    saveRunHistory() {
        const historyPath = path.join(__dirname, 'history.json');
        let history = [];
        if (fs.existsSync(historyPath)) {
            try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch (e) { }
        }

        const runRecord = {
            id: Date.now(),
            date: new Date().toISOString(),
            stats: this.state.stats,
            // Store just a snippet of logs to save space
            finalLogSnippet: this.state.logBuffer.slice(-10)
        };

        history.unshift(runRecord); // Add to beginning
        if (history.length > 50) history.pop(); // Keep only last 50 runs

        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    }
}

module.exports = Scraper;
