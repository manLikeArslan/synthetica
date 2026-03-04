# Synthetica Blog Scraper

![Screenshot](screenshot.jpg)

Synthetica is a high-performance, visually striking data extraction module built with Node.js, Puppeteer, and a web-based "Analog Lab" interface. It is designed to autonomously read lists of URLs from CSV files, scrape the article content while bypassing basic bot-protection using stealth routing, and export the content into beautifully formatted Markdown files.

## Features

- **Analog Control Deck UI:** A responsive, retro-futuristic dashboard for monitoring scraping operations in real-time.
- **Connection Pooling:** Pre-launches and reuses Headless Chrome instances for massive CPU/RAM efficiency.
- **Adaptive Concurrency:** Automatically detects `HTTP 429 Too Many Requests` errors and throttles down worker threads to avoid IP bans.
- **Smart Retries:** Uses exponential backoff for failed network requests before marking a URL as an anomaly.
- **Dynamic Configuration:** Real-time settings updates for concurrency, timeouts, and I/O directories via the slide-out Configuration Drawer.
- **Anomaly Buffer:** Tracks failed URLs and provides a one-click interface to re-queue them.
- **Extraction Log Archives:** Persistently stores the statistics and logs of your last 50 scraping sessions.

---

## 🚀 Quick Start Guide

### Prerequisites
1. **Node.js** (v18 or higher recommended)
2. **NPM** (Node Package Manager, comes with Node.js)
3. Google Chrome (Puppeteer will install its own Chromium version by default, but it's good to have).

### Installation

1. **Clone or Download** this repository to your local machine.
2. Open a terminal and navigate to the project directory:
   ```bash
   cd path/to/blog_scraper
   ```
3. Install the required dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Start the backend server:
   ```bash
   node server.js
   ```
2. Open your web browser and navigate to the Control Deck:
   **http://localhost:3000**

---

## 📖 How to Use the Scraper

There are two primary ways to feed URLs into Synthetica:

### Method 1: The CSV Intake Buffer (Bulk Operations)
1. Prepare a `.csv` file containing top-level domain URLs you want to scrape.
2. You can either:
   - Drop the `.csv` file directly into the `csv/` folder in your project directory.
   - Use the **Drag & Drop** feature on the web UI by dragging a `.csv` file anywhere onto the dashboard.
3. Click the glowing **Initiate** toggle switch.
4. The system will read the CSV, extract the URLs, and begin the parsing sequence.

### Method 2: Manual URL Entry (Quick Extractions)
1. On the web dashboard, click the **Paste URLs** button (link icon).
2. Paste your target URLs into the text area (one URL per line).
3. Click **Load URLs**.
4. Click the **Initiate** toggle switch to begin extraction.

### Finding Your Extracted Data
By default, successfully extracted markdown files will be saved in the `output/` directory located in your project root.

---

## ⚙️ Configuration

Click the **Settings** icon (the gear/tune symbol) in the top right corner of the dashboard to open the Configuration Drawer.

- **Concurrency:** The number of headless browser tabs to run simultaneously. (Default: 5). *Lower this if your CPU is struggling or if you are getting blocked by the target site.*
- **Timeout (ms):** The maximum time to wait for a page to load before considering it a failure.
- **Target File Directory:** The relative folder path where Synthetica looks for intake CSV files.
- **Output Destination:** The relative folder path where extracted Markdown files are saved.
- **Strip Images:** Toggle this on to remove all `<img>` tags from the final Markdown output.
- **Format / Naming Convention:** Choose whether you want the final `.md` files to be named based on the article's Title (`Title Slug`) or based on a timestamp.

---

## 🛡️ Reliability & Recovery

### The Anomaly Buffer
If a URL fails completely (even after 3 automatic retries), it is marked as an Anomaly.
- Anomalies will appear in a glowing orange panel at the bottom of the dashboard.
- You can review the specific network/parsing error for each failed URL.
- Click **Retry All** to clear the anomaly buffer and re-queue those URLs for another extraction attempt.

### Clearing History
Synthetica intentionally remembers every URL it successfully extracts (`processed_urls.json`) to prevent duplicating work if you accidentally feed it the same CSV twice. 
- If you *want* to re-scrape a previously scraped URL, click the **Clear History** button on the dashboard to purge the system's memory.

### Halting Operations
You can pause the system at any time by pressing the **Halt** button (or hitting the `Spacebar`). Active workers will finish their current URL and then wait until you resume. If the system hangs completely, use the red **Terminate** button for an emergency shutdown.

---

## Development Notes
*This application is currently architected to undergo porting into a compiled Tauri v2 desktop application. The frontend relies exclusively on REST APIs and Socket.IO for state propagation, decoupling it from Node.js specifics.*
