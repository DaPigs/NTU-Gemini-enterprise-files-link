// ==UserScript==
// @name         NTU Gemini Enterprise - OneDrive Auto-Approver (iOS Toggle)
// @namespace    https://github.com/ntu-gemini-vibe-bridge
// @version      1.26
// @description  Keep the authorized OneDrive connector on, auto-approve Gemini confirmation cards, show elapsed time and completion alerts, and copy the project setup prompt in NTU Gemini Enterprise.
// @author       ntu-gemini-vibe-bridge
// @match        https://vertexaisearch.cloud.google.com/*
// @noframes
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const DONE_DEBOUNCE_MS = 2000;
    const TITLE_FLASH_INTERVAL_MS = 1000;
    const POS_STORAGE_KEY = 'ge_ios_widget_pos_v3';

    let isRunning = false;
    let widget = null;
    let labelEl = null;
    let switchTrack = null;
    let switchKnob = null;
    let elapsedEl = null;
    let approvalCountEl = null;
    let metrics = null;
    let telemetryTimer = null;
    let pendingSubmissionUntil = 0;

    let turn = null;

    // Tab title & favicon flashing state
    let flashTimer = null;
    let flashToggleState = false;
    let originalTitle = '';
    let faviconSnapshot = [];
    let temporaryFavicon = null;
    let checkFaviconDataUrl = null;
    let audioContext = null;
    let desktopNotification = null;

    // -------------------------------------------------------------------------
    // 1. Draggable iOS widget
    // -------------------------------------------------------------------------
    function loadSavedPosition() {
        try {
            const raw = localStorage.getItem(POS_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (
                typeof parsed.left === 'number' &&
                typeof parsed.top === 'number' &&
                Number.isFinite(parsed.left) &&
                Number.isFinite(parsed.top)
            ) {
                return parsed;
            }
        } catch (e) {}
        return null;
    }

    function saveWidgetPosition(left, top) {
        try {
            localStorage.setItem(
                POS_STORAGE_KEY,
                JSON.stringify({ left: Math.round(left), top: Math.round(top) })
            );
        } catch (e) {}
    }

    function placeWidget(left, top) {
        const { width, height } = widget.getBoundingClientRect();
        const clamp = (value, size, viewport) => {
            const margin = Math.min(8, Math.max(0, (viewport - size) / 2));
            return Math.max(margin, Math.min(value, viewport - size - margin));
        };
        Object.assign(widget.style, {
            left: `${clamp(left, width, window.innerWidth)}px`,
            top: `${clamp(top, height, window.innerHeight)}px`,
            right: 'auto',
            bottom: 'auto'
        });
    }

    function keepWidgetOnScreen() {
        if (!widget?.isConnected) return;
        const { left, top, right, bottom } = widget.getBoundingClientRect();
        if (widget.style.left !== 'auto' || left < 0 || top < 0 ||
            right > window.innerWidth || bottom > window.innerHeight) {
            placeWidget(left, top);
        }
    }
    window.addEventListener('resize', keepWidgetOnScreen);

    function resetWidgetPosition() {
        try {
            localStorage.removeItem(POS_STORAGE_KEY);
        } catch (e) {}
        if (widget) {
            widget.style.left = 'auto';
            widget.style.top = 'auto';
            widget.style.bottom = '24px';
            widget.style.right = '24px';
            keepWidgetOnScreen();
        }
    }

    function setWidgetStatus(mode) {
        if (mode === 'working') {
            if (metrics?.endedAt !== null) startTelemetry();
        } else {
            finishTelemetry();
        }
        if (!labelEl) return;
        if (mode === 'working') {
            labelEl.textContent = '⚡ working...';
            labelEl.style.color = '#64D2FF';
        } else if (mode === 'done') {
            labelEl.textContent = '✅ DONE!';
            labelEl.style.color = '#34C759';
        } else {
            labelEl.textContent = 'auto-approve\nSend';
            labelEl.style.color = '#F2F2F7';
        }
        keepWidgetOnScreen();
    }

    function updateTelemetry() {
        if (!elapsedEl || !approvalCountEl) return;
        const elapsed = metrics ? Math.max(0, Math.floor(((metrics.endedAt ?? Date.now()) - metrics.startedAt) / 1000)) : 0;
        const minutes = Math.floor(elapsed / 60);
        const seconds = String(elapsed % 60).padStart(2, '0');
        const elapsedText = minutes + 'm' + seconds + 's';
        const approvals = metrics?.approved ?? 0;
        elapsedEl.textContent = '⌛: ' + elapsedText;
        elapsedEl.setAttribute('aria-label', 'Elapsed time: ' + elapsedText);
        approvalCountEl.textContent = '✅: ' + approvals;
        approvalCountEl.setAttribute('aria-label', 'Auto-approved confirmations: ' + approvals);
    }

    function finishTelemetry() {
        if (metrics?.endedAt !== null) return;
        metrics.endedAt = Date.now();
        clearInterval(telemetryTimer);
        telemetryTimer = null;
        updateTelemetry();
    }

    function startTelemetry() {
        finishTelemetry();
        metrics = { startedAt: Date.now(), endedAt: null, approved: 0 };
        if (approvalCountEl) approvalCountEl.title = 'Automatic confirmation clicks in the current turn';
        telemetryTimer = setInterval(updateTelemetry, 1000);
        updateTelemetry();
    }

    function updateWidgetUI() {
        if (!widget || !switchTrack || !switchKnob) return;
        if (isRunning) {
            switchTrack.style.backgroundColor = '#34C759';
            switchKnob.style.transform = 'translateX(20px)';
            widget.style.borderColor = 'rgba(52, 199, 89, 0.55)';
        } else {
            switchTrack.style.backgroundColor = 'rgba(120, 120, 128, 0.45)';
            switchKnob.style.transform = 'translateX(0px)';
            widget.style.borderColor = 'rgba(255, 255, 255, 0.22)';
        }
    }

    function createPromptCopyButton() {
        const button = document.createElement('button');
        button.id = 'ge-copy-prompt';
        button.type = 'button';
        button.textContent = 'Copy prompt';
        button.title = 'Copy the project setup prompt to the clipboard';
        button.setAttribute('aria-live', 'polite');
        const defaultBackground = 'rgba(255, 255, 255, 0.10)';
        const defaultColor = '#F2F2F7';
        Object.assign(button.style, {
            padding: '8px 10px',
            minWidth: '86px',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            borderRadius: '10px',
            backgroundColor: defaultBackground,
            color: defaultColor,
            fontFamily: 'inherit',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer'
        });
        let resetFeedback;
        button.addEventListener('click', async () => {
            let copied = false;
            try {
                await navigator.clipboard.writeText(PROJECT_PROMPT);
                copied = true;
            } catch {}

            clearTimeout(resetFeedback);
            button.textContent = copied ? 'Copied!' : 'Copy failed';
            button.style.backgroundColor = copied ? '#34C759' : defaultBackground;
            button.style.color = copied ? '#102414' : defaultColor;
            resetFeedback = setTimeout(() => {
                button.textContent = 'Copy prompt';
                button.style.backgroundColor = defaultBackground;
                button.style.color = defaultColor;
            }, 2000);
        });
        return button;
    }

    function createOrEnsureWidget() {
        if (widget?.isConnected) return;
        const host = document.body;
        if (!host) return;
        if (widget) {
            host.appendChild(widget);
            keepWidgetOnScreen();
            return;
        }

        widget = document.createElement('div');
        widget.id = 'ge-ios-widget';
        widget.title = 'Keep OneDrive on and click Send on Gemini confirmation cards • Click or press ` to toggle • Drag to move • Double-click to reset position';
        Object.assign(widget.style, {
            position: 'fixed',
            boxSizing: 'border-box',
            maxWidth: '100vw',
            maxHeight: '100vh',
            overflow: 'hidden',
            left: 'auto',
            top: 'auto',
            bottom: '24px',
            right: '24px',
            zIndex: '2147483647',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 14px 11px 14px',
            borderRadius: '18px',
            backgroundColor: 'rgba(28, 28, 30, 0.90)',
            backdropFilter: 'blur(16px) saturate(180%)',
            webkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3)',
            userSelect: 'none',
            webkitUserSelect: 'none',
            touchAction: 'none',
            cursor: 'grab',
            transition: 'border-color 0.25s ease, box-shadow 0.2s ease',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
            pointerEvents: 'auto'
        });

        labelEl = document.createElement('div');
        Object.assign(labelEl.style, {
            fontSize: '11px',
            lineHeight: '1.25',
            fontWeight: '600',
            letterSpacing: '0.2px',
            color: '#F2F2F7',
            textAlign: 'center',
            whiteSpace: 'pre-line',
            pointerEvents: 'none'
        });

        switchTrack = document.createElement('div');
        Object.assign(switchTrack.style, {
            position: 'relative',
            width: '51px',
            height: '31px',
            borderRadius: '999px',
            backgroundColor: 'rgba(120, 120, 128, 0.45)',
            transition: 'background-color 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            boxSizing: 'border-box',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            pointerEvents: 'none'
        });

        switchKnob = document.createElement('div');
        Object.assign(switchKnob.style, {
            position: 'absolute',
            top: '2px',
            left: '2px',
            width: '27px',
            height: '27px',
            borderRadius: '50%',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 3px 8px rgba(0, 0, 0, 0.22), 0 3px 1px rgba(0, 0, 0, 0.1)',
            transition: 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
            pointerEvents: 'none'
        });

        const toggleArea = document.createElement('div');
        Object.assign(toggleArea.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px'
        });
        switchTrack.appendChild(switchKnob);
        toggleArea.append(labelEl, switchTrack);
        const telemetry = document.createElement('div');
        Object.assign(telemetry.style, {
            color: '#F2F2F7', fontSize: '11px', lineHeight: '1.25',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
        });
        elapsedEl = document.createElement('div');
        elapsedEl.setAttribute('role', 'group');
        elapsedEl.title = 'Elapsed time for this turn';
        approvalCountEl = document.createElement('div');
        approvalCountEl.setAttribute('role', 'group');
        approvalCountEl.title = 'Automatic confirmation clicks in the current turn';
        telemetry.append(elapsedEl, approvalCountEl);
        setWidgetStatus(turn ? 'working' : alertActive ? 'done' : 'idle');
        updateTelemetry();
        const promptCopyButton = createPromptCopyButton();
        const detailsColumn = document.createElement('div');
        Object.assign(detailsColumn.style, {
            display: 'flex', flexDirection: 'column', gap: '5px'
        });
        detailsColumn.append(telemetry, promptCopyButton);
        widget.append(toggleArea, detailsColumn);

        // --- Drag vs. Click Logic ---
        let pointerId = null;
        let hasMoved = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        widget.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || pointerId !== null || promptCopyButton.contains(e.target)) return;
            e.stopPropagation();

            pointerId = e.pointerId;
            hasMoved = false;
            startX = e.clientX;
            startY = e.clientY;

            const rect = widget.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            widget.style.cursor = 'grabbing';
            try {
                widget.setPointerCapture(e.pointerId);
            } catch (_) {}
        });

        widget.addEventListener('pointermove', (e) => {
            if (pointerId !== e.pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!hasMoved && Math.hypot(dx, dy) > 5) {
                hasMoved = true;
            }

            if (hasMoved) {
                placeWidget(initialLeft + dx, initialTop + dy);
            }
        });

        widget.addEventListener('pointerup', (e) => {
            if (pointerId !== e.pointerId) return;
            pointerId = null;
            widget.style.cursor = 'grab';
            try {
                widget.releasePointerCapture(e.pointerId);
            } catch (_) {}

            if (hasMoved) {
                const rect = widget.getBoundingClientRect();
                saveWidgetPosition(rect.left, rect.top);
            } else {
                toggleAutoApprove();
            }
        });

        function cancelDrag(e) {
            if (pointerId !== e.pointerId) return;
            pointerId = null;
            widget.style.cursor = 'grab';
        }
        widget.addEventListener('pointercancel', cancelDrag);
        widget.addEventListener('lostpointercapture', cancelDrag);

        widget.addEventListener('dblclick', (e) => {
            if (promptCopyButton.contains(e.target)) return;
            e.stopPropagation();
            resetWidgetPosition();
        });

        host.appendChild(widget);
        const savedPos = loadSavedPosition();
        if (savedPos) {
            placeWidget(savedPos.left, savedPos.top);
        } else {
            keepWidgetOnScreen();
        }
        updateWidgetUI();
    }

    // -------------------------------------------------------------------------
    // 2. Completion favicon and tab title flash
    // -------------------------------------------------------------------------
    function getCheckFaviconDataUrl() {
        if (checkFaviconDataUrl) return checkFaviconDataUrl;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#34C759';
        ctx.beginPath();
        ctx.arc(32, 32, 30, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(18, 33);
        ctx.lineTo(28, 43);
        ctx.lineTo(47, 22);
        ctx.stroke();

        checkFaviconDataUrl = canvas.toDataURL('image/png');
        return checkFaviconDataUrl;
    }

    function setFaviconToCheck() {
        if (!document.head) return;
        const dataUrl = getCheckFaviconDataUrl();
        faviconSnapshot = Array.from(document.head.querySelectorAll('link[rel~="icon"]'), (link) => ({
            link,
            href: link.getAttribute('href')
        }));
        for (const { link } of faviconSnapshot) link.href = dataUrl;

        if (!faviconSnapshot.length) {
            temporaryFavicon = document.createElement('link');
            temporaryFavicon.rel = 'icon';
            temporaryFavicon.type = 'image/png';
            temporaryFavicon.href = dataUrl;
            document.head.appendChild(temporaryFavicon);
        }
    }

    function restoreOriginalFavicon() {
        for (const { link, href } of faviconSnapshot) {
            if (href === null) link.removeAttribute('href');
            else link.setAttribute('href', href);
        }
        faviconSnapshot = [];
        temporaryFavicon?.remove();
        temporaryFavicon = null;
    }

    function prepareNotifications() {
        if (window.Notification?.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }

    function unlockAudio(event) {
        if (!event.isTrusted) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            audioContext ??= new AudioCtx();
            if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        } catch (_) {}
    }

    function playCompletionChime() {
        const ctx = audioContext;
        if (ctx?.state !== 'running') return;
        const now = ctx.currentTime;
        [1046.5, 1567.98].forEach((frequency, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = now + index * 0.12;
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.1, start);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
            };
            osc.start(start);
            osc.stop(start + 0.45);
        });
    }

    function showInPagePopup(message) {
        const host = document.body || document.documentElement;
        if (!host) return;
        const existing = document.getElementById('ge-done-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'ge-done-popup';
        Object.assign(popup.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 20px',
            borderRadius: '999px',
            backgroundColor: 'rgba(28, 28, 30, 0.95)',
            backdropFilter: 'blur(16px) saturate(180%)',
            webkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(52, 199, 89, 0.75)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
            color: '#FFFFFF',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            pointerEvents: 'none'
        });

        const badge = document.createElement('span');
        badge.textContent = '✅';
        badge.style.fontSize = '15px';

        const text = document.createElement('span');
        text.textContent = message;

        popup.appendChild(badge);
        popup.appendChild(text);
        host.appendChild(popup);

        function expirePopup() {
            setTimeout(() => popup.remove(), 5500);
        }
        if (document.hidden) {
            document.addEventListener('visibilitychange', expirePopup, { once: true });
        } else {
            expirePopup();
        }
    }

    function sendOneTimePopupNotification() {
        showInPagePopup('Gemini has finished its turn.');
        try {
            playCompletionChime();
        } catch (_) {}

        if (window.Notification?.permission !== 'granted') return;
        try {
            desktopNotification?.close();
            const notification = new Notification('✅ Gemini Enterprise Finished', {
                body: 'Gemini has finished its turn. Click to open the chat.'
            });
            desktopNotification = notification;
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (_) {}
    }

    // Schedule each flash in a separate task to avoid Chrome's chained timer threshold.
    const flashChannel = new MessageChannel();
    let alertId = 0;
    let alertActive = false;
    flashChannel.port1.onmessage = ({ data: id }) => {
        if (!alertActive || id !== alertId) return;
        flashTimer = setTimeout(() => {
            flashToggleState = !flashToggleState;
            document.title = flashToggleState ? originalTitle : '✅ [DONE] ' + originalTitle;
            flashChannel.port2.postMessage(id);
        }, TITLE_FLASH_INTERVAL_MS);
    };

    function startCompletionAlert() {
        if (!alertActive) {
            alertActive = true;
            originalTitle = document.title;
            flashToggleState = false;
            document.title = '✅ [DONE] ' + originalTitle;
            try {
                setFaviconToCheck();
            } catch (_) {}
            flashChannel.port2.postMessage(++alertId);
        }
        setWidgetStatus('done');
        sendOneTimePopupNotification();
    }

    function stopCompletionAlert() {
        if (!alertActive) return;
        alertActive = false;
        clearTimeout(flashTimer);
        document.title = originalTitle;
        restoreOriginalFavicon();
        desktopNotification?.close();
        desktopNotification = null;
        document.getElementById('ge-done-popup')?.remove();
        setWidgetStatus(turn ? 'working' : 'idle');
    }

    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('pointerup', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    window.addEventListener('click', (event) => {
        if (event.isTrusted) stopCompletionAlert();
    }, true);


    // 3. Conversation detection. Stop can stay mounted under a hidden shadow host.
    const STOP = 'button[aria-label="Stop"], [data-aria-label="Stop"]';
    const SUBMIT = '[data-aria-label="Submit"], button[aria-label="Submit"]';
    const COMPOSER = '#agent-search-prosemirror-editor, .ProseMirror[contenteditable="true"]';
    const LIVE_CARD = '.session-request-info-container.live-state';
    const CARD_CONTROLS = 'button, md-filled-button, [role="button"], [data-aria-label="Send"]';
    const STATUS = '[role="status"][aria-live="polite"]';
    const CONNECTOR_MENU = 'md-menu.sources-selector-menu[anchor="sources-selector-menu-anchor"]';
    const ONEDRIVE_SWITCH = 'md-switch.item-toggle[data-aria-label="OneDrive"][data-test-id^="source-toggle-"]';
    const ONEDRIVE_INPUT = 'input#switch[type="checkbox"][role="switch"][aria-label="OneDrive"]';
    const approvedCards = new WeakSet();
    let attemptedConnectorSwitch = null;
    let pendingCards = new Set();
    let completedStatuses = new Set();
    let stopVisible = false;
    let waitingForNewTurn = false;
    let settleTimer = null;
    let sessionPath = location.pathname;

    let debug = false;
    try {
        debug = localStorage.getItem('ge_debug') === '1';
    } catch (_) {}

    function composedParent(element) {
        return element.assignedSlot || element.parentElement || element.getRootNode().host;
    }

    function visibilityBlocker(element) {
        for (let node = element; node; node = composedParent(node)) {
            const style = getComputedStyle(node);
            if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
                style.display === 'none' || style.visibility !== 'visible' ||
                style.opacity === '0' || style.contentVisibility === 'hidden') return node;
        }
        return null;
    }

    function logStopChain(button, blocker) {
        const chain = [];
        for (let node = button; node; node = composedParent(node)) {
            const { display, visibility, opacity, contentVisibility } = getComputedStyle(node);
            chain.push({
                tag: node.localName, hidden: node.hidden === true, ariaHidden: node.getAttribute('aria-hidden'),
                display, visibility, opacity, contentVisibility, blocksVisibility: node === blocker
            });
        }
        console.debug('[OneDrive Auto-Approver] Stop control', chain);
    }

    function isSendButton(control) {
        if (!control.matches(CARD_CONTROLS)) return false;
        const label = (control.getAttribute('data-aria-label') || control.getAttribute('aria-label') ||
            control.textContent).trim();
        return label.toLowerCase() === 'send' || (!label && control.matches('md-filled-button.send-button'));
    }

    function isClickable(button) {
        return button.isConnected && !button.disabled && !button.hasAttribute('disabled') &&
            button.getAttribute('aria-disabled') !== 'true' && !visibilityBlocker(button);
    }

    function clearSettleTimer() {
        clearTimeout(settleTimer);
        settleTimer = null;
    }

    function resetTurn() {
        turn = null;
        clearSettleTimer();
        if (!alertActive) setWidgetStatus('idle');
    }

    function checkSession() {
        if (sessionPath === location.pathname) return;
        // A new chat can acquire a session URL while its first response is in progress.
        if (/\/session\/(?!-\/?$)[^/]+\/?$/.test(sessionPath)) {
            resetTurn();
            waitingForNewTurn = false;
            pendingSubmissionUntil = 0;
        }
        sessionPath = location.pathname;
    }

    function editorText(editor) {
        const input = editor.matches('[contenteditable]') ? editor :
            editor.querySelector('[contenteditable]') ?? editor;
        return input.innerText ?? input.textContent ?? '';
    }

    function composerText(eventPath = []) {
        const editor = eventPath.find((node) => node instanceof Element && node.matches(COMPOSER));
        if (editor) return editorText(editor);

        for (const root of roots.keys()) {
            for (const candidate of root.querySelectorAll(COMPOSER)) {
                if (candidate.isConnected && !visibilityBlocker(candidate)) {
                    const text = editorText(candidate);
                    if (text.trim()) return text;
                }
            }
        }
        return '';
    }

    function captureSubmission(text) {
        if (!text.trim()) return;
        checkSession();
        pendingSubmissionUntil = Date.now() + 30000;
        waitingForNewTurn = false;
    }

    function hasUserSubmission() {
        return Date.now() <= pendingSubmissionUntil;
    }

    function beginTurn(fromGeneration = false) {
        if (fromGeneration && hasUserSubmission()) {
            pendingSubmissionUntil = 0;
            resetTurn();
        }
        if (!turn) {
            stopCompletionAlert();
            turn = {
                streams: new Set(),
                latestStream: null,
                streamResult: null,
                revision: 0,
                hadReview: false,
                responseComplete: false,
                sawStop: false
            };
            setWidgetStatus('working');
        }
        return turn;
    }

    function pauseForReview() {
        if (!turn) return;
        const current = turn;
        current.hadReview = true;
        current.responseComplete = false;
        current.streamResult = null;
        current.revision++;
        clearSettleTimer();
    }

    function recordApproval(card) {
        if (approvedCards.has(card)) return;
        approvedCards.add(card);
        pauseForReview();
    }

    function beginStream() {
        checkSession();
        waitingForNewTurn = false;
        const current = beginTurn(true);
        const revision = current.revision;
        const stream = {};
        current.latestStream = stream;
        current.streamResult = null;
        current.responseComplete = false;
        current.streams.add(stream);
        clearSettleTimer();
        if (debug) console.debug('[OneDrive Auto-Approver] Chat stream opened');
        return (result) => {
            if (!current.streams.delete(stream) || current !== turn) return;
            if (current.revision === revision && current.latestStream === stream) {
                current.streamResult = result;
            }
            if (debug) console.debug('[OneDrive Auto-Approver] Chat stream ended', result);
            scheduleScan();
        };
    }

    function isChatStream(input, method) {
        if (typeof method !== 'string' || method.toUpperCase() !== 'POST') return false;
        try {
            const url = new URL(input, location.href);
            if (url.origin === 'https://discoveryengine.clients6.google.com') {
                return /^\/v1(?:alpha|beta)?\/locations\/[^/]+\/widgetStreamAssist\/?$/.test(url.pathname);
            }
            return (url.origin === location.origin ||
                /^https:\/\/(?:[a-z]+-)?discoveryengine\.googleapis\.com$/.test(url.origin)) &&
                /(?:\/|:)StreamAssist\/?$/i.test(url.pathname);
        } catch (_) {
            return false;
        }
    }

    function observeChatTransport() {
        const nativeFetch = window.fetch;
        window.fetch = function (...args) {
            const [input, init] = args;
            const request = input instanceof Request ? input : null;
            const responsePromise = nativeFetch.apply(this, args);
            if (!isChatStream(request?.url ?? input, init?.method ?? request?.method)) return responsePromise;

            const finish = beginStream();
            responsePromise.then(async (response) => {
                if (!response.ok || !response.body) {
                    finish('failed');
                    return;
                }
                try {
                    // The app keeps its original response. Discard every chunk without reading its contents.
                    const reader = response.clone().body.getReader();
                    try {
                        while (!(await reader.read()).done) {}
                    } finally {
                        reader.releaseLock();
                    }
                    finish('closed');
                } catch (_) {
                    finish('failed');
                }
            }, () => finish('failed'));
            return responsePromise;
        };

        const requests = new WeakSet();
        const xhr = XMLHttpRequest.prototype;
        const nativeOpen = xhr.open;
        const nativeSend = xhr.send;
        xhr.open = function (...args) {
            const result = nativeOpen.apply(this, args);
            requests.delete(this);
            if (isChatStream(args[1], args[0])) requests.add(this);
            return result;
        };
        xhr.send = function (...args) {
            if (!requests.has(this)) return nativeSend.apply(this, args);
            const finish = beginStream();
            const onEnd = () => finish(this.status >= 200 && this.status < 300 ? 'closed' : 'failed');
            this.addEventListener('loadend', onEnd, { once: true });
            try {
                return nativeSend.apply(this, args);
            } catch (error) {
                this.removeEventListener('loadend', onEnd);
                finish('failed');
                throw error;
            }
        };
    }

    const roots = new Map();
    const scanChannel = new MessageChannel();
    let scanQueued = false;
    function scheduleScan() {
        if (scanQueued) return;
        scanQueued = true;
        scanChannel.port2.postMessage(null);
    }

    function discoverShadowRoots(element) {
        if (element.shadowRoot) observeRoot(element.shadowRoot);
        for (const child of element.querySelectorAll('*')) {
            if (child.shadowRoot) observeRoot(child.shadowRoot);
        }
    }

    function observeRoot(root) {
        if (roots.has(root)) return;
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
                if (target?.closest('head, #ge-ios-widget, #ge-done-popup')) continue;
                for (const node of record.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) discoverShadowRoots(node);
                }
                scheduleScan();
            }
        });
        roots.set(root, observer);
        observer.observe(root, {
            subtree: true, childList: true, characterData: true, attributes: true,
            attributeFilter: [
                'class', 'style', 'hidden', 'disabled', 'aria-disabled', 'aria-hidden',
                'aria-label', 'data-aria-label', 'role', 'aria-live', 'slot', 'selected', 'checked'
            ]
        });
        discoverShadowRoots(root);
    }

    function inspectConversation() {
        const state = { stop: false, cards: new Set(), statuses: new Set() };
        let stopCandidate = null;
        let blocker = null;

        for (const [root, observer] of roots) {
            if (root.host && !root.host.isConnected) {
                observer.disconnect();
                roots.delete(root);
                continue;
            }
            if (!state.stop) {
                for (const button of root.querySelectorAll(STOP)) {
                    stopCandidate = button;
                    blocker = visibilityBlocker(button);
                    if (!blocker && button.getClientRects().length) {
                        state.stop = true;
                        break;
                    }
                }
            }
            for (const card of root.querySelectorAll(LIVE_CARD)) {
                if (!visibilityBlocker(card)) state.cards.add(card);
            }
            if (root.host?.localName === 'ucs-summary') {
                for (const status of root.querySelectorAll(STATUS)) {
                    if (status.textContent.trim() === 'Response complete') state.statuses.add(status);
                }
            }
        }

        if (debug && state.stop !== stopVisible) {
            if (stopCandidate) logStopChain(stopCandidate, blocker);
            else console.debug('[OneDrive Auto-Approver] Stop control absent');
        }
        return state;
    }

    function scanConversation(allowCompletion = false) {
        checkSession();
        createOrEnsureWidget();
        const { stop, cards, statuses } = inspectConversation();
        if (stop && (!stopVisible || hasUserSubmission()) && !waitingForNewTurn) beginTurn(true).sawStop = true;
        stopVisible = stop;

        for (const card of cards) {
            if (!pendingCards.has(card) && !approvedCards.has(card)) pauseForReview();
        }
        const newCompletion = [...statuses].some((status) => !completedStatuses.has(status));
        completedStatuses = statuses;
        pendingCards = cards;

        if (cards.size) {
            clearSettleTimer();
            if (isRunning) approveConfirmationCards(cards);
            return;
        }

        if (isRunning && !stop && !turn?.streams.size) restoreOneDriveConnector();

        if (!turn) return;
        if (newCompletion) turn.responseComplete = true;
        const streamClosed = turn.streamResult === 'closed';
        const canIgnoreStaleStop = document.hidden && (streamClosed || turn.responseComplete);
        const hasCompletion = turn.responseComplete || streamClosed ||
            (!turn.hadReview && turn.streamResult === null && turn.sawStop);
        if ((stop && !canIgnoreStaleStop) || turn.streams.size || !hasCompletion) {
            clearSettleTimer();
            if (!stop && !turn.streams.size && turn.streamResult === 'failed') resetTurn();
            return;
        }

        if (allowCompletion) {
            waitingForNewTurn = canIgnoreStaleStop;
            turn = null;
            clearSettleTimer();
            startCompletionAlert();
        } else if (settleTimer === null) {
            settleTimer = setTimeout(() => scanConversation(true), DONE_DEBOUNCE_MS);
        }
    }

    function restoreOneDriveConnector() {
        for (const root of roots.keys()) {
            const host = root.host;
            if (!host?.isConnected || !host.matches(ONEDRIVE_SWITCH)) continue;
            let parent = composedParent(host);
            while (parent && !parent.matches(CONNECTOR_MENU)) parent = composedParent(parent);
            if (!parent) continue;

            const input = root.querySelector(ONEDRIVE_INPUT);
            if (!input || input.disabled || host.disabled || host.getAttribute('aria-disabled') === 'true') continue;
            if (host.selected === true) {
                attemptedConnectorSwitch = null;
                return;
            }
            if (input.checked || input === attemptedConnectorSwitch) return;

            // The authorized switch stays mounted in the closed menu.
            attemptedConnectorSwitch = input;
            input.click();
            console.info('[OneDrive Auto-Approver] Requested re-enable of the OneDrive connector');
            return;
        }
    }

    function approveConfirmationCards(cards) {
        for (const card of cards) {
            if (approvedCards.has(card) || !card.matches(LIVE_CARD)) continue;

            for (const send of card.querySelectorAll(CARD_CONTROLS)) {
                if (send.closest(LIVE_CARD) !== card || !isSendButton(send) || !isClickable(send)) continue;
                const button = send.shadowRoot?.querySelector('button') ?? send;
                if (!isClickable(button)) continue;

                beginTurn(true);
                recordApproval(card);
                button.click();
                metrics.approved++;
                updateTelemetry();
                console.log('[OneDrive Auto-Approver] Automatic confirmation sent');
                break;
            }
        }
    }

    window.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        const path = event.composedPath().filter((node) => node instanceof Element);
        if (path.some((node) => node.matches(STOP))) {
            resetTurn();
        } else if (path.some((node) => node.matches(SUBMIT)) && !path.some((node) => node.matches(LIVE_CARD))) {
            captureSubmission(composerText(path));
        } else if (path.some(isSendButton)) {
            const card = path.find((node) => node.matches(LIVE_CARD));
            if (card) recordApproval(card);
        }
    }, true);

    window.addEventListener('keydown', (event) => {
        if (!event.isTrusted || event.key !== 'Enter' || event.isComposing ||
            event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        const path = event.composedPath();
        if (path.some((node) => node instanceof Element && node.matches(COMPOSER))) {
            captureSubmission(composerText(path));
        }
    }, true);

    scanChannel.port1.onmessage = () => {
        scanQueued = false;
        scanConversation();
    };

    // 4. Toggle and keyboard shortcuts
    // -------------------------------------------------------------------------
    function toggleAutoApprove() {
        isRunning = !isRunning;
        attemptedConnectorSwitch = null;
        if (isRunning) prepareNotifications();
        console.log(
            `%c>>> [Auto-Approve OneDrive] ${isRunning ? 'ON' : 'OFF'} <<<`,
            `color: ${isRunning ? '#34C759' : '#ff453a'}; font-weight: bold;`
        );
        updateWidgetUI();
        scheduleScan();
    }

    function isTypingInInput(event) {
        const path = event.composedPath ? event.composedPath() : [event.target];
        for (const node of path) {
            if (!node || !node.tagName) continue;
            const tag = node.tagName.toLowerCase();
            if (
                tag === 'input' ||
                tag === 'textarea' ||
                tag === 'md-outlined-text-field' ||
                node.isContentEditable ||
                (node.getAttribute && node.getAttribute('contenteditable') === 'true') ||
                (node.getAttribute && node.getAttribute('role') === 'textbox')
            ) {
                return true;
            }
        }
        return false;
    }

    window.addEventListener(
        'keydown',
        (event) => {
            if (event.key === '`' && !event.ctrlKey && !event.altKey && !event.metaKey) {
                if (isTypingInInput(event)) return;
                event.preventDefault();
                event.stopPropagation();
                toggleAutoApprove();
            } else if (event.key === '~' && event.shiftKey && !event.ctrlKey && !event.altKey) {
                if (isTypingInInput(event)) return;
                event.preventDefault();
                resetWidgetPosition();
            }
        },
        true
    );

    const nativeAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (...args) {
        const root = nativeAttachShadow.apply(this, args);
        if (root.mode === 'open' && this.isConnected) observeRoot(root);
        scheduleScan();
        return root;
    };

    // Snapshot of PROMPT.md’s "Message to paste" block for the standalone userscript.
    // Refresh this block when the prompt changes.
    const PROJECT_PROMPT = [
        "Project name: <ProjectName>",
        "",
        "Use the NTU Vibe Bridge for the project named on the first line. Keep that exact folder name throughout this chat. If this message only sets up the project, read the snapshot and confirm what you found. A requested file change includes delivering the validated delta to OneDrive in that same turn. Questions, reviews, and drafts are read-only.",
        "",
        "## Read the current snapshot and assets",
        "",
        "Use Microsoft OneDrive to download the complete `projects/<ProjectName>/repo-context.txt` by exact path. Use a direct OneDrive lookup and download. Reuse any project folder or drive ID returned for that exact path when the upload needs it. If the exact lookup fails, report the path and connector error. Use the active skill or supplied prompt. Use only exact project paths for OneDrive lookups and load the recovery skill only for an explicit recovery request. Read the snapshot again for each change request. It is JSON with format `vibebridge-snapshot-v2`. In the Python tool, parse that exact downloaded file and use the same snapshot object to reconstruct the workspace and generate the patch. Copy the snapshot ID from the parsed object. If the user includes `VibeBridge: snapshot <ID>`, compare it with the downloaded snapshot before editing and pass that ID to `pack_delta` as `expected_snapshot_id`. If they differ, report both IDs and stop before requesting an upload. For editable text, reconstruct the original bytes with `snapshot_bytes(entry)` below. Write those bytes to an isolated workspace before editing. Keep each file's BOM, line endings, and final newline unless the task explicitly changes the final newline. If the snapshot is missing or uses the older format, ask the user to start the updated watcher.",
        "",
        "For binary bytes, download the actual asset from `projects/<ProjectName>/assets/`. If its file type is unsupported, download the complete `asset-bytes/<path-below-assets>.base64.txt` and decode it with `base64.b64decode(text.strip(), validate=True)`. Check the byte length if the task gives an expected length. Report a missing, partial, or mismatched asset before using it.",
        "",
        "## Deliver the change in the same turn",
        "",
        "For a request to change files, the caller with OneDrive write access must complete this sequence before its final reply. At the start, identify the actual OneDrive **Upload file** action and confirm you can call it after Python returns. Keep the work with the OneDrive-capable caller. Edit, run the relevant tests, and package the tested files in the same Python workspace and turn. Delegate only if the tool returns the completed package to this caller within the turn. If no such tool path is available, report which action or handoff is unavailable before spending time preparing an undeliverable package.",
        "",
        "1. Edit and test the isolated workspace. Run the exact Python packer below against the downloaded snapshot and the final tested files. Pass the explicit changed paths. Use its output as the patch. It emits exact `edits` for text changes and `confirmDelete: true` for authorized deletions. A `create` operation uses either a `text` string for UTF-8 or a `base64` string for exact bytes. Supply one field per operation. Replacements use `base64`.",
        "2. Check the exact `projects/<ProjectName>/apply-changes.ps1` path once and upload only if the slot is clear. Generate the package once and save the exact ASCII package as `vibebridge-<patchId>.txt` in the isolated workspace. Record the byte count. Return the complete text to the OneDrive-capable caller through tool output if needed for direct upload. If stdout is the only route, use separate boundary lines, exclude the boundaries and separator newline from the package, and compare its length to detect truncation. Keep source and payload text in tools.",
        "3. Immediately call Microsoft OneDrive **Upload file** in this turn using the method below.",
        "4. Before any final reply, either obtain the actual connector result, surface its pending confirmation, or state the exact blocker and which action could not be called. Reply with a short summary of changes, checks, destination, snapshot ID, patch ID, byte count, and upload status. Keep full source, Base64, and patch text out of the visible reply. After success, the local watcher reports `[PATCH]`, `[APPLIED]`, and a fresh `[READY]`. Wait for the new snapshot before delivering another change.",
        "",
        "## OneDrive upload method",
        "",
        "1. Prefer a session-file reference when the connector can access the exact prepared package as an attachment. Use its actual attachment name in `InputFileName` and `apply-changes.ps1` in `FileName`. Leave `Content` and `ContentBytes` unset for the reference attempt. A workspace filename alone is insufficient. To avoid selecting an older attachment, use a filename such as `vibebridge-<patchId>.txt` when exposing the package to the session.",
        "2. If the runtime cannot expose the file as an attachment, or the reference explicitly fails before writing, use the exact prepared text as direct `Content` with `FileName: apply-changes.ps1`. Set `HasBytes` to false when available and `InputFileName` to `apply-changes.ps1` if required for this route. Preserve the patch ID and package text. If the upload outcome is uncertain, report it and stop. An approval card means the upload is pending.",
        "3. Report whether OneDrive used a file reference or direct text and give the actual result, pending approval, or exact connector error. Keep the source and package text in tools.",
        "",
        "## Python packer",
        "",
        "Copy this code into the direct Python execution tool. Example for an edit: `content = pack_delta(snapshot, workspace, edit=[\"src/example.py\"])`. Pass `create=[...]` only for new files. Pass `replace=[...]` for changed binaries or non-exact snapshot text. Pass `delete=[...]` only for files the user explicitly authorized deleting. Read-only turns stop after answering the question.",
        "",
        "```python",
        "import base64",
        "import json",
        "import uuid",
        "from difflib import SequenceMatcher",
        "from pathlib import Path",
        "",
        "def exact_bytes(text, entry):",
        "    if entry[\"eol\"] == \"crlf\":",
        "        text = text.replace(\"\\n\", \"\\r\\n\")",
        "    return ((\"\\ufeff\" if entry[\"bom\"] else \"\") + text).encode(\"utf-8\")",
        "",
        "def snapshot_bytes(entry):",
        "    if entry.get(\"eol\") not in (\"lf\", \"crlf\"):",
        "        raise ValueError(\"No exact text bytes in snapshot\")",
        "    return exact_bytes(entry[\"text\"], entry)",
        "",
        "def text_edits(old, new):",
        "    before, after = old.splitlines(keepends=True), new.splitlines(keepends=True)",
        "    matcher = SequenceMatcher(None, before, after)",
        "    for context in (1, 3, 8, 24):",
        "        pairs = []",
        "        for group in matcher.get_grouped_opcodes(context):",
        "            start, end = group[0], group[-1]",
        "            a = \"\".join(before[start[1]:end[2]])",
        "            b = \"\".join(after[start[3]:end[4]])",
        "            pairs.append((a, b))",
        "        if all(a and old.find(a, old.index(a) + 1) == -1 for a, _ in pairs):",
        "            break",
        "    else:",
        "        pairs = [(old, new)]",
        "    cursor, rebuilt = 0, []",
        "    for a, b in pairs:",
        "        start = old.index(a)",
        "        if start < cursor:",
        "            raise ValueError(\"Overlapping edits\")",
        "        rebuilt.extend((old[cursor:start], b))",
        "        cursor = start + len(a)",
        "    if \"\".join(rebuilt) + old[cursor:] != new:",
        "        raise ValueError(\"Edits do not reproduce the tested text\")",
        "    return [{\"before\": a, \"after\": b} for a, b in pairs]",
        "",
        "def project_file(root, name):",
        "    if root is None or \"\\\\\" in name or \":\" in name or any(",
        "        part in (\"\", \".\", \"..\") for part in name.split(\"/\")",
        "    ):",
        "        raise ValueError(f\"Expected a project-relative file path: {name}\")",
        "    root = Path(root).resolve()",
        "    file = (root / name).resolve()",
        "    if not file.is_relative_to(root):",
        "        raise ValueError(f\"File escapes the workspace: {name}\")",
        "    return file",
        "",
        "def pack_delta(snapshot, workspace, *, edit=(), create=(), replace=(), delete=(),",
        "               expected_snapshot_id=None):",
        "    if snapshot[\"format\"] != \"vibebridge-snapshot-v2\":",
        "        raise ValueError(\"Expected a v2 snapshot\")",
        "    snapshot_id = snapshot[\"snapshotId\"]",
        "    if expected_snapshot_id is not None and snapshot_id != expected_snapshot_id:",
        "        raise ValueError(f\"Downloaded snapshot {snapshot_id} differs from expected {expected_snapshot_id}\")",
        "    operations, seen = [], set()",
        "    for kind, paths in ((\"edit\", edit), (\"create\", create),",
        "                        (\"replace\", replace), (\"delete\", delete)):",
        "        for name in paths:",
        "            if name.lower() in seen:",
        "                raise ValueError(f\"Duplicate operation: {name}\")",
        "            seen.add(name.lower())",
        "            entry = snapshot[\"files\"].get(name, {})",
        "            exact = entry.get(\"eol\") in (\"lf\", \"crlf\")",
        "            file = project_file(workspace, name)",
        "            op = {\"op\": kind, \"path\": name}",
        "            if kind == \"create\" and entry:",
        "                raise ValueError(f\"Create would overwrite a snapshot file: {name}\")",
        "            if kind == \"edit\" and not exact:",
        "                raise ValueError(f\"Missing exact snapshot text: {name}\")",
        "            if kind == \"replace\" and exact:",
        "                raise ValueError(f\"Use an edit for exact snapshot text: {name}\")",
        "            if kind == \"delete\":",
        "                if file.exists():",
        "                    raise ValueError(f\"Remove the file from the tested workspace: {name}\")",
        "                op[\"confirmDelete\"] = True",
        "            else:",
        "                data = file.read_bytes()",
        "                if kind == \"edit\":",
        "                    if data == snapshot_bytes(entry):",
        "                        continue",
        "                    text = data.decode(\"utf-8-sig\").replace(\"\\r\\n\", \"\\n\")",
        "                    if \"\\r\" in text or exact_bytes(text, entry) != data:",
        "                        raise ValueError(f\"Restore the original BOM and line endings: {name}\")",
        "                    op[\"edits\"] = text_edits(entry[\"text\"], text)",
        "                else:",
        "                    text = None",
        "                    if kind == \"create\" and b\"\\0\" not in data:",
        "                        try:",
        "                            text = data.decode(\"utf-8\")",
        "                        except UnicodeDecodeError:",
        "                            pass",
        "                    if text is None:",
        "                        op[\"base64\"] = base64.b64encode(data).decode(\"ascii\")",
        "                    else:",
        "                        op[\"text\"] = text",
        "            operations.append(op)",
        "    if not 1 <= len(operations) <= 200:",
        "        raise ValueError(\"Expected 1 to 200 changed files\")",
        "    package = {\"version\": 2, \"project\": snapshot[\"project\"],",
        "               \"snapshotId\": snapshot_id, \"patchId\": str(uuid.uuid4()),",
        "               \"operations\": operations}",
        "    content = \"# VibeBridge Delta v2\\n\" + json.dumps(package, ensure_ascii=True, separators=(\",\", \":\"))",
        "    if len(content) > 7_000_000:",
        "        raise ValueError(\"Delta exceeds the 7,000,000-byte bridge budget\")",
        "    return content",
        "```",
    ].join('\n');

    observeChatTransport();
    observeRoot(document);
    document.addEventListener('DOMContentLoaded', scheduleScan, { once: true });
    document.addEventListener('visibilitychange', () => {
        updateTelemetry();
        scheduleScan();
    });
    window.addEventListener('popstate', scheduleScan);
    scheduleScan();

})();
