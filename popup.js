document.getElementById('backupFollows').addEventListener('click', () => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = '백업 중...';

  // 현재 활성화된 탭에 메시지를 보낼 준비
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      statusElement.textContent = '오류: 활성화된 탭이 없습니다.';
      return;
    }
    const tabId = tabs[0].id;

    // content_script를 주입하고, 실행 후, service_worker에게 결과를 전달하도록 지시
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content_script.js']
    }, () => {
      // Content Script가 주입된 후, Content Script에게 작업을 시작하라는 메시지를 보냄
      chrome.tabs.sendMessage(tabId, { action: "startBackup" });
    });
  });
});
document.getElementById('backupBookmarks').addEventListener('click', () => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = '북마크 백업 중...';

  // 현재 활성화된 탭에 메시지를 보낼 준비
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      statusElement.textContent = '오류: 활성화된 탭이 없습니다.';
      return;
    }
    const tabId = tabs[0].id;

    // content_script를 주입하고, 실행 후, service_worker에게 결과를 전달하도록 지시
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content_script.js']
    }, () => {
      // Content Script가 주입된 후, Content Script에게 작업을 시작하라는 메시지를 보냄
      chrome.tabs.sendMessage(tabId, { action: "startBookmarkBackup" });
    });
  });
});
document.getElementById('backupLists').addEventListener('click', () => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = '백업 중...';

  // 현재 활성화된 탭에 메시지를 보낼 준비
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      statusElement.textContent = '오류: 활성화된 탭이 없습니다.';
      return;
    }
    const tabId = tabs[0].id;

    // content_script를 주입하고, 실행 후, service_worker에게 결과를 전달하도록 지시
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content_script.js']
    }, () => {
      // Content Script가 주입된 후, Content Script에게 작업을 시작하라는 메시지를 보냄
      chrome.tabs.sendMessage(tabId, { action: "startListBackup" });
    });
  });
});
document.getElementById('stopBookmarks').addEventListener('click', () => {
  const statusElement = document.getElementById('status');
  statusElement.textContent = '북마크 백업 중단 요청...';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      statusElement.textContent = '오류: 활성화된 탭이 없습니다.';
      return;
    }
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(tabId, { action: 'stopBookmarkBackup' });
  });
});
// Service Worker에서 온 응답 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "backupComplete") {
    document.getElementById('status').textContent = `백업 완료: ${message.count}명. 파일을 다운로드합니다.`;
  } else if (message.action === "backupError") {
    document.getElementById('status').textContent = `백업 오류: ${message.message}`;
  } else if (message.action === 'bookmarkBackupComplete') {
    document.getElementById('status').textContent = `북마크 백업 완료.`;
  } else if (message.action === 'listBackupComplete') {
    document.getElementById('status').textContent = `리스크 백업 완료.`;
  }
});