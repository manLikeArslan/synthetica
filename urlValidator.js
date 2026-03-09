const { Netmask } = require('netmask');
const dns = require('dns').promises;

const PRIVATE_RANGES = [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '0.0.0.0/8'
].map(range => new Netmask(range));

function isPrivateIp(ip) {
    if (!ip) return false;

    // IPv6 loopback and private ranges
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    if (ip.toLowerCase().startsWith('fe80:') ||
        ip.toLowerCase().startsWith('fc00:') ||
        ip.toLowerCase().startsWith('fd00:')) {
        return true;
    }

    // Check for IPv4 mapped IPv6
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }

    for (const netmask of PRIVATE_RANGES) {
        try {
            if (netmask.contains(ip)) {
                return true;
            }
        } catch (e) {
            // Probably not an IPv4 address
        }
    }
    return false;
}

async function isValidUrl(urlStr) {
    try {
        const parsedUrl = new URL(urlStr);

        // Only allow http and https
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return false;
        }

        let hostname = parsedUrl.hostname.toLowerCase();

        // Strip trailing dots
        while (hostname.endsWith('.')) {
            hostname = hostname.slice(0, -1);
        }

        // Handle IPv6 literals in brackets
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
            const ipv6 = hostname.slice(1, -1);
            if (isPrivateIp(ipv6)) {
                return false;
            }
        }

        // Reject localhost explicitly
        if (hostname === 'localhost') {
            return false;
        }

        // DNS resolution check
        try {
            const results = await dns.lookup(hostname, { all: true });
            for (const res of results) {
                if (isPrivateIp(res.address)) {
                    return false;
                }
            }
        } catch (e) {
            // If DNS lookup fails, let Puppeteer handle it
        }

        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    isValidUrl
};
