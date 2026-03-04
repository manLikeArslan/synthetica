const fs = require('fs');
const path = require('path');

// Keep config file locally for now (easily ported to app.getPath('appData') in Tauri)
const CONFIG_FILE = path.join(__dirname, 'settings.json');

const DEFAULT_CONFIG = {
    concurrency: 5,
    timeoutMs: 30000,
    csvDir: './csv',
    outputDir: './output',
    stripImages: true,
    outputFormat: 'md',
    filenamePattern: 'title', // 'title', 'url', 'numbered'
    maxRetries: 3,
    retryDelayMs: 2000
};

let currentConfig = { ...DEFAULT_CONFIG };

// Load config synchronously on startup
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const fileData = fs.readFileSync(CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(fileData);
            currentConfig = { ...DEFAULT_CONFIG, ...parsed };
        } catch (e) {
            console.error('Failed to parse settings.json, using defaults:', e);
            currentConfig = { ...DEFAULT_CONFIG };
        }
    } else {
        saveConfig(currentConfig); // Create default file
    }
}

// Save config to disk
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save settings.json:', e);
    }
}

// Get current snapshot
function getConfig() {
    return { ...currentConfig };
}

// Update partial config
function updateConfig(updates) {
    currentConfig = { ...currentConfig, ...updates };

    // Ensure numeric values stay numeric
    if (currentConfig.concurrency) currentConfig.concurrency = parseInt(currentConfig.concurrency, 10);
    if (currentConfig.timeoutMs) currentConfig.timeoutMs = parseInt(currentConfig.timeoutMs, 10);
    if (currentConfig.maxRetries) currentConfig.maxRetries = parseInt(currentConfig.maxRetries, 10);
    if (currentConfig.retryDelayMs) currentConfig.retryDelayMs = parseInt(currentConfig.retryDelayMs, 10);

    saveConfig(currentConfig);
    return getConfig();
}

// Initialize on require
loadConfig();

module.exports = {
    getConfig,
    updateConfig
};
