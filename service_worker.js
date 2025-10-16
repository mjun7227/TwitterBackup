// 전역 상태
let allBookmarks = new Set(); // 북마크 URL 수집용 전역 Set
// 알림 제거 버전: 전역 보관 변수/리스너 불필요

// 메시지 리스너 단일화
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message && message.action;
    switch (action) {
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
            chrome.downloads.download({
                url: dataUrl,
                filename: `twitter_follows_backup_${Date.now()}.html`,
                saveAs: true
            }, () => {
                chrome.runtime.sendMessage({ action: "backupComplete", count: users.length });
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
            chrome.downloads.download({
                url: dataUrl,
                filename: `twitter_bookmarks_backup_${Date.now()}.html`,
                saveAs: true
            }, () => {
                chrome.runtime.sendMessage({ action: "bookmarkBackupComplete", count: bookmarksArray.length });
            });
            allBookmarks.clear();
            break;
        }
        default:
            break;
    }
    return true;
});