const { isValidUrl } = require('./urlValidator');

async function runTests() {
    const testCases = [
        { url: 'https://www.google.com', expected: true },
        { url: 'http://example.com/path?query=1', expected: true },
        { url: 'http://localhost', expected: false },
        { url: 'http://localhost.', expected: false },
        { url: 'http://localhost:3000', expected: false },
        { url: 'http://127.0.0.1', expected: false },
        { url: 'http://127.0.0.1.', expected: false },
        { url: 'http://127.0.0.1:8080', expected: false },
        { url: 'http://192.168.1.1', expected: false },
        { url: 'http://10.0.0.1', expected: false },
        { url: 'http://172.16.0.1', expected: false },
        { url: 'http://169.254.169.254/latest/meta-data/', expected: false },
        { url: 'file:///etc/passwd', expected: false },
        { url: 'gopher://localhost', expected: false },
        { url: 'ftp://example.com', expected: false },
        { url: 'http://[::1]', expected: false },
        { url: 'https://1.1.1.1', expected: true },
        // DNS based SSRF (this might depend on network if it resolves to internal)
        // If localtest.me resolves to 127.0.0.1, it should be blocked
        { url: 'http://localtest.me', expected: false }
    ];

    let failed = 0;
    for (const { url, expected } of testCases) {
        const result = await isValidUrl(url);
        if (result !== expected) {
            console.error(`❌ Test failed for ${url}. Expected ${expected}, got ${result}`);
            failed++;
        } else {
            console.log(`✅ Test passed for ${url}`);
        }
    }

    if (failed > 0) {
        console.error(`\nTotal failures: ${failed}`);
        process.exit(1);
    } else {
        console.log('\nAll SSRF validation tests passed!');
    }
}

runTests();
