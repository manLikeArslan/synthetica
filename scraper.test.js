const { test, mock } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Mock external dependencies to allow loading scraper.js
const Module = require('module');
const originalLoad = Module._load;

const mockModules = {
    'puppeteer-extra': {
        use: () => {}
    },
    'puppeteer-extra-plugin-stealth': () => {},
    'jsdom': {
        JSDOM: class {}
    },
    'turndown': class {
        addRule() {}
    },
    'slugify': () => {},
    './config': {
        getConfig: () => ({})
    },
    '@mozilla/readability': {
        Readability: class {}
    }
};

Module._load = function(request, parent, isMain) {
    if (mockModules[request]) {
        return mockModules[request];
    }
    return originalLoad.apply(this, arguments);
};

const Scraper = require('./scraper');

test('Scraper.loadFailedUrls handles invalid JSON gracefully', (t) => {
    const failedUrlsPath = path.join(__dirname, 'failed_urls.json');

    const mockExistsSync = t.mock.method(fs, 'existsSync', (p) => {
        if (p === failedUrlsPath) return true;
        return false;
    });

    const mockReadFileSync = t.mock.method(fs, 'readFileSync', (p, encoding) => {
        if (p === failedUrlsPath) return 'invalid { json }';
        return '';
    });

    const mockIo = { emit: () => {} };
    const mockEmitLog = () => {};
    const scrapingState = { stats: { success: 0, failed: 0, current: 0 } };

    const scraper = new Scraper(mockIo, scrapingState, mockEmitLog);

    // loadFailedUrls is called in the constructor
    assert.deepStrictEqual(scraper.failedUrls, {}, 'failedUrls should be an empty object on invalid JSON');

    // We can also call it directly
    const result = scraper.loadFailedUrls();
    assert.deepStrictEqual(result, {}, 'loadFailedUrls should return an empty object on invalid JSON');
});

test('Scraper.loadFailedUrls handles missing file gracefully', (t) => {
    const failedUrlsPath = path.join(__dirname, 'failed_urls.json');

    t.mock.method(fs, 'existsSync', (p) => {
        if (p === failedUrlsPath) return false;
        return false;
    });

    const mockIo = { emit: () => {} };
    const mockEmitLog = () => {};
    const scrapingState = { stats: { success: 0, failed: 0, current: 0 } };

    const scraper = new Scraper(mockIo, scrapingState, mockEmitLog);

    assert.deepStrictEqual(scraper.failedUrls, {}, 'failedUrls should be an empty object if file does not exist');
});

test('Scraper.loadFailedUrls loads valid JSON correctly', (t) => {
    const failedUrlsPath = path.join(__dirname, 'failed_urls.json');
    const validData = { 'http://example.com': { attempts: 1, error: 'test' } };

    t.mock.method(fs, 'existsSync', (p) => {
        if (p === failedUrlsPath) return true;
        return false;
    });

    t.mock.method(fs, 'readFileSync', (p, encoding) => {
        if (p === failedUrlsPath) return JSON.stringify(validData);
        return '';
    });

    const mockIo = { emit: () => {} };
    const mockEmitLog = () => {};
    const scrapingState = { stats: { success: 0, failed: 0, current: 0 } };

    const scraper = new Scraper(mockIo, scrapingState, mockEmitLog);

    assert.deepStrictEqual(scraper.failedUrls, validData, 'failedUrls should match valid JSON data');
});
