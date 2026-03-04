const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const slugify = require('slugify');
const config = require('./config');
const multer = require('multer');
const Scraper = require('./scraper');

const PROCESSED_FILES_PATH = path.join(__dirname, 'processed_urls.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json()); // For handling JSON payloads

// --- API Endpoints ---
app.get('/api/config', (req, res) => {
    res.json(config.getConfig());
});

app.put('/api/config', (req, res) => {
    const updated = config.updateConfig(req.body);
    res.json(updated);
    io.emit('config-updated', updated); // Broadcast changes to any other clients
});

// Helper functions for dynamic directories
function getCsvDir() {
    return path.resolve(__dirname, config.getConfig().csvDir);
}

function getOutputDir() {
    const dir = path.resolve(__dirname, config.getConfig().outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Ensure defaults exist on startup
if (!fs.existsSync(getCsvDir())) fs.mkdirSync(getCsvDir(), { recursive: true });
getOutputDir();

// --- File Upload Setup (Multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = getCsvDir();
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// --- API Endpoints continued ---

// Upload a CSV file directly (drag & drop)
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    res.json({ success: true, filename: req.file.filename });
});

// Submit pasted URLs (creates a temp CSV for processing)
app.post('/api/urls', (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: 'Invalid URL list.' });

    const csvContent = "url\n" + urls.join('\n');
    const filename = `pasted-${Date.now()}.csv`;
    const filepath = path.join(getCsvDir(), filename);

    fs.writeFileSync(filepath, csvContent, 'utf8');
    res.json({ success: true, filename });
});

// Clear processed URLs history
app.delete('/api/processed', (req, res) => {
    try {
        if (fs.existsSync(PROCESSED_FILES_PATH)) {
            fs.unlinkSync(PROCESSED_FILES_PATH);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

// Get failed URLs
app.get('/api/failed', (req, res) => {
    try {
        const failedPath = path.join(__dirname, 'failed_urls.json');
        if (fs.existsSync(failedPath)) {
            const data = JSON.parse(fs.readFileSync(failedPath, 'utf8'));
            res.json(data);
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to read failed URLs' });
    }
});

// Retry all failed URLs
app.post('/api/retry-failed', (req, res) => {
    try {
        const failedPath = path.join(__dirname, 'failed_urls.json');
        if (fs.existsSync(failedPath)) {
            const data = JSON.parse(fs.readFileSync(failedPath, 'utf8'));
            const urls = Object.keys(data);
            if (urls.length === 0) return res.status(400).json({ error: 'No failed URLs to retry.' });

            // Wipe the failed log to start fresh
            fs.writeFileSync(failedPath, JSON.stringify({}, null, 2));
            res.json({ success: true, urls });
        } else {
            res.status(400).json({ error: 'No failed URLs found.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to initiate retry' });
    }
});

// Get run history
app.get('/api/history', (req, res) => {
    try {
        const historyPath = path.join(__dirname, 'history.json');
        if (fs.existsSync(historyPath)) {
            const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            res.json(data);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to read history' });
    }
});

// Export run summary / results (simplified to return current session stats + processed list for now)
app.get('/api/export', (req, res) => {
    let list = [];
    if (fs.existsSync(PROCESSED_FILES_PATH)) {
        list = JSON.parse(fs.readFileSync(PROCESSED_FILES_PATH, 'utf8'));
    }

    let csv = 'Status,URL\n';
    list.forEach(url => {
        csv += `Success,${url}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
    res.send(csv);
});

let scrapingState = {
    isRunning: false,
    isPaused: false,
    shouldStop: false,
    stats: { total: 0, current: 0, success: 0, failed: 0 },
    logBuffer: []
};

// Helper: emit log to ALL clients AND buffer it for reconnects
function emitLog(message) {
    scrapingState.logBuffer.push(message);
    // Cap buffer at 500 entries to prevent memory issues
    if (scrapingState.logBuffer.length > 500) {
        scrapingState.logBuffer = scrapingState.logBuffer.slice(-500);
    }
    io.emit('log', message);
}

io.on('connection', (socket) => {
    console.log('A client connected');

    // Immediately sync current state to newly connected client
    if (scrapingState.isRunning) {
        const state = scrapingState.isPaused ? 'paused' : 'running';
        socket.emit('sync-state', {
            isRunning: true,
            isPaused: scrapingState.isPaused,
            state: state,
            stats: scrapingState.stats,
            logs: scrapingState.logBuffer
        });
    }

    socket.on('start-scraping', async () => {
        if (scrapingState.isRunning) {
            socket.emit('log', 'A scraping job is already running.');
            return;
        }

        scrapingState.isRunning = true;
        scrapingState.isPaused = false;
        scrapingState.shouldStop = false;
        scrapingState.logBuffer = [];

        emitLog('Scraping Job Started...');
        let allUrls = [];

        try {
            const currentConfig = config.getConfig();
            const csvDir = getCsvDir();
            const files = fs.readdirSync(csvDir).filter(file => file.endsWith('.csv'));

            if (files.length === 0) {
                emitLog(`Error: No CSV files found in the ${currentConfig.csvDir} directory.`);
                io.emit('done');
                scrapingState.isRunning = false;
                return;
            }

            for (const file of files) {
                emitLog(`Reading ${file}...`);
                const urls = await parseCsv(path.join(csvDir, file));
                allUrls = allUrls.concat(urls);
            }

            emitLog(`Found ${allUrls.length} total URLs to scrape.`);
            scrapingState.stats = { total: allUrls.length, current: 0, success: 0, failed: 0 };
            io.emit('stats', scrapingState.stats);

            if (allUrls.length === 0) {
                io.emit('done');
                scrapingState.isRunning = false;
                return;
            }

            // Load processed set
            let processedSet = new Set();
            if (fs.existsSync(PROCESSED_FILES_PATH)) {
                try {
                    processedSet = new Set(JSON.parse(fs.readFileSync(PROCESSED_FILES_PATH)));
                } catch (e) { }
            }

            // Instantiate and run the Scraper class
            const scraper = new Scraper(io, scrapingState, emitLog);
            await scraper.run(allUrls, processedSet, PROCESSED_FILES_PATH);

            scrapingState.isRunning = false;
        } catch (error) {
            emitLog(`Critical Error: ${error.message}`);
            io.emit('done');
            scrapingState.isRunning = false;
        }
    });

    socket.on('pause-scraping', () => {
        if (scrapingState.isRunning && !scrapingState.isPaused) {
            scrapingState.isPaused = true;
            emitLog('<span style="color:#aaa">[SYSTEM] SEQUENCE PAUSED. Active processes will finish current assignment.</span>');
            io.emit('state-changed', { state: 'paused' });
        }
    });

    socket.on('resume-scraping', () => {
        if (scrapingState.isRunning && scrapingState.isPaused) {
            scrapingState.isPaused = false;
            emitLog('<span style="color:#0f0">[SYSTEM] SEQUENCE RESUMED.</span>');
            io.emit('state-changed', { state: 'running' });
        }
    });

    socket.on('stop-scraping', () => {
        if (scrapingState.isRunning) {
            scrapingState.shouldStop = true;
            emitLog('<span style="color:#f00">[SYSTEM] SEQUENCE ABORT INITIATED. Halting soon...</span>');
            io.emit('state-changed', { state: 'stopped' });
        }
    });
});

function parseCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                const urlField = Object.keys(data).find(k => k.toLowerCase().includes('url') || k.toLowerCase().includes('link'));
                if (urlField && data[urlField]) {
                    results.push(data[urlField].trim());
                } else {
                    const values = Object.values(data);
                    if (values.length > 0 && values[0].startsWith('http')) {
                        results.push(values[0].trim());
                    }
                }
            })
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Scraper server listening on http://localhost:${PORT}`);
});
