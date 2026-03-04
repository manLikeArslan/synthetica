const socket = io();

// === UI Elements ===
const initiateToggle = document.getElementById('initiate-toggle');
const toggleKnob = document.querySelector('.toggle-knob');
const pauseBtn = document.getElementById('pause-btn');
const pauseIcon = document.getElementById('pause-icon');
const pauseLabel = document.getElementById('pause-label');
const stopBtn = document.getElementById('stop-btn');
const logsWindow = document.getElementById('logs');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const etaText = document.getElementById('eta-text');
const statusLed = document.getElementById('status-led');
const statusText = document.getElementById('status-text');
const waveformLed = document.getElementById('waveform-led');

// New UX Actions
const pasteUrlBtn = document.getElementById('paste-url-btn');
const exportBtn = document.getElementById('export-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const appChassis = document.getElementById('app-chassis');
const dropOverlay = document.getElementById('drop-overlay');

// Paste Modal
const pasteModal = document.getElementById('paste-modal');
const pasteModalContent = document.getElementById('paste-modal-content');
const pasteClose = document.getElementById('paste-close');
const pasteCancel = document.getElementById('paste-cancel');
const pasteSubmit = document.getElementById('paste-submit');
const pasteTextarea = document.getElementById('paste-textarea');

// History Modal
const historyBtn = document.getElementById('history-btn');
const historyModal = document.getElementById('history-modal');
const historyModalContent = document.getElementById('history-modal-content');
const historyClose = document.getElementById('history-close');
const historyList = document.getElementById('history-list');

// Failed URLs Section
const failedUrlsSection = document.getElementById('failed-urls-section');
const failedUrlsList = document.getElementById('failed-urls-list');
const retryFailedBtn = document.getElementById('retry-failed-btn');

// Stat LCD Elements
const statsTotal = document.getElementById('stats-total');
const statsCurrent = document.getElementById('stats-current');
const statsSuccess = document.getElementById('stats-success');
const statsFailed = document.getElementById('stats-failed');

// Waveform Elements
const waveformLine = document.getElementById('waveform-line');
const waveformGhost = document.getElementById('waveform-ghost');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsDrawer = document.getElementById('settings-drawer');

// Config Inputs
const configInputs = {
    concurrency: document.getElementById('config-concurrency'),
    timeout: document.getElementById('config-timeout'),
    csvDir: document.getElementById('config-csvDir'),
    outputDir: document.getElementById('config-outputDir'),
    stripImages: document.getElementById('config-stripImages'),
    format: document.getElementById('config-format'),
    naming: document.getElementById('config-naming')
};
const labelConcurrency = document.getElementById('label-concurrency');

const bypassCsvBtn = document.getElementById('bypass-csv-btn');
const bypassOutputBtn = document.getElementById('bypass-output-btn');

// === State ===
let isRunning = false;
let isPaused = false;

// === Socket Connection ===
socket.on('connect', () => {
    setStatus('online', 'System Ready');
    addLog('System uplink established. Awaiting operator input.', 'system');
});

// Restore state if a scraping job is already running on the server
socket.on('sync-state', (data) => {
    if (data.isRunning) {
        isRunning = true;
        isPaused = data.isPaused;
        initiateToggle.checked = true;
        toggleKnob.classList.add('active');
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        waveformLed.classList.add('bg-safety-olive', 'animate-pulse');
        waveformLed.classList.remove('bg-ink/20');

        if (data.isPaused) {
            pauseIcon.textContent = 'play_arrow';
            pauseLabel.textContent = 'Resume';
            setStatus('paused', 'Sequence Halted');
        } else {
            setStatus('active', 'Extracting');
        }

        // Restore stats
        if (data.stats) {
            statsTotal.textContent = String(data.stats.total).padStart(4, '0');
            statsCurrent.textContent = String(data.stats.current).padStart(4, '0');
            statsSuccess.textContent = String(data.stats.success).padStart(4, '0');
            statsFailed.textContent = String(data.stats.failed).padStart(4, '0');
            if (data.stats.total > 0) {
                const pct = Math.round((data.stats.current / data.stats.total) * 100);
                progressBar.style.width = `${pct}%`;
                progressText.textContent = `${pct}%`;
            }
        }

        // Replay buffered logs
        if (data.logs && data.logs.length > 0) {
            logsWindow.innerHTML = ''; // Clear "awaiting" message
            // Show last 100 to avoid overwhelming the UI
            const recentLogs = data.logs.slice(-100);
            for (const msg of recentLogs) {
                let type = 'system';
                if (msg.includes('Success:') || msg.includes('color:#0f0')) type = 'success';
                else if (msg.includes('Failed:') || msg.includes('color:#f00')) type = 'error';
                else if (msg.includes('Skipping')) type = 'skip';
                addLog(msg, type);
            }
        }
        addLog('Reconnected to active extraction sequence.', 'system');
    }
});

socket.on('disconnect', () => {
    setStatus('offline', 'Offline');
    addLog('Uplink lost. Connection severed.', 'error');
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
});

// === UX Enhancements (Phase 2) ===

// Drag & Drop CSV
let dragCounter = 0;

appChassis.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
    setTimeout(() => dropOverlay.classList.remove('opacity-0'), 10);
});

appChassis.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        dropOverlay.classList.add('opacity-0');
        setTimeout(() => dropOverlay.classList.add('hidden'), 300);
    }
});

appChassis.addEventListener('dragover', (e) => e.preventDefault());

appChassis.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('opacity-0');
    setTimeout(() => dropOverlay.classList.add('hidden'), 300);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.csv')) {
            uploadCsv(file);
        } else {
            addLog(`<span style="color:#f00">Error: Only .csv files are supported.</span>`, 'error');
        }
    }
});

function uploadCsv(file) {
    addLog(`Uploading ${file.name}...`, 'system');
    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/upload-csv', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                addLog(`<span style="color:#0f0">Success:</span> ${file.name} loaded into intake buffer.`, 'system');
            } else {
                addLog(`<span style="color:#f00">Upload failed:</span> ${data.error}`, 'error');
            }
        })
        .catch(err => addLog(`<span style="color:#f00">Upload error:</span> ${err.message}`, 'error'));
}

// Paste URLs Modal
function togglePasteModal(show) {
    if (show) {
        pasteModal.classList.remove('hidden');
        setTimeout(() => {
            pasteModal.classList.remove('opacity-0');
            pasteModalContent.classList.remove('scale-95');
        }, 10);
        pasteTextarea.focus();
    } else {
        pasteModal.classList.add('opacity-0');
        pasteModalContent.classList.add('scale-95');
        setTimeout(() => pasteModal.classList.add('hidden'), 200);
    }
}

pasteUrlBtn.addEventListener('click', () => togglePasteModal(true));
pasteClose.addEventListener('click', () => togglePasteModal(false));
pasteCancel.addEventListener('click', () => togglePasteModal(false));

pasteSubmit.addEventListener('click', () => {
    const text = pasteTextarea.value.trim();
    if (!text) return togglePasteModal(false);

    const urls = text.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));

    if (urls.length === 0) {
        alert('No valid HTTP/HTTPS URLs found.');
        return;
    }

    pasteSubmit.disabled = true;
    pasteSubmit.textContent = 'Loading...';

    fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                addLog(`<span style="color:#0f0">Success:</span> ${urls.length} URLs loaded into temporary buffer.`, 'system');
                pasteTextarea.value = '';
                togglePasteModal(false);
            }
        })
        .catch(err => addLog(`<span style="color:#f00">Error passing URLs:</span> ${err.message}`, 'error'))
        .finally(() => {
            pasteSubmit.disabled = false;
            pasteSubmit.textContent = 'Load URLs';
        });
});

// Clear History
clearHistoryBtn.addEventListener('click', () => {
    if (confirm('WARNING: This will erase the memory of all previously extracted URLs. The sequence will re-extract them if they are encountered again. Proceed?')) {
        fetch('/api/processed', { method: 'DELETE' })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    addLog('<span style="color:#e35205">[SYSTEM] Extraction history buffer purged.</span>', 'system');
                }
            })
            .catch(err => console.error(err));
    }
});

// Export Results
exportBtn.addEventListener('click', () => {
    window.open('/api/export', '_blank');
});

// === Failed URLs Logic ===

function fetchFailedUrls() {
    fetch('/api/failed')
        .then(r => r.json())
        .then(data => {
            const urls = Object.keys(data);
            if (urls.length > 0) {
                // Show section
                failedUrlsSection.classList.remove('hidden');
                setTimeout(() => {
                    failedUrlsSection.classList.remove('opacity-0', 'translate-y-4');
                }, 10);

                // Populate list
                failedUrlsList.innerHTML = '';
                urls.forEach(url => {
                    const info = data[url];
                    const li = document.createElement('li');
                    li.className = 'border-b border-[#c5c2b5] pb-2 last:border-0';
                    li.innerHTML = `
                        <div class="truncate text-ink font-bold" title="${url}">${url}</div>
                        <div class="text-[10px] text-red-600/80">Error: ${info.error} (Attempts: ${info.attempts})</div>
                    `;
                    failedUrlsList.appendChild(li);
                });
            } else {
                // Hide section
                failedUrlsSection.classList.add('opacity-0', 'translate-y-4');
                setTimeout(() => {
                    failedUrlsSection.classList.add('hidden');
                }, 500);
            }
        })
        .catch(err => console.error("Failed to fetch anomalies:", err));
}

retryFailedBtn.addEventListener('click', () => {
    retryFailedBtn.disabled = true;
    retryFailedBtn.textContent = 'Queuing...';

    fetch('/api/retry-failed', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                addLog(`<span style="color:#0f0">[SYSTEM] Re-queued ${data.urls.length} failed URLs.</span>`, 'system');
                // Hide the panel
                failedUrlsSection.classList.add('opacity-0', 'translate-y-4');
                setTimeout(() => {
                    failedUrlsSection.classList.add('hidden');
                }, 500);
            }
        })
        .catch(err => addLog(`<span style="color:#f00">Error queuing retries:</span> ${err.message}`, 'error'))
        .finally(() => {
            retryFailedBtn.disabled = false;
            retryFailedBtn.textContent = 'Retry All';
        });
});

// Initialize UI
setStatus('offline', 'Offline');
pauseBtn.disabled = true;
stopBtn.disabled = true;

// Check for existing failures on load
fetchFailedUrls();

// === Run History Modal ===
function toggleHistoryModal(show) {
    if (show) {
        historyModal.classList.remove('hidden');
        setTimeout(() => {
            historyModal.classList.remove('opacity-0');
            historyModalContent.classList.remove('scale-95');
        }, 10);
        fetchHistory();
    } else {
        historyModal.classList.add('opacity-0');
        historyModalContent.classList.add('scale-95');
        setTimeout(() => historyModal.classList.add('hidden'), 200);
    }
}

function fetchHistory() {
    historyList.innerHTML = '<div class="text-center opacity-50 py-10">Accessing archives...</div>';

    fetch('/api/history')
        .then(r => r.json())
        .then(data => {
            if (data.length === 0) {
                historyList.innerHTML = '<div class="text-center opacity-50 py-10">No archives found.</div>';
                return;
            }

            historyList.innerHTML = '';
            data.forEach(run => {
                const date = new Date(run.date).toLocaleString();
                const rate = run.stats.total > 0 ? Math.round((run.stats.success / run.stats.total) * 100) : 0;

                const card = document.createElement('div');
                card.className = 'bg-panel border border-[#c5c2b5] p-4 rounded shadow-sm flex flex-col gap-2';

                let snippetHtml = '';
                if (run.finalLogSnippet && run.finalLogSnippet.length > 0) {
                    const logs = run.finalLogSnippet.map(l => `<div>${l}</div>`).join('');
                    snippetHtml = `<div class="mt-2 bg-lcd-bg text-lcd-text text-[10px] font-mono p-2 rounded max-h-24 overflow-y-auto border border-[#222]">${logs}</div>`;
                }

                card.innerHTML = `
                    <div class="flex justify-between items-center border-b border-[#c5c2b5] pb-2">
                        <span class="font-bold text-sm tracking-widest uppercase text-ink/80">${date}</span>
                        <span class="text-xs font-mono text-ink/60">ID: ${run.id}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-4 mt-2 font-mono text-xs">
                        <div class="flex flex-col"><span class="opacity-50 uppercase text-[9px]">Total Assigned</span><span class="font-bold">${run.stats.total}</span></div>
                        <div class="flex flex-col"><span class="opacity-50 uppercase text-[9px]">Success</span><span class="text-safety-olive font-bold">${run.stats.success}</span></div>
                        <div class="flex flex-col"><span class="opacity-50 uppercase text-[9px]">Anomalies</span><span class="text-signal-orange font-bold">${run.stats.failed}</span></div>
                        <div class="flex flex-col"><span class="opacity-50 uppercase text-[9px]">Extraction Rate</span><span class="font-bold">${rate}%</span></div>
                    </div>
                    ${snippetHtml}
                `;
                historyList.appendChild(card);
            });
        })
        .catch(err => {
            historyList.innerHTML = `<div class="text-center text-red-500 py-10">Error loading archives: ${err.message}</div>`;
        });
}

historyBtn.addEventListener('click', () => toggleHistoryModal(true));
historyClose.addEventListener('click', () => toggleHistoryModal(false));

// === Keyboard Shortcuts ===
window.addEventListener('keydown', (e) => {
    // Ignore if typing in input/textarea
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault(); // Stop page scrolling

        // If not running, hit start toggle
        if (!isRunning) {
            if (!initiateToggle.checked) {
                initiateToggle.checked = true;
                initiateToggle.dispatchEvent(new Event('change'));
            }
        } else {
            // If running, toggle pause
            if (isPaused) {
                socket.emit('resume-scraping');
            } else {
                socket.emit('pause-scraping');
            }
        }
    }
});

// === Settings Drawer Logic ===
function toggleSettings() {
    const isClosed = settingsDrawer.classList.contains('translate-x-full');
    if (isClosed) {
        settingsOverlay.classList.remove('hidden');
        // brief timeout for transition to apply
        setTimeout(() => {
            settingsOverlay.classList.remove('opacity-0');
            settingsDrawer.classList.remove('translate-x-full');
        }, 10);
    } else {
        settingsOverlay.classList.add('opacity-0');
        settingsDrawer.classList.add('translate-x-full');
        setTimeout(() => {
            settingsOverlay.classList.add('hidden');
        }, 300);
    }
}

settingsBtn.addEventListener('click', toggleSettings);
settingsClose.addEventListener('click', toggleSettings);
settingsOverlay.addEventListener('click', toggleSettings);

// === Config API Layer ===
let saveConfigTimeout;

function loadConfig() {
    fetch('/api/config')
        .then(r => r.json())
        .then(config => {
            configInputs.concurrency.value = config.concurrency;
            labelConcurrency.textContent = config.concurrency;
            configInputs.timeout.value = config.timeoutMs;
            configInputs.csvDir.value = config.csvDir;
            configInputs.outputDir.value = config.outputDir;
            configInputs.stripImages.checked = config.stripImages;
            configInputs.format.value = config.outputFormat;
            configInputs.naming.value = config.filenamePattern;
        })
        .catch(err => console.error("Failed to load config:", err));
}

function saveConfig() {
    const newConfig = {
        concurrency: parseInt(configInputs.concurrency.value, 10),
        timeoutMs: parseInt(configInputs.timeout.value, 10),
        csvDir: configInputs.csvDir.value,
        outputDir: configInputs.outputDir.value,
        stripImages: configInputs.stripImages.checked,
        outputFormat: configInputs.format.value,
        filenamePattern: configInputs.naming.value
    };

    fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
    })
        .catch(err => console.error("Failed to save config:", err));
}

// Attach debounce listeners to all inputs
function onConfigChange() {
    if (configInputs.concurrency.value) {
        labelConcurrency.textContent = configInputs.concurrency.value;
    }
    clearTimeout(saveConfigTimeout);
    saveConfigTimeout = setTimeout(saveConfig, 400); // 400ms debounce
}

Object.values(configInputs).forEach(input => {
    input.addEventListener('input', onConfigChange);
});

// Sync config changes made by other clients
socket.on('config-updated', (config) => {
    configInputs.concurrency.value = config.concurrency;
    labelConcurrency.textContent = config.concurrency;
    configInputs.timeout.value = config.timeoutMs;
    configInputs.csvDir.value = config.csvDir;
    configInputs.outputDir.value = config.outputDir;
    configInputs.stripImages.checked = config.stripImages;
    configInputs.format.value = config.outputFormat;
    configInputs.naming.value = config.filenamePattern;
});

// Bypass button logic (since we can't easily open native dir pickers in plain browser yet)
// We will simulate it with a prompt for now, to be replaced by Tauri dialog API later.
if (bypassCsvBtn) {
    bypassCsvBtn.addEventListener('click', () => {
        const newPath = prompt('Enter new path for Target File Directory (CSV intake):', configInputs.csvDir.value);
        if (newPath !== null && newPath.trim() !== '') {
            configInputs.csvDir.value = newPath.trim();
            onConfigChange();
        }
    });
}
if (bypassOutputBtn) {
    bypassOutputBtn.addEventListener('click', () => {
        const newPath = prompt('Enter new path for Output Destination (Markdown exports):', configInputs.outputDir.value);
        if (newPath !== null && newPath.trim() !== '') {
            configInputs.outputDir.value = newPath.trim();
            onConfigChange();
        }
    });
}

// Load config on startup
loadConfig();

// === Initiate Toggle ===
document.getElementById('start-btn').addEventListener('click', (e) => {
    // Prevent default to manually handle the toggle state and prevent bounce
    e.preventDefault();
    if (!isRunning) {
        initiateToggle.checked = true;
        startScraping();
    }
});

function startScraping() {
    isRunning = true;
    isPaused = false;
    toggleKnob.classList.add('active');
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    setStatus('active', 'Extracting');
    waveformLed.classList.add('bg-safety-olive', 'animate-pulse');
    waveformLed.classList.remove('bg-ink/20');
    etaText.classList.add('hidden');

    // Reset UI
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statsTotal.textContent = '0000';
    statsCurrent.textContent = '0000';
    statsSuccess.textContent = '0000';
    statsFailed.textContent = '0000';
    logsWindow.innerHTML = '';
    waveformData = [];
    drawWaveform();

    socket.emit('start-scraping');
}

function resetToIdle() {
    isRunning = false;
    isPaused = false;
    initiateToggle.checked = false;
    toggleKnob.classList.remove('active');
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    pauseIcon.textContent = 'pause';
    pauseLabel.textContent = 'Halt';
    setStatus('online', 'System Ready');
    waveformLed.classList.remove('bg-safety-olive', 'animate-pulse');
    waveformLed.classList.add('bg-ink/20');
    etaText.classList.add('hidden');
}

// === Pause / Resume ===
pauseBtn.addEventListener('click', () => {
    if (!isRunning) return;
    if (isPaused) {
        socket.emit('resume-scraping');
    } else {
        socket.emit('pause-scraping');
    }
});

// === Stop / Terminate ===
stopBtn.addEventListener('click', () => {
    if (!isRunning) return;
    socket.emit('stop-scraping');
});

// === State Sync from Server ===
socket.on('state-changed', (data) => {
    if (data.state === 'paused') {
        isPaused = true;
        pauseIcon.textContent = 'play_arrow';
        pauseLabel.textContent = 'Resume';
        setStatus('paused', 'Sequence Halted');
    } else if (data.state === 'running') {
        isPaused = false;
        pauseIcon.textContent = 'pause';
        pauseLabel.textContent = 'Halt';
        setStatus('active', 'Extracting');
    } else if (data.state === 'stopped') {
        resetToIdle();
    }
});

// === Data Events ===
socket.on('log', (message) => {
    let type = 'system';
    if (message.includes('Success:') || message.includes('color:#0f0')) {
        type = 'success';
    } else if (message.includes('Failed:') || message.includes('color:#f00')) {
        type = 'error';
    } else if (message.includes('Skipping')) {
        type = 'skip';
    }
    addLog(message, type);
});

// Waveform driven by actual response time data from server
socket.on('waveform-data', (data) => {
    if (data.type === 'success') {
        // Normalize response time: 0ms = 0, 30000ms = 1.0 (full amplitude)
        const normalized = Math.min(data.responseMs / 15000, 1.0);
        pushWaveformPoint(normalized);
    } else if (data.type === 'error') {
        // Errors spike downward
        pushWaveformPoint(-0.8);
    }
});

socket.on('stats', (stats) => {
    statsTotal.textContent = String(stats.total).padStart(4, '0');
    statsCurrent.textContent = String(stats.current).padStart(4, '0');
    statsSuccess.textContent = String(stats.success).padStart(4, '0');
    statsFailed.textContent = String(stats.failed).padStart(4, '0');
});

socket.on('progress', (data) => {
    if (data.total > 0) {
        const percentage = Math.round((data.current / data.total) * 100);
        progressBar.style.width = `${percentage}%`;
        progressText.innerText = `${percentage}%`;

        // Handle ETA display
        if (data.etaSeconds !== undefined) {
            etaText.classList.remove('hidden');
            if (data.etaSeconds === 0) {
                etaText.innerText = 'ETA: Calc...';
            } else {
                const mins = Math.floor(data.etaSeconds / 60);
                const secs = data.etaSeconds % 60;
                etaText.innerText = `ETA: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        }
    }
});

socket.on('done', () => {
    addLog('Operation cycle completed. All buffers flushed.', 'system');
    resetToIdle();
});

// === Helpers ===

function setStatus(state, label) {
    statusText.textContent = label;
    statusLed.className = 'w-3 h-3 rounded-full transition-all duration-500';
    if (state === 'online') {
        statusLed.classList.add('bg-safety-olive', 'shadow-[0_0_8px_rgba(95,107,78,0.8)]', 'animate-pulse');
    } else if (state === 'active') {
        statusLed.classList.add('bg-safety-olive', 'shadow-[0_0_8px_rgba(95,107,78,0.8)]', 'animate-pulse');
    } else if (state === 'paused') {
        statusLed.classList.add('bg-signal-orange', 'shadow-[0_0_8px_rgba(227,82,5,0.6)]');
    } else {
        statusLed.classList.add('bg-ink/30');
    }
}

function addLog(message, type = 'system') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerHTML = message.replace(/<span style="[^"]*">/g, '').replace(/<\/span>/g, '');
    logsWindow.appendChild(el);
    logsWindow.scrollTop = logsWindow.scrollHeight;
}

// ========================================
// === Waveform Engine (Response Times + Noise Floor) ===
// ========================================

const WAVEFORM_MAX_POINTS = 120;
let waveformData = new Array(WAVEFORM_MAX_POINTS).fill(0);
let noisePhase = 0;

function pushWaveformPoint(value) {
    waveformData.push(value);
    if (waveformData.length > WAVEFORM_MAX_POINTS) {
        waveformData.shift();
    }
    drawWaveform();
}

// Noise floor: gentle oscillation that's always active during scraping
// Creates the "alive" feeling of an analog instrument
function generateNoise() {
    noisePhase += 0.15;
    const noise =
        Math.sin(noisePhase) * 0.04 +
        Math.sin(noisePhase * 2.3) * 0.025 +
        Math.sin(noisePhase * 5.7) * 0.015 +
        (Math.random() - 0.5) * 0.03;
    return noise;
}

function drawWaveform() {
    const svgWidth = 1000;
    const svgHeight = 200;
    const centerY = svgHeight / 2;
    const amplitude = 85;

    const stepX = svgWidth / (WAVEFORM_MAX_POINTS - 1);

    // Build SVG path using smooth curves (cubic bezier via "S" command)
    let pathMain = `M 0,${centerY}`;
    let pathGhost = `M 0,${centerY + 5}`;

    for (let i = 0; i < waveformData.length; i++) {
        const x = i * stepX;
        const val = waveformData[i];
        const y = centerY - (val * amplitude);

        if (i === 0) {
            pathMain = `M ${x},${y}`;
            pathGhost = `M ${x},${y + 5}`;
        } else {
            // Smooth cubic bezier: control point at midpoint x
            const prevX = (i - 1) * stepX;
            const cpX = (prevX + x) / 2;
            pathMain += ` S ${cpX},${y} ${x},${y}`;
            pathGhost += ` S ${cpX},${y + 5} ${x},${y + 5}`;
        }
    }

    waveformLine.setAttribute('points', ''); // clear polyline
    waveformGhost.setAttribute('points', '');

    // Switch to <path> if not already
    if (waveformLine.tagName === 'polyline') {
        // Polylines can't do bezier; swap attribute to d won't work.
        // Instead, set points to approximate the path with many points
        let mainPoints = '';
        let ghostPoints = '';
        for (let i = 0; i < waveformData.length; i++) {
            const x = i * stepX;
            const val = waveformData[i];
            const y = centerY - (val * amplitude);

            // Interpolate between points for smoothness
            if (i > 0) {
                const prevVal = waveformData[i - 1];
                const prevY = centerY - (prevVal * amplitude);
                const prevX = (i - 1) * stepX;
                // Add 2 interpolation points
                for (let t = 0.33; t <= 0.67; t += 0.34) {
                    const ix = prevX + (x - prevX) * t;
                    // Smooth cubic interpolation
                    const smoothT = t * t * (3 - 2 * t); // smoothstep
                    const iy = prevY + (y - prevY) * smoothT;
                    mainPoints += `${ix},${iy} `;
                    ghostPoints += `${ix},${iy + 5} `;
                }
            }
            mainPoints += `${x},${y} `;
            ghostPoints += `${x},${y + 5} `;
        }
        waveformLine.setAttribute('points', mainPoints.trim());
        waveformGhost.setAttribute('points', ghostPoints.trim());
    }
}

// Noise floor ticker — adds gentle noise when running, slow decay when idle
let noiseInterval = setInterval(() => {
    if (isRunning && !isPaused) {
        // Inject noise floor point (tiny oscillation keeps waveform alive)
        const noise = generateNoise();
        pushWaveformPoint(noise);
    } else if (isRunning && isPaused) {
        // Paused: flatline slowly
        pushWaveformPoint(generateNoise() * 0.3);
    } else {
        // Idle: decay towards zero with very faint noise
        if (waveformData.some(v => Math.abs(v) > 0.005)) {
            pushWaveformPoint(generateNoise() * 0.1);
        }
    }
}, 200);

// Initial draw
drawWaveform();
