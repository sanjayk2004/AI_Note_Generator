/**
 * AI Study Notes Generator - Main Frontend Script
 * Preserves all Flask backend routes: /upload, /process-text, /generate, /export, /history, /chat
 * 
 * FIXED: Flashcard flip, Important Questions answer reveal, History save/load, Service Worker handling
 */

// ============================================
// State Management & Global Registry
// ============================================
const AppState = {
    extractedText: null,
    fileName: null,
    stats: null,
    currentResults: null,
    isUploading: false,
    isGenerating: false,
    darkMode: false,
    currentFlashcardIndex: 0,
    flashcards: [],
    currentQuizType: 'mcq',
    currentDiff: 'easy',
    currentSummary: 'short',
    currentCardView: 'single',
    chatHistory: [],
    isChatLoading: false
};

const ActiveLoops = {
    cursorFrameId: null,
    countUpFrameIds: []
};

// ============================================
// DOM Elements Cache
// ============================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// Fetch & Markdown Helpers (Issues #8, #9, #13)
// ============================================
async function secureFetch(url, options = {}) {
    const defaultOptions = {
        credentials: 'same-origin',
        mode: 'cors',
        headers: {
            ...options.headers
        }
    };
    const mergedOptions = { ...options, ...defaultOptions };
    if (options.headers && typeof options.headers === 'object') {
        mergedOptions.headers = { ...options.headers, ...defaultOptions.headers };
    }
    const response = await fetch(url, mergedOptions);
    if (!response.ok) {
        let errMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
            const data = await response.json();
            if (data && data.error) errMsg = data.error;
        } catch (e) {}
        throw new Error(errMsg);
    }
    return response;
}

function safeMarkedParse(text) {
    if (!text) return '';
    try {
        return marked.parse(text);
    } catch (e) {
        console.error('Markdown parse error:', e);
        return `<pre class="error-markdown-fallback">${escapeHtml(text)}</pre>`;
    }
}

function makeTabsAccessible(tabsSelector) {
    $$(tabsSelector).forEach(tab => {
        tab.setAttribute('role', 'tab');
        tab.setAttribute('tabindex', '0');
        tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tab.click();
            }
        });
    });
}

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initCustomCursor();
    initUpload();
    initPasteText();
    initInputTabs();
    initGenerate();
    initResultTabs();
    initSummaryTabs();
    initQuizTabs();
    initDiffTabs();
    initFlashcardNav();
    initExport();
    initHistory();
    initCopyButtons();
    initKeyboardShortcuts();
    initChat();
    initAnimations();
    initKeyConceptsDelegation();
    updateGenerateButton();

    // FIXED: Initialize Service Worker with proper update handling (Issue #4)
    initServiceWorker();

    // Register beforeunload cleanup (Issue #15)
    window.addEventListener('beforeunload', () => {
        if (ActiveLoops.cursorFrameId) {
            cancelAnimationFrame(ActiveLoops.cursorFrameId);
        }
        ActiveLoops.countUpFrameIds.forEach(id => cancelAnimationFrame(id));
    });
});

// ============================================
// Service Worker - FIXED for stale cache and API interference (Issue #4)
// ============================================
function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js')
        .then(registration => {
            console.log('SW registered:', registration.scope);

            // Handle updates - notify user and skip waiting
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('New SW available, skipping waiting...');
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            // Listen for messages from SW
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'RELOAD_PAGE') {
                    window.location.reload();
                }
            });
        })
        .catch(err => console.error('SW registration failed:', err));
}

// ============================================
// Custom Cursor Animation
// ============================================
function initCustomCursor() {
    const ball = $('cursorBall');
    const trail = $('cursorTrail');
    if (!ball || !trail) return;
    if (window.matchMedia('(pointer: coarse)').matches) {
        ball.style.display = 'none';
        trail.style.display = 'none';
        document.body.style.cursor = 'auto';
        return;
    }
    let mouseX = 0, mouseY = 0;
    let ballX = 0, ballY = 0;
    let trailX = 0, trailY = 0;
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    function animateCursor() {
        ballX += (mouseX - ballX) * 0.15;
        ballY += (mouseY - ballY) * 0.15;
        trailX += (mouseX - trailX) * 0.08;
        trailY += (mouseY - trailY) * 0.08;
        ball.style.left = ballX + 'px';
        ball.style.top = ballY + 'px';
        trail.style.left = trailX + 'px';
        trail.style.top = trailY + 'px';
        ActiveLoops.cursorFrameId = requestAnimationFrame(animateCursor);
    }
    animateCursor();
    const interactiveElements = 'button, a, .drop-zone, .quiz-option, .flashcard, .result-tab, .suggested-chip, .concept-card, .question-header';
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest(interactiveElements)) ball.classList.add('cursor-hover');
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest(interactiveElements)) ball.classList.remove('cursor-hover');
    });
    document.addEventListener('mousedown', () => ball.classList.add('cursor-click'));
    document.addEventListener('mouseup', () => ball.classList.remove('cursor-click'));
}

// ============================================
// Scroll Animations
// ============================================
function initAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                if (entry.target.classList.contains('animated-stat')) {
                    const valueEl = entry.target.querySelector('.stat-value');
                    if (valueEl && !entry.target.classList.contains('counted')) {
                        animateCountUp(valueEl);
                        entry.target.classList.add('counted');
                    }
                }
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.stat-card, .result-panel, .concept-card, .question-card').forEach(el => {
        el.classList.add('animate-on-scroll');
        observer.observe(el);
    });
}

function animateCountUp(element) {
    const text = element.textContent;
    const numMatch = text.match(/[\d,]+/);
    if (!numMatch) return;
    const target = parseInt(numMatch[0].replace(/,/g, ''));
    const suffix = text.replace(numMatch[0], '');
    const duration = 1500;
    const start = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - start;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(target * easeOut);
        element.textContent = current.toLocaleString() + suffix;
        if (progress < 1) {
            const frameId = requestAnimationFrame(update);
            ActiveLoops.countUpFrameIds.push(frameId);
        }
        else element.textContent = target.toLocaleString() + suffix;
    }
    const initialFrameId = requestAnimationFrame(update);
    ActiveLoops.countUpFrameIds.push(initialFrameId);
}

// ============================================
// Input Tabs (Upload vs Paste)
// ============================================
function initInputTabs() {
    const tabs = $$('.input-tab');
    const panels = { upload: $('uploadPanel'), paste: $('pastePanel') };
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(panels).forEach(p => p.classList.remove('active'));
            panels[tab.dataset.tab].classList.add('active');
            AppState.extractedText = null;
            updateGenerateButton();
        });
    });
}

// ============================================
// File Upload
// ============================================
function initUpload() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    dropZone?.addEventListener('click', (e) => {
        if (!e.target.closest('.file-remove')) fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropZone?.addEventListener(evt, preventDefaults);
    });
    ['dragenter', 'dragover'].forEach(evt => {
        dropZone?.addEventListener(evt, () => dropZone.classList.add('dragover'));
    });
    ['dragleave', 'drop'].forEach(evt => {
        dropZone?.addEventListener(evt, () => dropZone.classList.remove('dragover'));
    });
    dropZone?.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files[0]) handleFile(files[0]);
    });
    $('removeFile')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile();
    });
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

async function handleFile(file) {
    const allowedExts = ['pdf', 'docx', 'pptx', 'txt'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
        showToast('Please upload PDF, DOCX, PPTX, or TXT files only', 'error');
        return;
    }
    const allowedMimeTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain'
    ];
    if (file.type && !allowedMimeTypes.includes(file.type)) {
        showToast('Invalid file format. Please upload PDF, DOCX, PPTX, or TXT files only', 'error');
        return;
    }
    if (file.size > 16 * 1024 * 1024) {
        showToast('File size must be less than 16MB', 'error');
        return;
    }
    showFilePreview(file);
    await uploadFile(file);
}

function showFilePreview(file) {
    const preview = $('filePreview');
    const nameEl = $('fileName');
    const sizeEl = $('fileSize');
    const iconEl = $('fileTypeIcon');
    nameEl.textContent = file.name;
    sizeEl.textContent = formatFileSize(file.size);
    const ext = file.name.split('.').pop().toLowerCase();
    const icons = { pdf: 'fa-file-pdf', docx: 'fa-file-word', pptx: 'fa-file-powerpoint', txt: 'fa-file-lines' };
    iconEl.className = 'fas ' + (icons[ext] || 'fa-file');
    preview.style.display = 'block';
    preview.classList.add('slide-up');
}

function removeFile() {
    $('fileInput').value = '';
    $('filePreview').style.display = 'none';
    AppState.extractedText = null;
    AppState.fileName = null;
    AppState.stats = null;
    $('textStats').style.display = 'none';
    updateGenerateButton();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function uploadFile(file) {
    AppState.isUploading = true;
    updateGenerateButton();
    showProgress('Uploading file...', 10);
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await secureFetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Upload failed');
        if (!data.text || data.text.trim().length === 0) throw new Error('No text could be extracted from this file');
        AppState.extractedText = data.text;
        AppState.fileName = data.filename;
        AppState.stats = data.statistics;
        showStats(data.statistics);
        showProgress('Text extracted!', 100);
        setTimeout(hideProgress, 500);
        showToast('File uploaded successfully!', 'success');
    } catch (error) {
        hideProgress();
        console.error('Upload error:', error);
        showToast(error.message, 'error');
        removeFile();
    } finally {
        AppState.isUploading = false;
        updateGenerateButton();
    }
}

// ============================================
// Paste Text
// ============================================
function initPasteText() {
    const textInput = $('textInput');
    const charCounter = $('charCounter');
    const clearBtn = $('clearText');
    textInput?.addEventListener('input', () => {
        const len = textInput.value.length;
        charCounter.textContent = len.toLocaleString() + ' characters';
        if (len > 100) debounceProcessText(textInput.value);
    });
    clearBtn?.addEventListener('click', () => {
        textInput.value = '';
        charCounter.textContent = '0 characters';
        AppState.extractedText = null;
        $('textStats').style.display = 'none';
        updateGenerateButton();
    });
}

let processTextTimeout;
function debounceProcessText(text) {
    clearTimeout(processTextTimeout);
    processTextTimeout = setTimeout(() => processText(text), 1000);
}

async function processText(text) {
    if (!text.trim() || text.length < 50) return;
    AppState.isUploading = true;
    updateGenerateButton();
    showProgress('Processing text...', 20);
    try {
        const response = await secureFetch('/process-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Processing failed');
        AppState.extractedText = data.text;
        AppState.stats = data.statistics;
        showStats(data.statistics);
        showProgress('Text processed!', 100);
        setTimeout(hideProgress, 500);
        showToast('Text processed successfully!', 'success');
    } catch (error) {
        hideProgress();
        showToast(error.message, 'error');
    } finally {
        AppState.isUploading = false;
        updateGenerateButton();
    }
}

function showStats(stats) {
    if (!stats) return;
    $('statWords').textContent = stats.word_count?.toLocaleString() || 0;
    $('statReading').textContent = stats.reading_time || '0 min';
    $('statStudy').textContent = stats.study_time || '0 min';
    $('statParagraphs').textContent = stats.paragraph_count || 0;
    const statsContainer = $('textStats');
    statsContainer.style.display = 'flex';
    statsContainer.classList.add('slide-up');
}

// ============================================
// Progress Bar
// ============================================
function showProgress(label, percent) {
    const container = $('progressContainer');
    const labelEl = $('progressLabel');
    const percentEl = $('progressPercent');
    const fill = $('progressFill');
    container.style.display = 'block';
    labelEl.textContent = label;
    percentEl.textContent = Math.round(percent) + '%';
    fill.style.width = percent + '%';
}

function hideProgress() {
    $('progressContainer').style.display = 'none';
    $('progressFill').style.width = '0%';
}

function updateProgressSteps(step) {
    for (let i = 1; i <= 5; i++) {
        const el = $('step' + i);
        if (!el) continue;
        if (i < step) {
            el.className = 'step done';
            el.querySelector('i').className = 'fas fa-check';
        } else if (i === step) {
            el.className = 'step active';
            el.querySelector('i').className = 'fas fa-circle-notch fa-spin';
        } else {
            el.className = 'step';
            el.querySelector('i').className = 'fas fa-circle-notch';
        }
    }
}

// ============================================
// Generate Button
// ============================================
function initGenerate() {
    $('generateBtn')?.addEventListener('click', handleGenerate);
}

function updateGenerateButton() {
    const btn = $('generateBtn');
    const hint = $('generateHint');
    if (!btn) {
        console.error('generateBtn not found in DOM!');
        return;
    }
    const hasText = AppState.extractedText !== null && AppState.extractedText !== undefined && AppState.extractedText.length > 0;
    const shouldDisable = !hasText || AppState.isUploading || AppState.isGenerating;
    btn.disabled = shouldDisable;
    btn.style.pointerEvents = shouldDisable ? 'none' : 'auto';
    btn.style.opacity = shouldDisable ? '0.6' : '1';
    if (hasText) hint.textContent = 'Ready to generate! Click the button above.';
    else hint.textContent = 'Upload a file or paste text to get started';
}

async function handleGenerate() {
    if (!AppState.extractedText || AppState.isGenerating) return;
    AppState.isGenerating = true;
    updateGenerateButton();
    $('progressContainer').style.display = 'block';
    updateProgressSteps(2);
    showProgress('Generating study materials...', 30);
    try {
        const response = await secureFetch('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: AppState.extractedText,
                options: {
                    summary: true,
                    study_notes: true,
                    flashcards: true,
                    quiz: true,
                    important_questions: true,
                    cheat_sheet: true,
                    key_concepts: true
                }
            })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Generation failed');
        AppState.currentResults = data.results;
        AppState.stats = data.statistics;

        // FIXED: Save to history after successful generation (Issue #3)
        // The backend might auto-save, but we explicitly save to ensure history works
        await saveToHistory(data.results, data.statistics);

        updateProgressSteps(5);
        showProgress('Complete!', 100);
        setTimeout(() => {
            hideProgress();
            displayResults(data.results);
            showToast('Study materials generated!', 'success');
        }, 500);
    } catch (error) {
        hideProgress();
        showToast(error.message, 'error');
    } finally {
        AppState.isGenerating = false;
        updateGenerateButton();
    }
}

// FIXED: New function to save generated results to history (Issue #3)
async function saveToHistory(results, statistics) {
    try {
        // Try the most common endpoint patterns
        const payload = {
            results: results,
            statistics: statistics,
            filename: AppState.fileName,
            timestamp: new Date().toISOString()
        };

        // Try /history with POST first (most RESTful)
        let saved = false;
        try {
            const resp = await secureFetch('/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.success) saved = true;
        } catch (e) {
            console.log('POST /history failed, trying alternative endpoints...');
        }

        // Fallback: try /save-history
        if (!saved) {
            try {
                const resp = await secureFetch('/save-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                if (data.success) saved = true;
            } catch (e) {
                console.log('POST /save-history also failed:', e.message);
            }
        }

        if (!saved) {
            console.warn('History could not be saved to backend. History may not persist across sessions.');
        }
    } catch (error) {
        console.error('Error saving history:', error);
        // Non-critical: don't block user if history save fails
    }
}
// ============================================
// Display Results — FIXED for backend data format
// ============================================
function displayResults(results) {
    try {
        const resultsSection = $('resultsSection');
        resultsSection.style.display = 'block';
        resultsSection.classList.add('fade-in');

        if (results.summary) {
            try {
                const summaries = parseSummaries(results.summary);
                AppState.summaries = summaries;
                renderSummary(summaries.short);
            } catch (e) {
                console.error("Error parsing summary:", e);
                $('summaryContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display summary.</div>`;
            }
        }

        if (results.study_notes) {
            try {
                // Backend sends {content: "..."} — unwrap it
                const notesText = typeof results.study_notes === 'string' 
                    ? results.study_notes 
                    : (results.study_notes.content || JSON.stringify(results.study_notes));
                $('notesContent').innerHTML = safeMarkedParse(notesText);
            } catch (e) {
                console.error("Error parsing study notes:", e);
                $('notesContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display study notes.</div>`;
            }
        }

        if (results.flashcards) {
            try {
                // Backend sends {flashcards: [...]} — unwrap the array
                AppState.flashcards = Array.isArray(results.flashcards) 
                    ? results.flashcards 
                    : (results.flashcards?.flashcards || []);
                renderFlashcards();
            } catch (e) {
                console.error("Error parsing flashcards:", e);
                $('flashcardsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display flashcards.</div>`;
            }
        }

        if (results.quiz) {
            try {
                // Backend sends {mcq:[], true_false:[], fill_blank:[], short_answer:[]}
                // Flatten into array with type property for renderQuiz()
                let quizArray = [];
                if (Array.isArray(results.quiz)) {
                    quizArray = results.quiz;
                } else if (results.quiz && typeof results.quiz === 'object') {
                    const types = ['mcq', 'true_false', 'fill_blank', 'short_answer'];
                    types.forEach(type => {
                        if (results.quiz[type] && Array.isArray(results.quiz[type])) {
                            results.quiz[type].forEach(q => {
                                if (type === 'mcq') {
                                    let normalizedOptions = [];
                                    let correctIdx = 0;
                                    if (Array.isArray(q.options)) {
                                        normalizedOptions = q.options;
                                        correctIdx = typeof q.correct_index === 'number' 
                                            ? q.correct_index 
                                            : (typeof q.correct_answer === 'number' ? q.correct_answer : 0);
                                    } else if (q.options && typeof q.options === 'object') {
                                        const keys = ['A', 'B', 'C', 'D'];
                                        keys.forEach((key, idx) => {
                                            if (q.options[key] !== undefined) {
                                                normalizedOptions.push(q.options[key]);
                                                if (q.correct_answer === key || q.correct_answer === idx) {
                                                    correctIdx = idx;
                                                }
                                            }
                                        });
                                        if (normalizedOptions.length === 0) {
                                            const entryKeys = Object.keys(q.options);
                                            entryKeys.forEach((key, idx) => {
                                                normalizedOptions.push(q.options[key]);
                                                if (q.correct_answer === key || q.correct_answer === idx) {
                                                    correctIdx = idx;
                                                }
                                            });
                                        }
                                    }
                                    q.options = normalizedOptions;
                                    q.correct_index = correctIdx;
                                }
                                quizArray.push({...q, type: type});
                            });
                        }
                    });
                }
                AppState.quiz = quizArray;
                renderQuiz('mcq');
            } catch (e) {
                console.error("Error parsing quiz:", e);
                $('quizContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display quiz.</div>`;
            }
        }

        if (results.important_questions) {
            try {
                // Backend sends {easy:[], medium:[], hard:[]}
                // Flatten into array with difficulty property for renderQuestions()
                let questionsArray = [];
                if (Array.isArray(results.important_questions)) {
                    questionsArray = results.important_questions;
                } else if (results.important_questions && typeof results.important_questions === 'object') {
                    const levels = ['easy', 'medium', 'hard'];
                    levels.forEach(level => {
                        if (results.important_questions[level] && Array.isArray(results.important_questions[level])) {
                            results.important_questions[level].forEach(q => {
                                questionsArray.push({...q, difficulty: level});
                            });
                        }
                    });
                }
                AppState.questions = questionsArray;
                renderQuestions('easy');
            } catch (e) {
                console.error("Error parsing important questions:", e);
                $('questionsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display important questions.</div>`;
            }
        }

        if (results.cheat_sheet) {
            try {
                const cheatText = typeof results.cheat_sheet === 'string'
                    ? results.cheat_sheet
                    : (results.cheat_sheet.content || JSON.stringify(results.cheat_sheet));
                $('cheatContent').innerHTML = safeMarkedParse(cheatText);
            } catch (e) {
                console.error("Error parsing cheat sheet:", e);
                $('cheatContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display cheat sheet.</div>`;
            }
        }

        if (results.key_concepts) {
            try {
                let conceptsArray = [];
                const kc = results.key_concepts;
                if (Array.isArray(kc)) {
                    conceptsArray = kc;
                } else if (kc && typeof kc === 'object') {
                    if (Array.isArray(kc.important_terms)) {
                        kc.important_terms.forEach(t => conceptsArray.push({ term: t.term, definition: t.definition, category: 'Term' }));
                    }
                    if (Array.isArray(kc.key_people)) {
                        kc.key_people.forEach(p => conceptsArray.push({ term: p.name, definition: p.significance, category: 'Person' }));
                    }
                    if (Array.isArray(kc.important_dates)) {
                        kc.important_dates.forEach(d => conceptsArray.push({ term: d.date, definition: d.event, category: 'Date' }));
                    }
                    if (Array.isArray(kc.formulas_rules)) {
                        kc.formulas_rules.forEach(f => conceptsArray.push({ term: f.name + (f.formula ? ` (${f.formula})` : ''), definition: f.description, category: 'Formula/Rule' }));
                    }
                }
                AppState.key_concepts = conceptsArray;
                renderKeyConcepts(conceptsArray);
            } catch (e) {
                console.error("Error parsing key concepts:", e);
                $('conceptsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to display key concepts.</div>`;
            }
        }

        // Reset chat when new results are generated
        resetChat();

        $('resultsSection').scrollIntoView({ behavior: 'smooth' });
    } catch (globalError) {
        console.error("Critical error in displayResults:", globalError);
        showToast("Error displaying generated content. Please check logs.", "error");
    }
}
function parseSummaries(summary) {
    if (typeof summary === 'string') {
        const result = { short: summary, medium: summary, detailed: summary };
        const shortMatch = summary.match(/(?:SHORT SUMMARY|Short Summary|## Short)[\s\S]*?(?=(?:MEDIUM SUMMARY|Medium Summary|## Medium|MEDIUM|$))/i);
        const mediumMatch = summary.match(/(?:MEDIUM SUMMARY|Medium Summary|## Medium)[\s\S]*?(?=(?:DETAILED SUMMARY|Detailed Summary|## Detailed|DETAILED|$))/i);
        const detailedMatch = summary.match(/(?:DETAILED SUMMARY|Detailed Summary|## Detailed)[\s\S]*?$/i);
        if (shortMatch) result.short = shortMatch[0].replace(/.*?(?:SHORT SUMMARY|Short Summary|## Short)\s*/i, '');
        if (mediumMatch) result.medium = mediumMatch[0].replace(/.*?(?:MEDIUM SUMMARY|Medium Summary|## Medium)\s*/i, '');
        if (detailedMatch) result.detailed = detailedMatch[0].replace(/.*?(?:DETAILED SUMMARY|Detailed Summary|## Detailed)\s*/i, '');
        return result;
    }

    // If it's already an object structured as {short: {content: "..."}, ...}
    const shortText = summary?.short?.content || summary?.short || '';
    const mediumText = summary?.medium?.content || summary?.medium || '';
    const detailedText = summary?.detailed?.content || summary?.detailed || '';
    return {
        short: shortText || JSON.stringify(summary),
        medium: mediumText || shortText || JSON.stringify(summary),
        detailed: detailedText || mediumText || JSON.stringify(summary)
    };
}

// ============================================
// Result Tabs
// ============================================
function initResultTabs() {
    const tabs = $$('.result-tab');
    const panels = $$('.result-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            const target = tab.dataset.result;
            panels.forEach(p => {
                if (p.id === 'panel-' + target) {
                    p.classList.add('active');
                    p.classList.add('slide-in');
                    setTimeout(() => p.classList.remove('slide-in'), 400);
                } else {
                    p.classList.remove('active');
                }
            });
        });
    });
    makeTabsAccessible('.result-tab');
}

// ============================================
// Summary Tabs
// ============================================
function initSummaryTabs() {
    const tabs = $$('.summary-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            const type = tab.dataset.summary;
            if (AppState.summaries?.[type]) renderSummary(AppState.summaries[type]);
        });
    });
    makeTabsAccessible('.summary-tab');
}

function renderSummary(text) {
    try {
        const content = $('summaryContent');
        content.style.opacity = '0';
        setTimeout(() => {
            content.innerHTML = safeMarkedParse(text);
            content.style.opacity = '1';
        }, 200);
    } catch (error) {
        console.error('Error rendering summary:', error);
        $('summaryContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to render summary.</div>`;
    }
}

// ============================================
// Flashcards — FIXED flip animation (Issue #1)
// ============================================
function renderFlashcards() {
    try {
        const cards = AppState.flashcards;
        if (!cards?.length) {
            $('flashcardsContent').innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-layer-group"></i></div><p class="empty-title">No flashcards generated</p></div>';
            return;
        }
        AppState.currentFlashcardIndex = 0;
        updateCardDisplay();
        renderCardDots();
        renderAllCardsGrid();
    } catch (error) {
        console.error('Error rendering flashcards:', error);
        $('flashcardsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to render flashcards.</div>`;
    }
}

function updateCardDisplay() {
    const cards = AppState.flashcards;
    const idx = AppState.currentFlashcardIndex;
    const card = cards[idx];

    // FIXED: Defensive checks for DOM elements (Issue #1)
    const cardQuestion = $('cardQuestion');
    const cardAnswer = $('cardAnswer');
    const cardCounter = $('cardCounter');
    const flashcardInner = $('flashcardInner');

    if (cardQuestion) cardQuestion.textContent = card.question || card.front || 'No question';
    if (cardAnswer) cardAnswer.textContent = card.answer || card.back || 'No answer';
    if (cardCounter) cardCounter.textContent = `Card ${idx + 1} of ${cards.length}`;

    // FIXED: Reset flip state when changing cards
    if (flashcardInner) {
        flashcardInner.classList.remove('flipped');
        // FIXED: Also reset inline styles that might interfere with CSS animations
        flashcardInner.style.transform = '';
    }
}

function initFlashcardNav() {
    const cardEl = $('currentCard');
    if (cardEl) {
        // FIXED: More robust click handling with explicit front/back toggle fallback (Issue #1)
        cardEl.addEventListener('click', (e) => {
            // Don't flip if clicking navigation buttons
            if (e.target.closest('.card-nav-btn') || e.target.closest('.card-dots')) return;

            const flashcardInner = $('flashcardInner');
            if (!flashcardInner) {
                console.error('flashcardInner element not found');
                return;
            }

            // Toggle the flipped class (CSS animation approach)
            const isFlipped = flashcardInner.classList.toggle('flipped');

            // FIXED: Fallback for browsers/environments where CSS 3D transform might not work
            // We set a data attribute that CSS can use as alternative selector
            flashcardInner.setAttribute('data-flipped', isFlipped ? 'true' : 'false');

            // FIXED: Direct inline style fallback if CSS class doesn't have visual effect
            // This ensures the flip works even if CSS is missing or overridden
            const cardFront = flashcardInner.querySelector('.flashcard-front');
            const cardBack = flashcardInner.querySelector('.flashcard-back');

            if (cardFront && cardBack) {
                if (isFlipped) {
                    cardFront.style.opacity = '0';
                    cardFront.style.visibility = 'hidden';
                    cardBack.style.opacity = '1';
                    cardBack.style.visibility = 'visible';
                    // Use transform as additional visual cue
                    flashcardInner.style.transform = 'rotateY(180deg)';
                } else {
                    cardFront.style.opacity = '1';
                    cardFront.style.visibility = 'visible';
                    cardBack.style.opacity = '0';
                    cardBack.style.visibility = 'hidden';
                    flashcardInner.style.transform = 'rotateY(0deg)';
                }
            }
        });

        // Touch events for mobile swiping (Issue #16)
        let touchStartX = 0;
        let touchEndX = 0;
        cardEl.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        cardEl.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const swipeThreshold = 50;
            if (touchEndX < touchStartX - swipeThreshold) {
                // Swiped left -> Next Card
                if (AppState.currentFlashcardIndex < AppState.flashcards.length - 1) {
                    AppState.currentFlashcardIndex++;
                    updateCardDisplay();
                    renderCardDots();
                }
            } else if (touchEndX > touchStartX + swipeThreshold) {
                // Swiped right -> Previous Card
                if (AppState.currentFlashcardIndex > 0) {
                    AppState.currentFlashcardIndex--;
                    updateCardDisplay();
                    renderCardDots();
                }
            }
        }, { passive: true });
    }

    $('prevCard')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (AppState.currentFlashcardIndex > 0) {
            AppState.currentFlashcardIndex--;
            updateCardDisplay();
            renderCardDots();
        }
    });
    $('nextCard')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (AppState.currentFlashcardIndex < AppState.flashcards.length - 1) {
            AppState.currentFlashcardIndex++;
            updateCardDisplay();
            renderCardDots();
        }
    });
    $('toggleAllCards')?.addEventListener('click', () => {
        const grid = $('allCardsGrid');
        const isVisible = grid.style.display !== 'none';
        grid.style.display = isVisible ? 'none' : 'grid';
        $('toggleAllCards').innerHTML = isVisible 
            ? '<i class="fas fa-border-all"></i> View All'
            : '<i class="fas fa-list"></i> Hide All';
    });

    // Shuffle lock to prevent rapid clicks (Issue #14)
    let isShuffling = false;
    $('shuffleCards')?.addEventListener('click', () => {
        if (isShuffling) return;
        isShuffling = true;
        AppState.flashcards = shuffleArray([...AppState.flashcards]);
        AppState.currentFlashcardIndex = 0;
        updateCardDisplay();
        renderCardDots();
        renderAllCardsGrid();
        showToast('Flashcards shuffled!', 'success');
        setTimeout(() => isShuffling = false, 1000);
    });

    // Event delegation for card dots and all cards grid (Issue #12)
    $('cardDots')?.addEventListener('click', (e) => {
        const dot = e.target.closest('.card-dot');
        if (dot) {
            const idx = parseInt(dot.dataset.index);
            if (!isNaN(idx)) goToCard(idx);
        }
    });
    $('allCardsGrid')?.addEventListener('click', (e) => {
        const mini = e.target.closest('.flashcard-mini');
        if (mini) {
            const idx = parseInt(mini.dataset.index);
            if (!isNaN(idx)) goToCard(idx);
        }
    });
    // Keyboard support for delegated flashcards
    $('allCardsGrid')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const mini = e.target.closest('.flashcard-mini');
            if (mini) {
                e.preventDefault();
                mini.click();
            }
        }
    });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function renderCardDots() {
    const dots = $('cardDots');
    if (!dots) return;
    dots.innerHTML = AppState.flashcards.map((_, i) => `
        <span class="card-dot ${i === AppState.currentFlashcardIndex ? 'active' : ''}" 
              data-index="${i}" role="button" tabindex="0" aria-label="Go to card ${i + 1}"></span>
    `).join('');
}

function goToCard(index) {
    AppState.currentFlashcardIndex = index;
    updateCardDisplay();
    renderCardDots();
}

function renderAllCardsGrid() {
    const grid = $('allCardsGrid');
    if (!grid) return;
    grid.innerHTML = AppState.flashcards.map((card, i) => `
        <div class="flashcard-mini" data-index="${i}" role="button" tabindex="0" aria-label="View flashcard ${i + 1}">
            <div class="flashcard-mini-front">
                <span class="card-num">#${i + 1}</span>
                <p>${escapeHtml(card.question || card.front || '').substring(0, 100)}...</p>
            </div>
        </div>
    `).join('');
}
// ============================================
// Quiz
// ============================================
function initQuizTabs() {
    const tabs = $$('.quiz-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            renderQuiz(tab.dataset.quiz);
        });
    });
    makeTabsAccessible('.quiz-tab');

    // Event delegation for quiz options and answer reveal buttons (Issue #12)
    $('quizContent')?.addEventListener('click', (e) => {
        const option = e.target.closest('.quiz-option');
        if (option) {
            const isCorrect = option.dataset.correct === 'true';
            selectOption(option, isCorrect);
            return;
        }
        const showBtn = e.target.closest('.show-answer-btn');
        if (showBtn) {
            showBtn.style.display = 'none';
            const answerBox = showBtn.nextElementSibling;
            if (answerBox) answerBox.style.display = 'block';
        }
    });

    // Keyboard accessibility for quiz options and buttons (Issue #17)
    $('quizContent')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target.closest('.quiz-option, .show-answer-btn');
            if (target) {
                e.preventDefault();
                target.click();
            }
        }
    });
}

function renderQuiz(type) {
    try {
        const container = $('quizContent');
        const quiz = AppState.quiz;
        if (!quiz?.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-circle-question"></i></div><p class="empty-title">No quiz generated</p></div>';
            return;
        }
        const questions = quiz.filter(q => q.type === type);
        if (!questions.length) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fas fa-circle-question"></i></div><p class="empty-title">No ${type.replace('_', ' ')} questions</p></div>`;
            return;
        }
        container.innerHTML = questions.map((q, i) => {
            if (type === 'mcq') return renderMCQ(q, i);
            else if (type === 'true_false') return renderTrueFalse(q, i);
            else if (type === 'fill_blank') return renderFillBlank(q, i);
            else return renderShortAnswer(q, i);
        }).join('');
    } catch (error) {
        console.error('Error rendering quiz:', error);
        $('quizContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to render quiz. Technical details: ${escapeHtml(error.message)}</div>`;
    }
}

function renderMCQ(q, i) {
    if (!q.options || !Array.isArray(q.options)) {
        return `<div class="quiz-item error-item">Question ${i + 1} has invalid options format.</div>`;
    }
    const options = q.options.map((opt, j) => `
        <div class="quiz-option" data-correct="${j === q.correct_index}" role="button" tabindex="0" aria-label="Option ${String.fromCharCode(65 + j)}: ${escapeHtml(opt)}">
            <span class="opt-letter" aria-hidden="true">${String.fromCharCode(65 + j)}</span>
            <span>${escapeHtml(opt)}</span>
        </div>
    `).join('');
    return `
        <div class="quiz-item" role="group" aria-label="Multiple choice question ${i + 1}">
            <div class="quiz-q-num" aria-hidden="true">Q${i + 1}</div>
            <div class="quiz-q-text">${escapeHtml(q.question)}</div>
            <div class="quiz-options">${options}</div>
        </div>
    `;
}

function renderTrueFalse(q, i) {
    const isTrueCorrect = q.correct_answer === true || q.answer === true || q.correct_answer === 'true' || q.answer === 'true';
    const isFalseCorrect = q.correct_answer === false || q.answer === false || q.correct_answer === 'false' || q.answer === 'false';
    return `
        <div class="quiz-item" role="group" aria-label="True or False question ${i + 1}">
            <div class="quiz-q-num" aria-hidden="true">Q${i + 1}</div>
            <div class="quiz-q-text">${escapeHtml(q.question)}</div>
            <div class="quiz-options">
                <div class="quiz-option" data-correct="${isTrueCorrect}" role="button" tabindex="0" aria-label="True">
                    <span class="opt-letter" aria-hidden="true">T</span><span>True</span>
                </div>
                <div class="quiz-option" data-correct="${isFalseCorrect}" role="button" tabindex="0" aria-label="False">
                    <span class="opt-letter" aria-hidden="true">F</span><span>False</span>
                </div>
            </div>
        </div>
    `;
}

function renderFillBlank(q, i) {
    return `
        <div class="quiz-item" role="group" aria-label="Fill in the blank question ${i + 1}">
            <div class="quiz-q-num" aria-hidden="true">Q${i + 1}</div>
            <div class="quiz-q-text">${escapeHtml(q.question)}</div>
            <div class="quiz-answer-reveal">
                <button class="show-answer-btn" role="button" tabindex="0" aria-label="Show answer for question ${i + 1}">
                    <i class="fas fa-eye" aria-hidden="true"></i> Show Answer
                </button>
                <div style="display:none;" class="answer-box" aria-live="polite">
                    <strong>Answer:</strong> ${escapeHtml(q.answer || q.response || q.solution || q.explanation || q.correct_answer || 'No answer provided')}
                </div>
            </div>
        </div>
    `;
}

function renderShortAnswer(q, i) {
    return `
        <div class="quiz-item" role="group" aria-label="Short answer question ${i + 1}">
            <div class="quiz-q-num" aria-hidden="true">Q${i + 1}</div>
            <div class="quiz-q-text">${escapeHtml(q.question)}</div>
            <div class="quiz-answer-reveal">
                <button class="show-answer-btn" role="button" tabindex="0" aria-label="Show answer for question ${i + 1}">
                    <i class="fas fa-eye" aria-hidden="true"></i> Show Answer
                </button>
                <div style="display:none;" class="answer-box" aria-live="polite">
                    <strong>Answer:</strong> ${escapeHtml(q.answer || q.response || q.solution || q.explanation || q.correct_answer || 'No answer provided')}
                </div>
            </div>
        </div>
    `;
}

function selectOption(el, isCorrect) {
    const parent = el.parentElement;
    if (parent.querySelector('.correct, .incorrect')) return;
    el.classList.add(isCorrect ? 'correct' : 'incorrect');
    if (!isCorrect) {
        Array.from(parent.children).forEach(child => {
            if (child.dataset.correct === 'true') child.classList.add('correct');
        });
    }
}

// ============================================
// Important Questions — FIXED answer reveal (Issue #2)
// ============================================
function initDiffTabs() {
    const tabs = $$('.diff-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            renderQuestions(tab.dataset.diff);
        });
    });
    makeTabsAccessible('.diff-tab');

    // FIXED: More robust event delegation for important questions reveal buttons (Issue #2)
    // The event listener is on the container, so it catches clicks on dynamically added content
    const questionsContent = $('questionsContent');
    if (questionsContent) {
        questionsContent.addEventListener('click', (e) => {
            // Try to find the show answer button using closest (handles clicks on child elements like icons)
            const showBtn = e.target.closest('.show-answer-btn');
            if (showBtn) {
                e.preventDefault();
                e.stopPropagation();

                // Hide the button
                showBtn.style.display = 'none';

                // Find the answer box - it should be the next sibling
                let answerBox = showBtn.nextElementSibling;

                // FIXED: Fallback if nextElementSibling doesn't work (e.g., whitespace text nodes)
                if (!answerBox || !answerBox.classList.contains('answer-box')) {
                    // Try finding within the same parent container
                    const revealContainer = showBtn.closest('.answer-reveal');
                    if (revealContainer) {
                        answerBox = revealContainer.querySelector('.answer-box');
                    }
                }

                // Show the answer
                if (answerBox) {
                    answerBox.style.display = 'block';
                    answerBox.classList.add('answer-visible');
                } else {
                    console.error('Answer box not found for button:', showBtn);
                }
                return;
            }
        });

        // Keyboard accessibility for questions reveal buttons (Issue #17)
        questionsContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                const target = e.target.closest('.show-answer-btn');
                if (target) {
                    e.preventDefault();
                    target.click();
                }
            }
        });
    }
}

function renderQuestions(difficulty) {
    try {
        const container = $('questionsContent');
        const questions = AppState.questions;
        if (!questions?.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-bullseye"></i></div><p class="empty-title">No questions generated</p></div>';
            return;
        }
        const filtered = questions.filter(q => q.difficulty === difficulty);
        if (!filtered.length) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fas fa-bullseye"></i></div><p class="empty-title">No ${difficulty} questions</p></div>`;
            return;
        }

        // FIXED: Ensure each question has a unique and properly structured answer reveal section (Issue #2)
        container.innerHTML = filtered.map((q, i) => `
            <div class="question-item" role="group" aria-label="${difficulty} question ${i + 1}">
                <div class="question-header-row">
                    <span class="q-num" aria-hidden="true">Q${i + 1}</span>
                    <span class="diff-badge ${q.difficulty}">${q.difficulty}</span>
                </div>
                <div class="question-text">${escapeHtml(q.question)}</div>
                <div class="answer-reveal">
                    <button class="show-answer-btn" type="button" role="button" tabindex="0" aria-label="Show answer for question ${i + 1}">
                        <i class="fas fa-eye" aria-hidden="true"></i> Show Answer
                    </button>
                    <div class="answer-box" style="display:none;" aria-live="polite">
                        <div class="answer-label">Answer:</div>
                        <div class="answer-text">${escapeHtml(getQuestionAnswer(q))}</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error rendering questions:', error);
        $('questionsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to render questions. Technical details: ${escapeHtml(error.message)}</div>`;
    }
}

// Helper: extract answer from a question object regardless of field name
function getQuestionAnswer(q) {
    // Try all common field names the backend might use
    const candidates = [
        q.answer, q.answer_text, q.model_answer, q.sample_answer,
        q.expected_answer, q.correct_answer, q.response, q.solution,
        q.explanation, q.ans, q.suggested_answer, q.ideal_answer,
        q.reference_answer, q.key_points
    ];
    for (const c of candidates) {
        if (c && typeof c === 'string' && c.trim()) return c.trim();
    }
    // If answer is an array of points, join them
    if (Array.isArray(q.answer) && q.answer.length) return q.answer.join('\n• ');
    if (Array.isArray(q.key_points) && q.key_points.length) return q.key_points.join('\n• ');
    // Last resort: dump all non-standard string values
    for (const [k, v] of Object.entries(q)) {
        if (!['question', 'difficulty', 'type', 'q_num'].includes(k) && typeof v === 'string' && v.trim()) {
            return v.trim();
        }
    }
    return 'No answer provided';
}

// ============================================
// Key Concepts
// ============================================
function initKeyConceptsDelegation() {
    $('conceptsContent')?.addEventListener('click', (e) => {
        const item = e.target.closest('.concept-item');
        if (item) {
            const isExpanded = item.classList.toggle('expanded');
            item.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }
    });
    $('conceptsContent')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const item = e.target.closest('.concept-item');
            if (item) {
                e.preventDefault();
                item.click();
            }
        }
    });
}

function renderKeyConcepts(concepts) {
    try {
        const container = $('conceptsContent');
        if (!concepts?.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-brain"></i></div><p class="empty-title">No key concepts generated</p></div>';
            return;
        }
        container.innerHTML = concepts.map((c, i) => `
            <div class="concept-item" role="button" tabindex="0" aria-expanded="false" style="animation-delay: ${i * 0.05}s">
                <div class="concept-term">
                    <i class="fas fa-lightbulb" aria-hidden="true"></i>
                    ${escapeHtml(c.term)}
                    <i class="fas fa-chevron-down expand-icon" aria-hidden="true"></i>
                </div>
                <div class="concept-def" aria-live="polite">${escapeHtml(c.definition)}</div>
                ${c.category ? `<span class="concept-category">${escapeHtml(c.category)}</span>` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Error rendering key concepts:', error);
        $('conceptsContent').innerHTML = `<div class="render-error-state"><i class="fas fa-exclamation-triangle"></i> Failed to render key concepts.</div>`;
    }
}
// ============================================
// Export
// ============================================
function initExport() {
    // NOTE: exportBtn toggle is handled by the inline script in index.html
    // (which also repositions the menu correctly). Do NOT add a second toggle here.

    // Export lock to prevent rapid clicks (Issue #14)
    let isExporting = false;
    $$('.export-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isExporting) return;
            isExporting = true;
            const format = btn.dataset.format;
            exportFile(format).finally(() => {
                setTimeout(() => isExporting = false, 1000);
            });
            $('exportMenu').classList.remove('show');
        });
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.export-dropdown')) $('exportMenu')?.classList.remove('show');
    });

    let isPrinting = false;
    $('printBtn')?.addEventListener('click', () => {
        if (isPrinting) return;
        isPrinting = true;
        window.print();
        setTimeout(() => isPrinting = false, 1000);
    });
    $('copyAllBtn')?.addEventListener('click', copyAllContent);

    let isNewGenClicking = false;
    $('newGenerationBtn')?.addEventListener('click', () => {
        if (isNewGenClicking) return;
        isNewGenClicking = true;
        $('resultsSection').style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => isNewGenClicking = false, 1000);
    });
    $('downloadNotesBtn')?.addEventListener('click', () => {
        const content = $('notesContent').innerText;
        downloadText(content, 'study-notes.txt');
    });
    $('printNotesBtn')?.addEventListener('click', () => {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`<html><head><title>Study Notes</title><style>body { font-family: sans-serif; line-height: 1.6; padding: 20px; }</style></head><body>${$('notesContent').innerHTML}</body></html>`);
        printWindow.document.close();
        printWindow.print();
    });
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function exportFile(format) {
    if (!AppState.currentResults) {
        showToast('No content to export', 'error');
        return;
    }
    // Client-side TXT export — always works without a backend
    if (format === 'txt') {
        const lines = [];
        const r = AppState.currentResults;
        if (r.summary) lines.push('=== SUMMARY ===\n' + (typeof r.summary === 'string' ? r.summary : JSON.stringify(r.summary, null, 2)));
        if (r.study_notes) lines.push('\n=== STUDY NOTES ===\n' + (r.study_notes.content || r.study_notes));
        if (r.cheat_sheet) lines.push('\n=== CHEAT SHEET ===\n' + (r.cheat_sheet.content || r.cheat_sheet));
        if (r.flashcards) {
            const cards = Array.isArray(r.flashcards) ? r.flashcards : (r.flashcards.flashcards || []);
            lines.push('\n=== FLASHCARDS ===');
            cards.forEach((c, i) => lines.push('Q' + (i+1) + ': ' + (c.question || c.front) + '\nA: ' + (c.answer || c.back)));
        }
        downloadText(lines.join('\n'), 'study-notes.txt');
        showToast('Exported as TXT!', 'success');
        return;
    }
    try {
        showToast('Exporting as ' + format.toUpperCase() + '...', 'info');
        const response = await secureFetch('/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: AppState.currentResults, format: format })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);
        const link = document.createElement('a');
        link.href = data.download_url;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Exported as ' + format.toUpperCase() + '!', 'success');
    } catch (error) {
        showToast(format.toUpperCase() + ' export failed — try "Export as TXT" instead', 'error');
        console.error('Export error:', error);
    }
}

function copyAllContent() {
    const activePanel = document.querySelector('.result-panel.active .panel-body');
    if (!activePanel) return;
    navigator.clipboard.writeText(activePanel.innerText).then(() => {
        showToast('Copied to clipboard!', 'success');
    });
}

function initCopyButtons() {
    $$('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const el = $(targetId);
            if (!el) return;
            navigator.clipboard.writeText(el.innerText).then(() => {
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                setTimeout(() => btn.innerHTML = original, 2000);
            });
        });
    });
}

// ============================================
// History — FIXED save and load functionality (Issue #3)
// ============================================
function initHistory() {
    $('historyBtn')?.addEventListener('click', loadHistory);
    $('closeHistory')?.addEventListener('click', () => {
        $('historyModal').classList.remove('active');
    });
    $('clearHistoryBtn')?.addEventListener('click', clearHistory);
    $('historyModal')?.addEventListener('click', (e) => {
        if (e.target === $('historyModal')) $('historyModal').classList.remove('active');
    });

    // Event delegation for history items (Issue #12)
    $('historyList')?.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (item) {
            loadHistoryItem(item.dataset.id);
        }
    });

    // Keyboard support for delegated history items
    $('historyList')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const item = e.target.closest('.history-item');
            if (item) {
                e.preventDefault();
                item.click();
            }
        }
    });
}

async function loadHistory() {
    try {
        const response = await secureFetch('/history');
        const data = await response.json();
        const list = $('historyList');
        if (!data.history?.length) {
            list.innerHTML = `<div class="empty-history"><i class="fas fa-clock-rotate-left"></i><p>No history yet. Generate your first study notes!</p></div>`;
        } else {
            list.innerHTML = data.history.map(h => `
                <div class="history-item" data-id="${h.id}" role="button" tabindex="0" aria-label="Load generation from ${h.timestamp}">
                    <div class="history-meta">
                        <span class="history-time">${h.timestamp}</span>
                        <span class="history-words">${h.word_count} words</span>
                    </div>
                    <div class="history-preview">${escapeHtml(h.preview)}</div>
                    <div class="history-sections">
                        ${h.sections.map(s => `<span class="history-tag">${s}</span>`).join('')}
                    </div>
                </div>
            `).join('');
        }
        $('historyModal').classList.add('active');
    } catch (error) {
        showToast('Failed to load history: ' + error.message, 'error');
    }
}

async function loadHistoryItem(id) {
    try {
        const response = await secureFetch(`/history/${id}`);
        const data = await response.json();
        if (data.success && data.item?.data) {
            AppState.currentResults = data.item.data;
            // FIXED: Also restore the extracted text so chat works with history items
            if (data.item.data._original_text) {
                AppState.extractedText = data.item.data._original_text;
            }
            displayResults(data.item.data);
            $('historyModal').classList.remove('active');
            showToast('History item loaded!', 'success');
        } else if (data.success && data.item) {
            // FIXED: Handle case where data might be nested differently
            AppState.currentResults = data.item.data || data.item;
            displayResults(AppState.currentResults);
            $('historyModal').classList.remove('active');
            showToast('History item loaded!', 'success');
        }
    } catch (error) {
        showToast('Failed to load history item: ' + error.message, 'error');
    }
}

async function clearHistory() {
    try {
        await secureFetch('/clear-history', { method: 'POST' });
        $('historyList').innerHTML = `<div class="empty-history"><i class="fas fa-clock-rotate-left"></i><p>History cleared</p></div>`;
        showToast('History cleared', 'success');
    } catch (error) {
        showToast('Failed to clear history: ' + error.message, 'error');
    }
}

// ============================================
// Chat / Ask AI — FIXED response format handling
// ============================================
function initChat() {
    const chatInput = $('chatInput');
    const sendBtn = $('sendMessageBtn');
    const clearBtn = $('clearChatBtn');
    sendBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    chatInput?.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });
    clearBtn?.addEventListener('click', () => {
        if (AppState.chatHistory.length === 0) return;
        if (confirm('Clear all chat messages?')) {
            resetChat();
            showToast('Chat cleared', 'info');
        }
    });
    // Suggested chips removed per user request - AI now handles all prompts freely
}

async function sendChatMessage() {
    const chatInput = $('chatInput');
    const sendBtn = $('sendMessageBtn');
    const message = chatInput.value.trim();
    if (!message || AppState.isChatLoading) return;
    // Allow general conversation even without uploaded document
    const hasContext = AppState.extractedText && AppState.extractedText.length > 0;

    // Disable input and send button during loading
    chatInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    addChatMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    showTypingIndicator();
    AppState.isChatLoading = true;
    try {
        // Use raw fetch instead of secureFetch so we can read the error body ourselves
        const rawResponse = await fetch('/chat', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                context: hasContext ? AppState.extractedText : '',
                history: AppState.chatHistory,
                has_context: hasContext
            })
        });

        let data;
        try {
            data = await rawResponse.json();
        } catch (parseErr) {
            throw new Error(`Server returned non-JSON response (HTTP ${rawResponse.status})`);
        }

        hideTypingIndicator();

        // If backend returned an error, show the REAL error message
        if (!rawResponse.ok || !data.success) {
            const errMsg = data.error || `Request failed with status ${rawResponse.status}`;
            console.error('Chat backend error:', errMsg);
            addChatMessage('ai', `⚠️ ${errMsg}`, true);
            return;
        }

        // Handle different backend response formats
        const aiResponse = data.response || data.content || data.message || data.text || data.answer || data.reply || JSON.stringify(data);
        addChatMessage('ai', aiResponse);

        AppState.chatHistory.push({ role: 'user', content: message });
        AppState.chatHistory.push({ role: 'ai', content: aiResponse });
        if (AppState.chatHistory.length > 20) AppState.chatHistory = AppState.chatHistory.slice(-20);

    } catch (error) {
        hideTypingIndicator();
        // Show the actual error so we know what went wrong
        const displayMsg = error.message && error.message !== 'Failed to fetch'
            ? `⚠️ ${error.message}`
            : '⚠️ Could not reach the server. Check your connection and try again.';
        addChatMessage('ai', displayMsg, true);
        console.error('Chat error:', error);
    } finally {
        AppState.isChatLoading = false;
        chatInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        chatInput.focus();
    }
}

function addChatMessage(role, content, isError = false) {
    const messagesContainer = $('chatMessages');
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.remove();
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}-message ${isError ? 'error-message' : ''}`;
    const icon = role === 'user' ? 'fa-user' : 'fa-robot';
    const name = role === 'user' ? 'You' : 'AI Assistant';

    // Wrap marked.parse in safeMarkedParse (Issue #8)
    const parsedContent = role === 'ai' ? safeMarkedParse(content) : escapeHtml(content);

    messageDiv.innerHTML = `
        <div class="message-avatar"><i class="fas ${icon}"></i></div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-name">${name}</span>
                <span class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="message-body">${parsedContent}</div>
            ${role === 'ai' ? `
                <div class="message-actions">
                    <button class="msg-action-btn" onclick="copyMessage(this)" title="Copy" role="button" aria-label="Copy message"><i class="fas fa-copy"></i></button>
                    <button class="msg-action-btn" onclick="regenerateMessage(this)" title="Regenerate" role="button" aria-label="Regenerate message"><i class="fas fa-rotate-right"></i></button>
                </div>
            ` : ''}
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    requestAnimationFrame(() => messageDiv.classList.add('show'));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
    const messagesContainer = $('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message ai-message typing-indicator-container';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
        <div class="message-avatar"><i class="fas fa-robot"></i></div>
        <div class="message-content">
            <div class="message-header"><span class="message-name">AI Assistant</span></div>
            <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = $('typingIndicator');
    if (indicator) indicator.remove();
}

// Reset chat when new results are generated
function resetChat() {
    AppState.chatHistory = [];
    const messagesContainer = $('chatMessages');
    messagesContainer.innerHTML = `
        <div class="chat-welcome">
            <div class="welcome-icon"><i class="fas fa-robot"></i></div>
            <h4>AI Study Assistant</h4>
            <p>Ask me anything! I can answer general questions, help with your uploaded study material, explain concepts, generate questions, and more.</p>
        </div>
    `;
}

function copyMessage(btn) {
    const messageBody = btn.closest('.message-content').querySelector('.message-body');
    navigator.clipboard.writeText(messageBody.innerText).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => btn.innerHTML = original, 2000);
    });
}

function regenerateMessage(btn) {
    const messagesContainer = $('chatMessages');
    const allMessages = messagesContainer.querySelectorAll('.chat-message');
    let lastUserMessage = null;
    for (let i = allMessages.length - 1; i >= 0; i--) {
        if (allMessages[i].classList.contains('user-message')) {
            lastUserMessage = allMessages[i].querySelector('.message-body').innerText;
            break;
        }
    }
    if (lastUserMessage) {
        const currentMessage = btn.closest('.chat-message');
        currentMessage.remove();
        AppState.chatHistory.pop();
        AppState.chatHistory.pop();
        $('chatInput').value = lastUserMessage;
        sendChatMessage();
    }
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Utilities
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Keyboard Shortcuts
// ============================================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const btn = $('generateBtn');
            if (!btn.disabled) handleGenerate();
        }
        if (e.key === 'Escape') $('historyModal')?.classList.remove('active');
    });
}

// Expose functions for HTML onclick handlers
window.selectOption = selectOption;
window.goToCard = goToCard;
window.copyMessage = copyMessage;
window.regenerateMessage = regenerateMessage;
