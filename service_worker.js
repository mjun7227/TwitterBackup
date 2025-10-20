// 전역 상태
let allBookmarks = new Set(); // 북마크 URL 수집용 전역 Set
// 디버거 에뮬레이션 상태
const attachedEmulationTabs = new Set();
const DEVICE_PRESETS = {
    galaxyFold5: {
        // Galaxy Z Fold5 (Android/Chrome) UA 예시
        ua: "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-F946N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
        // 접힌 외부(커버) 디스플레이 기준 세로 모드 CSS 픽셀 (DevTools 344x882)
        width: 344,
        height: 882,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true
    }
};

// 유틸 지연 함수
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 디버거 분리 이벤트에서 상태 정리
chrome.debugger.onDetach.addListener((source, reason) => {
    if (source && typeof source.tabId === 'number') {
        attachedEmulationTabs.delete(source.tabId);
    }
});

async function attachDebugger(tabId) {
    if (attachedEmulationTabs.has(tabId)) return;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const error = await new Promise((resolve) => {
            chrome.debugger.attach({ tabId }, "1.3", () => {
                if (chrome.runtime.lastError) {
                    resolve(chrome.runtime.lastError.message);
                } else {
                    resolve(null);
                }
            });
        });
        if (!error) {
            attachedEmulationTabs.add(tabId);
            return;
        }
        // 다른 디버거가 붙어있거나 일시적 실패 시 한 번 재시도
        if (attempt < maxAttempts && /Another debugger|Target is closing|No target|Timed out/i.test(error)) {
            await delay(150);
            continue;
        }
        throw new Error(error);
    }
}

function detachDebugger(tabId) {
    return new Promise((resolve) => {
        if (!attachedEmulationTabs.has(tabId)) {
            resolve();
            return;
        }
        chrome.debugger.detach({ tabId }, () => {
            attachedEmulationTabs.delete(tabId);
            resolve();
        });
    });
}

async function enableDeviceEmulation(tabId, presetKey) {
    const preset = DEVICE_PRESETS[presetKey] || DEVICE_PRESETS.galaxyFold5;
    await attachDebugger(tabId);
    // 네트워크 도메인 활성화 (UA 오버라이드 신뢰성 개선)
    await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(
            { tabId },
            "Network.enable",
            {},
            () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                resolve();
            }
        );
    });
    // Viewport / metrics
    await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(
            { tabId },
            "Emulation.setDeviceMetricsOverride",
            {
                width: preset.width,
                height: preset.height,
                deviceScaleFactor: preset.deviceScaleFactor,
                mobile: preset.mobile,
                screenWidth: preset.width,
                screenHeight: preset.height,
                positionX: 0,
                positionY: 0
            },
            () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                resolve();
            }
        );
    });
    // Touch
    await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(
            { tabId },
            "Emulation.setTouchEmulationEnabled",
            { enabled: !!preset.touch },
            () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                resolve();
            }
        );
    });
    // UA override
    await new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(
            { tabId },
            "Network.setUserAgentOverride",
            { userAgent: preset.ua },
            () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError.message);
                resolve();
            }
        );
    });
}

async function disableDeviceEmulation(tabId) {
    // Clear metrics by clearing override using setVisibleSize and clear?
    // The most reliable approach is to detach the debugger which resets overrides.
    await detachDebugger(tabId);
}

// 메시지 리스너 단일화
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message && message.action;
    switch (action) {
        case "enableEmulation": {
            const tabId = message.tabId;
            const preset = message.preset;
            if (typeof tabId !== "number") {
                sendResponse({ ok: false, error: "tabId 누락" });
                break;
            }
            enableDeviceEmulation(tabId, preset)
                .then(() => sendResponse({ ok: true }))
                .catch((err) => sendResponse({ ok: false, error: String(err) }));
            return true;
        }
        case "disableEmulation": {
            const tabId = message.tabId;
            if (typeof tabId !== "number") {
                sendResponse({ ok: false, error: "tabId 누락" });
                break;
            }
            disableDeviceEmulation(tabId)
                .then(() => sendResponse({ ok: true }))
                .catch((err) => sendResponse({ ok: false, error: String(err) }));
            return true;
        }
        case "finishBackup": {
            const users = message.users || [];
            const count = users.length;
            const listItems = users.map(u => {
                const handle = (typeof u === 'string' ? u : '').replace(/^@/, '');
                const url = `https://x.com/${handle}`;
                return `<li><a href="${url}">${url}</a></li>`;
            }).join("");
            const html = `<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>트위터 팔로우 백업</title></head><body><h1>트위터 팔로우 백업 목록</h1><p>총 ${count}개</p><ul>${listItems}</ul></body></html>`;
            const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
            const tabId = sender && sender.tab && sender.tab.id;
            chrome.downloads.download({
                url: dataUrl,
                filename: `twitter_follows_backup_${Date.now()}.html`,
                saveAs: true
            }, () => {
                if (typeof tabId === 'number') {
                    disableDeviceEmulation(tabId).finally(() => {
                        chrome.runtime.sendMessage({ action: "backupComplete", count: users.length });
                    });
                } else {
                    chrome.runtime.sendMessage({ action: "backupComplete", count: users.length });
                }
            });
            break;
        }
        case "ADD_BOOKMARKS": {
            if (Array.isArray(message.data)) {
                message.data.forEach(url => allBookmarks.add(url));
                console.log(`현재까지 ${allBookmarks.size}개의 북마크가 수집되었습니다.`);
            }
            break;
        }
        case "BOOKMARK_EXTRACTION_COMPLETE": {
            const bookmarksArray = Array.from(allBookmarks);
            const count = bookmarksArray.length;
            const listItems = bookmarksArray.map(url => `<li><a href="${url}">${url}</a></li>`).join("");
            const html = `<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>트위터 북마크 백업</title></head><body><h1>트위터 북마크 백업 목록</h1><p>총 ${count}개</p><ul>${listItems}</ul></body></html>`;
            const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
            const tabId = sender && sender.tab && sender.tab.id;
            chrome.downloads.download({
                url: dataUrl,
                filename: `twitter_bookmarks_backup_${Date.now()}.html`,
                saveAs: true
            }, () => {
                if (typeof tabId === 'number') {
                    disableDeviceEmulation(tabId).finally(() => {
                        chrome.runtime.sendMessage({ action: "bookmarkBackupComplete", count: bookmarksArray.length });
                    });
                } else {
                    chrome.runtime.sendMessage({ action: "bookmarkBackupComplete", count: bookmarksArray.length });
                }
            });
            allBookmarks.clear();
            break;
        }
        case "finishListBackup": {
            const urls = Array.isArray(message.urls) ? message.urls : [];
            const count = urls.length;
            const listItems = urls.map(u => `<li><a href="${u}">${u}</a></li>`).join("");
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>트위터 리스트 백업</title></head><body><h1>트위터 리스트 백업</h1><p>총 ${count}개</p><ul>${listItems}</ul></body></html>`;
            const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
            const tabId = sender && sender.tab && sender.tab.id;
            chrome.downloads.download({
                url: dataUrl,
                filename: `twitter_lists_backup_${Date.now()}.html`,
                saveAs: true
            }, () => {
                if (typeof tabId === 'number') {
                    disableDeviceEmulation(tabId).finally(() => {
                        chrome.runtime.sendMessage({ action: "listBackupComplete", count });
                    });
                } else {
                    chrome.runtime.sendMessage({ action: "listBackupComplete", count });
                }
            });
            break;
        }
        default:
            break;
    }
    return true;
});