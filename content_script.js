(function() {
// 전역 재주입 가드 (동일 탭에서 중복 주입 방지)
if (window.__TWITTER_BACKUP_CS_LOADED__) {
    console.log("content_script: already loaded, skip init");
    return;
}
window.__TWITTER_BACKUP_CS_LOADED__ = true;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 스크롤 영역 (트위터의 메인 컬럼)
const SCROLL_CONTAINER_SELECTOR = 'main[role="main"]';

// Key: 고유 ID (testId), Value: Username (@handle)
let extractedUsersMap = new Map();
let isFollowExtractionRunning = false;
let isBookmarkExtractionRunning = false;
let cancelBookmarkRequested = false;
let extractedBookmarkUrls = new Set();


function extractUsers() {
    // 사용자가 포함된 버튼/링크 요소를 찾습니다.
    const BUTTON_SELECTOR = 'button[data-testid]'; 
    const buttons = document.querySelectorAll(BUTTON_SELECTOR); 
    let newUsersCount = 0;

    for (const button of buttons) {
        try {
            // 1. data-testid에서 숫자 ID 추출 (Deduplication Key로 사용)
            const rawId = button.getAttribute("data-testid");
            if (!rawId) continue;
            
            const matchId = rawId.match(/\d+/);
            if (!matchId) continue;
            
            const testId = matchId[0]; // 고유 ID

            if (extractedUsersMap.has(testId)) {
                continue; // 이미 처리된 ID 건너뛰기
            }

            // 2. aria-label에서 계정명 (@username) 추출 (최종 저장할 값)
            const followerRaw = button.getAttribute("aria-label");
            if (!followerRaw) continue;

            // '@'로 시작하는 문자열을 찾습니다.
            const matchFollower = followerRaw.match(/@\S+/); 
            if (!matchFollower) continue;

            const followerUsername = matchFollower[0]; // 최종 Username

            // 3. 새로운 사용자이므로 Map에 ID와 Username을 저장하고 카운트 증가
            extractedUsersMap.set(testId, followerUsername); 
            newUsersCount++;

        } catch (e) {
            console.error("Extraction error on element:", e); 
            continue;
        }
    }
    
    return newUsersCount; // 새로 추출된 사용자 수 반환
}


/**
 * 무한 스크롤 및 추출을 비동기로 실행합니다.
 */
async function autoScrollAndExtract(scrollLimit = 500) {
    if (isFollowExtractionRunning) return;
    isFollowExtractionRunning = true;
    const container = document.querySelector(SCROLL_CONTAINER_SELECTOR);
    if (!container) {
        // ... (오류 메시지 처리) ...
        chrome.runtime.sendMessage({ action: "backupError", message: "팔로우 목록 컨테이너를 찾을 수 없습니다. 셀렉터 확인 필요." });
        isFollowExtractionRunning = false;
        return;
    }
    
    let lastHeight = container.scrollHeight;
    let noNewUsersCount = 0; 

    // 추출을 시작하기 전에 초기 데이터 한 번 추출
    extractUsers(); 

    for (let i = 0; i < scrollLimit; i++) {
        // 1. 특정 픽셀만큼 스크롤을 내립니다.
        window.scrollBy({top: 900,left: 0,behavior: 'instant'}) // 특정 값만큼 스크롤

        // 2. 새 콘텐츠 로드를 위해 잠시 대기
        await delay(1000); 

        // 3. 현재 뷰포트에서 데이터 추출 (새로운 데이터가 로드되었는지 확인)
        const newUsersExtracted = extractUsers(); 
        
        if (newUsersExtracted > 0) {
            noNewUsersCount = 0; 
        } else {
            noNewUsersCount++;
        }

        let newHeight = container.scrollHeight;

        // 4. 종료 조건 확인:
        if (newHeight === lastHeight) {
            // 스크롤 높이 변화 없고 (페이지 끝 도달) 새 사용자도 없으면 종료
            if (noNewUsersCount >= 6) { 
                 console.log("스크롤의 끝에 도달했으며, 새로운 사용자가 로드되지 않았습니다.");
                 break;
            }
        } else {
            lastHeight = newHeight;
        }

        if (noNewUsersCount >= 6) { 
             // 10회 연속으로 새 사용자 찾기 실패 시 (안정성 확보를 위한 조건) 강제 종료
             console.log("10회 연속으로 새 사용자 추출 실패. 스크래핑 종료.");
             break;
        }
    }
    
    // 추출 완료 후, service_worker로 결과 전송
    const finalUsers = Array.from(extractedUsersMap.values());
    
    chrome.runtime.sendMessage({
        action: "finishBackup",
        users: finalUsers 
    });
    isFollowExtractionRunning = false;
}


// 북마크 링크를 추출하는 함수 

function extractBookmarks() {
    const linkElements = document.querySelectorAll('a[href*="/analytics"]');
    const newlyFound = [];

    linkElements.forEach(a => {
        const fullPath = a.getAttribute('href');
        if (!fullPath) return;

        let finalUrl = null;
        if (fullPath.includes('/analytics')) {
            const cleanPath = fullPath.substring(0, fullPath.lastIndexOf('/analytics'));
            finalUrl = `https://x.com${cleanPath}`;
        } else if (fullPath.includes('/status/')) {
            finalUrl = `https://x.com${fullPath}`;
        }

        if (!finalUrl) return;
        if (extractedBookmarkUrls.has(finalUrl)) return;
        extractedBookmarkUrls.add(finalUrl);
        newlyFound.push(finalUrl);
    });

    if (newlyFound.length > 0) {
        chrome.runtime.sendMessage({ action: "ADD_BOOKMARKS", data: newlyFound });
    }
    return newlyFound.length;
}



const MAX_SCROLL_COUNT = 3000; // 최대 스크롤 횟수 설정 (무한 루프 방지)

// 북마크 추출 전용 무한 스크롤 및 추출 함수
async function autoScrollAndExtractBookmarks() {
    if (isBookmarkExtractionRunning) return;
    isBookmarkExtractionRunning = true;
    console.log("북마크 추출 시작...");

    const container = document.querySelector(SCROLL_CONTAINER_SELECTOR);
    if (!container) {
        chrome.runtime.sendMessage({ action: "backupError", message: "북마크 컨테이너를 찾을 수 없습니다. 셀렉터 확인 필요." });
        isBookmarkExtractionRunning = false;
        return;
    }

    let lastHeight = container.scrollHeight;
    let noNewItemsCount = 0;
    let scrollCount = 0;

    // 초기 추출 1회
    extractBookmarks();

    while (scrollCount < MAX_SCROLL_COUNT) {
        if (cancelBookmarkRequested) {
            console.log("북마크 추출 취소 요청 수신. 종료합니다.");
            break;
        }

        // 1. 스크롤 실행
        window.scrollBy({ top: 900, left: 0, behavior: 'instant' });

        // 2. 새 콘텐츠 로드를 위해 잠시 대기
        await delay(1000);

        // 3. 새로 로드된 영역에서 추출
        const newItemsExtracted = extractBookmarks();
        if (newItemsExtracted > 0) {
            noNewItemsCount = 0;
        } else {
            noNewItemsCount++;
        }

        // 4. 높이 비교로 끝 검출
        const newHeight = container.scrollHeight;
        if (newHeight === lastHeight) {
            if (noNewItemsCount >= 8) {
                console.log("스크롤의 끝에 도달했으며, 새로운 북마크가 로드되지 않았습니다.");
                break;
            }
        } else {
            lastHeight = newHeight;
        }

        // 5. 안정성 종료 조건
        if (noNewItemsCount >= 8) {
            console.log("8회 연속으로 새 북마크 추출 실패. 스크래핑 종료.");
            break;
        }

        scrollCount++;
    }

    chrome.runtime.sendMessage({ action: "BOOKMARK_EXTRACTION_COMPLETE" });
    isBookmarkExtractionRunning = false;
    cancelBookmarkRequested = false;
}

// 리스트 백업 상태
let isListExtractionRunning = false;
let extractedListUsers = new Set();

/**
 * 리스트 페이지에서 아바타 컨테이너의 data-testid 값으로부터 유저네임을 추출
 * 대상: div[data-testid^="UserAvatar-Container-"]
 * 예: data-testid="UserAvatar-Container-jack" -> username "jack" -> https://x.com/jack
 */
function extractListUsers() {
    const AVATAR_SELECTOR = 'div[data-testid^="UserAvatar-Container-"]';
    const nodes = document.querySelectorAll(AVATAR_SELECTOR);
    let newlyFound = 0;

    nodes.forEach(node => {
        try {
            const raw = node.getAttribute('data-testid');
            if (!raw) return;
            const username = raw.replace(/^UserAvatar-Container-/, '').trim();
            if (!username) return;
            const url = `https://x.com/${username}`;
            if (!extractedListUsers.has(url)) {
                extractedListUsers.add(url);
                newlyFound++;
            }
        } catch (e) {
            console.error('리스트 유저 추출 중 오류:', e);
        }
    });

    return newlyFound;
}

// 리스트 멤버 페이지 가드
function isOnListMembersPage() {
    try {
        const url = new URL(window.location.href);
        return (
            url.hostname === 'x.com' &&
            url.pathname.startsWith('/i/lists/') &&
            url.pathname.endsWith('/members')
        );
    } catch (e) {
        return false;
    }
}
/**
 * 리스트 전용 무한 스크롤 + 추출 루프
 */
async function autoScrollAndExtractList() {
    if (isListExtractionRunning) return;
    isListExtractionRunning = true;
    console.log('리스트 백업 추출 시작...');
    
    // URL 가드: x.com/i/lists/.../members 에서만 실행
    if (!isOnListMembersPage()) {
        chrome.runtime.sendMessage({
            action: "backupError",
            message: "리스트 멤버 페이지(x.com/i/lists/.../members)에서 실행하세요."
        });
        isListExtractionRunning = false;
        return;
    }

    const container = document.querySelector(SCROLL_CONTAINER_SELECTOR);
    if (!container) {
        chrome.runtime.sendMessage({ action: "backupError", message: "리스트 컨테이너를 찾을 수 없습니다. 셀렉터 확인 필요." });
        isListExtractionRunning = false;
        return;
    }

    let lastHeight = container.scrollHeight;
    let noNewCount = 0;
    let scrollCount = 0;

    // 초기 한 번 추출
    extractListUsers();

    while (scrollCount < MAX_SCROLL_COUNT) {
        // 스크롤
        window.scrollBy({ top: 900, left: 0, behavior: 'instant' });
        await delay(1000);

        // 추출
        const newItems = extractListUsers();
        if (newItems > 0) {
            noNewCount = 0;
        } else {
            noNewCount++;
        }

        // 높이 변화 감지
        const newHeight = container.scrollHeight;
        if (newHeight === lastHeight) {
            if (noNewCount >= 6) {
                console.log('리스트 스크롤 끝 감지, 새로운 항목 없음.');
                break;
            }
        } else {
            lastHeight = newHeight;
        }

        // 안정성 종료
        if (noNewCount >= 6) {
            console.log('6회 연속 새 리스트 멤버 항목 없음. 종료.');
            break;
        }

        scrollCount++;
    }

    // 결과 전송
    const urls = Array.from(extractedListUsers.values());
    chrome.runtime.sendMessage({ action: "finishListBackup", urls });
    // 상태 초기화
    extractedListUsers.clear();
    isListExtractionRunning = false;
}

// 팝업에서 메시지를 받으면 시작
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startBackup") {
        if (isFollowExtractionRunning) return;
        console.log("백업 스크립트 실행. 스크롤 시작.");
        autoScrollAndExtract(500);
    } else if (request.action === "startBookmarkBackup") {
        if (isBookmarkExtractionRunning) return;
        console.log("북마크 백업 스크립트 실행. 스크롤 시작.");
        autoScrollAndExtractBookmarks();
    } else if (request.action === 'stopBookmarkBackup') {
        if (!isBookmarkExtractionRunning) return;
        cancelBookmarkRequested = true;
    } else if (request.action === "startListBackup") {
        if (isListExtractionRunning) return;
        console.log("리스트 백업 스크립트 실행. 스크롤 시작.");
        autoScrollAndExtractList();
    }
});

})(); 