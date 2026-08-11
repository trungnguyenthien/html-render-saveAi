// State Management
const appState = {
  currentView: 'viewer', // 'viewer' | 'saved'
  currentFileName: null,
  messages: [], // Array of Message objects
  collapsedState: new Map(), // msgId -> boolean
  expandedUserState: new Map(), // msgId -> boolean
  renderCache: new Map() // msgId -> HTML string
};

// Global variables for speech synthesis
let voices = [];
let activeSpeakingSpan = null;
let currentUtterance = null;

// DOM Purify options for Markdown output sanitization
const purifyOptions = {
  ALLOWED_TAGS: [
    'span', 'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'div'
  ],
  ALLOWED_ATTR: ['class', 'data-lang', 'href', 'title', 'target', 'rel', 'tabindex', 'role', 'aria-label']
};

// Custom marked renderer for fenced code blocks
const renderer = new marked.Renderer();
renderer.code = function({ text, lang }) {
  const language = lang || 'plaintext';
  const escapedText = escapeHtml(text);
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang-label">${language}</span>
        <button class="btn-copy-code" aria-label="Copy code block">
          <span class="material-symbols-outlined">content_copy</span>
          <span>Copy</span>
        </button>
      </div>
      <pre><code class="language-${language}">${escapedText}</code></pre>
    </div>
  `;
};
marked.use({ renderer });

// Helpers
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseSpeakableTags(text) {
  if (!text) return '';
  const enRegex = /\[EN\](.*?)\[\/EN\]/gi;
  const vnRegex = /\[VN\](.*?)\[\/VN\]/gi;
  return text
    .replace(enRegex, (match, p1) => `<span class="speak speak-en" data-lang="en" tabindex="0" role="button" aria-label="Play English pronunciation: ${escapeHtml(p1)}">${p1}</span>`)
    .replace(vnRegex, (match, p1) => `<em class="vn-text">${p1}</em>`);
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split(' ');
    if (parts.length === 2) {
      const timeParts = parts[1].split(':');
      const dateParts = parts[0].split('-');
      return `${dateParts[2]}/${dateParts[1]} ${timeParts[0]}:${timeParts[1]}`;
    }
  } catch (e) {
    // Ignore and fallback
  }
  return dateStr;
}

function getRawMessageText(message) {
  if (!message.contents || !Array.isArray(message.contents)) return '';
  return message.contents
    .map(c => c.content || '')
    .join('\n');
}

function getFirstLinePreview(message) {
  const text = getRawMessageText(message);
  if (!text) return '';
  const lines = text.split('\n');
  let firstLine = '';
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }
  // Strip Markdown symbols for preview clarity
  let cleaned = firstLine
    .replace(/[#*`_\[\]]/g, '')
    .replace(/\[EN\].*?\[\/EN\]/gi, (match) => match.replace(/\[\/?EN\]/gi, ''))
    .replace(/\[VN\].*?\[\/VN\]/gi, (match) => match.replace(/\[\/?VN\]/gi, ''));
  return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
}

// Toast Notifications System
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'toast-btn';
  dismissBtn.textContent = 'OK';
  dismissBtn.addEventListener('click', () => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  });
  toast.appendChild(dismissBtn);

  container.appendChild(toast);

  // Auto remove toast after 4s
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove());
    }
  }, 4000);
}

// Programmatic Hash Navigation with View Transitions
function navigate(updateDOM, direction) {
  if (!document.startViewTransition) {
    updateDOM();
    return;
  }
  document.startViewTransition({
    update: updateDOM,
    types: [direction]
  });
}

function navigateTo(viewName) {
  if (appState.currentView === viewName) return;

  const direction = (viewName === 'saved') ? 'forward' : 'backward';

  navigate(() => {
    // Toggle active view panel
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    
    const activePanel = document.getElementById(`${viewName}-view`);
    if (activePanel) {
      activePanel.classList.add('active');
      
      // Accessibility: programmatically shift focus to heading inside active view
      const heading = activePanel.querySelector('.app-title');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
    
    appState.currentView = viewName;
  }, direction);
}

function handleHashChange() {
  const hash = window.location.hash;
  if (hash === '#/saved') {
    navigateTo('saved');
    renderSavedList();
  } else {
    // Default fallback to viewer view
    navigateTo('viewer');
  }
}

// Storage Helpers
function getStoredIndex() {
  try {
    const raw = localStorage.getItem('saveai:fileIndex');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setStoredIndex(index) {
  try {
    localStorage.setItem('saveai:fileIndex', JSON.stringify(index));
  } catch (e) {
    console.error('Failed to set file index', e);
  }
}

function updateRecentChips() {
  const recentChips = document.getElementById('recent-chips');
  const section = document.getElementById('recent-files-section');
  const index = getStoredIndex();
  
  if (index.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Fetch metadata and sort by lastOpenedAt descending
  const filesMeta = index.map(fileName => {
    try {
      const meta = localStorage.getItem(`saveai:meta:${fileName}`);
      return {
        name: fileName,
        ...(meta ? JSON.parse(meta) : { lastOpenedAt: 0, messageCount: 0 })
      };
    } catch (e) {
      return { name: fileName, lastOpenedAt: 0, messageCount: 0 };
    }
  }).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  recentChips.innerHTML = '';
  // Show top 5 recent files
  filesMeta.slice(0, 5).forEach(file => {
    const chip = document.createElement('button');
    chip.className = 'recent-chip';
    chip.setAttribute('aria-label', `Reopen ${file.name}`);
    
    const countText = file.messageCount === 1 ? '1 tin nhắn' : `${file.messageCount} tin nhắn`;
    chip.innerHTML = `
      <div class="recent-chip-info">
        <span class="recent-chip-name">${escapeHtml(file.name)}</span>
        <span class="recent-chip-meta">${countText}</span>
      </div>
      <span class="material-symbols-outlined recent-chip-arrow">arrow_forward</span>
    `;
    chip.addEventListener('click', () => {
      loadStoredFile(file.name);
    });
    recentChips.appendChild(chip);
  });

  section.style.display = 'block';
  
  // Also update saved history count badge in header
  const badge = document.getElementById('saved-badge');
  badge.textContent = index.length;
}

// Speech Synthesis Engines
function loadVoices() {
  if (window.speechSynthesis) {
    voices = window.speechSynthesis.getVoices();
  }
}

if (window.speechSynthesis) {
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

function getBestVoiceForLang(langCode) {
  const targetPrefix = langCode.substring(0, 2).toLowerCase(); // 'en'
  const filtered = voices.filter(v => {
    if (!v.lang) return false;
    const vLang = v.lang.replace('_', '-').toLowerCase();
    return vLang.startsWith(targetPrefix);
  });
  if (filtered.length === 0) return null;

  // Prioritize younger, warmer, and more natural sounding male voices
  // 'nathan' is macOS's warm natural male voice
  // 'evan' is macOS's younger natural male voice
  // Siri voices (Voice 1, Voice 3, Voice 4 are male Siri voices) are highly natural and young
  const priorityMaleNames = [
    'nathan',
    'evan',
    'siri',
    'aaron',
    'oliver',
    'daniel',
    'alex',
    'tom',
    'david'
  ];

  for (const nameKeyword of priorityMaleNames) {
    const matchedVoice = filtered.find(v => {
      const name = v.name.toLowerCase();
      // Ensure we don't accidentally pick a Siri female voice or other females
      const isFemale = name.includes('female') || name.includes('samantha') || name.includes('karen') || name.includes('moira') || name.includes('linh') || name.includes('fiona');
      return name.includes(nameKeyword) && !isFemale;
    });
    if (matchedVoice) return matchedVoice;
  }

  // General fallback for any voice containing male descriptors
  const generalMaleVoice = filtered.find(v => {
    const name = v.name.toLowerCase();
    return name.includes('male') || name.includes('masculine') || name.includes('guy');
  });

  return generalMaleVoice || filtered[0];
}

function toggleSpeak(span, lang) {
  if (!window.speechSynthesis) {
    showToast('Phát âm không được hỗ trợ trên thiết bị của bạn.', 'error');
    return;
  }

  // Double tap to toggle / stop speaking
  if (activeSpeakingSpan === span) {
    window.speechSynthesis.cancel();
    clearSpeakingState();
    return;
  }

  // Cancel any active speech
  if (activeSpeakingSpan) {
    window.speechSynthesis.cancel();
    clearSpeakingState();
  }

  // Dynamically refresh the voices list right before selecting a voice
  voices = window.speechSynthesis.getVoices();

  const textToSpeak = span.textContent.trim();
  if (!textToSpeak) return;

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  utterance.lang = (lang === 'en') ? 'en-US' : ((lang === 'vi') ? 'vi-VN' : lang);

  const voice = getBestVoiceForLang(utterance.lang);
  
  // Debug logs to troubleshoot speech synthesis issues
  console.log(`[TTS Debug] Request: "${textToSpeak}" (lang: ${utterance.lang})`);
  console.log(`[TTS Debug] Total available system voices: ${voices.length}`);
  console.log(`[TTS Debug] Matched voice:`, voice ? `${voice.name} (${voice.lang})` : 'None');

  if (voice) {
    utterance.voice = voice;
  } else {
    console.warn(`[TTS Warning] No native voice found matching: ${utterance.lang}`);
    if (utterance.lang.startsWith('vi')) {
      showToast('Thiết bị của bạn chưa cài đặt giọng đọc Tiếng Việt. Trình duyệt đang tự đọc bằng giọng US mặc định.', 'error');
    }
  }

  utterance.onend = () => {
    if (activeSpeakingSpan === span) {
      clearSpeakingState();
    }
  };

  utterance.onerror = (e) => {
    if (e.error !== 'interrupted') {
      showToast('Lỗi phát âm: ' + e.error, 'error');
    }
    if (activeSpeakingSpan === span) {
      clearSpeakingState();
    }
  };

  activeSpeakingSpan = span;
  currentUtterance = utterance;
  span.classList.add('speaking');
  span.setAttribute('aria-label', `Đang phát âm: ${textToSpeak}`);

  window.speechSynthesis.speak(utterance);
}

function clearSpeakingState() {
  if (activeSpeakingSpan) {
    activeSpeakingSpan.classList.remove('speaking');
    const text = activeSpeakingSpan.textContent.trim();
    const lang = activeSpeakingSpan.getAttribute('data-lang');
    const ariaLabel = lang === 'en' ? `Play English pronunciation: ${text}` : `Phát âm tiếng Việt: ${text}`;
    activeSpeakingSpan.setAttribute('aria-label', ariaLabel);
    activeSpeakingSpan = null;
  }
  currentUtterance = null;
}

// Copy Code Clipboard Handler
function copyCodeBlock(btn, codeElement) {
  const codeText = codeElement.textContent;

  function updateBtnSuccess() {
    const icon = btn.querySelector('.material-symbols-outlined');
    const textSpan = btn.querySelector('span:not(.material-symbols-outlined)');
    if (icon) icon.textContent = 'done';
    if (textSpan) textSpan.textContent = 'Copied!';
    btn.style.color = '#188038';

    setTimeout(() => {
      if (icon) icon.textContent = 'content_copy';
      if (textSpan) textSpan.textContent = 'Copy';
      btn.style.color = '';
    }, 1500);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(codeText)
      .then(() => {
        updateBtnSuccess();
        showToast('Đã sao chép mã nguồn!', 'success');
      })
      .catch((err) => {
        console.error('Clipboard write failed', err);
        fallbackCopy(codeText);
      });
  } else {
    fallbackCopy(codeText);
  }

  function fallbackCopy(text) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      updateBtnSuccess();
      showToast('Đã sao chép mã nguồn!', 'success');
    } catch (e) {
      showToast('Không thể sao chép mã nguồn.', 'error');
    }
  }
}

// JSON Parsing & Validation
function validateSaveAIExtract(data) {
  if (!Array.isArray(data)) return false;
  // Let's verify shape of first few elements
  for (let i = 0; i < Math.min(data.length, 5); i++) {
    const item = data[i];
    if (typeof item !== 'object' || item === null) return false;
    if (!('role' in item) || !('contents' in item)) return false;
    if (!Array.isArray(item.contents)) return false;
  }
  return true;
}

function processLoadedFile(fileName, rawJsonString) {
  let parsedData;
  try {
    parsedData = JSON.parse(rawJsonString);
  } catch (e) {
    showToast('File JSON không hợp lệ hoặc bị lỗi cú pháp.', 'error');
    return;
  }

  if (!validateSaveAIExtract(parsedData)) {
    showToast('Cấu trúc file JSON không tương thích với SaveAI.', 'error');
    return;
  }

  // Attempt to write to LocalStorage
  let storedSuccessfully = false;
  try {
    localStorage.setItem(`saveai:${fileName}`, rawJsonString);
    
    // Add to file index if not present
    const index = getStoredIndex();
    if (!index.includes(fileName)) {
      index.push(fileName);
      setStoredIndex(index);
    }

    // Extract first user preview
    const firstUserMsg = parsedData.find(m => m.role === 'user');
    let firstUserPreview = 'Không có tin nhắn người dùng';
    if (firstUserMsg) {
      const msgText = getRawMessageText(firstUserMsg);
      firstUserPreview = msgText.length > 100 ? msgText.substring(0, 100) + '...' : msgText;
    }

    // Write meta record
    const meta = {
      messageCount: parsedData.length,
      firstUserPreview: firstUserPreview,
      savedAt: Date.now(),
      lastOpenedAt: Date.now()
    };
    localStorage.setItem(`saveai:meta:${fileName}`, JSON.stringify(meta));
    storedSuccessfully = true;
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      showToast('Bộ nhớ lưu trữ trình duyệt đã đầy! File được tải tạm thời trong phiên.', 'error');
    } else {
      console.error('LocalStorage error', e);
    }
  }

  // Set memory state
  appState.currentFileName = fileName;
  appState.messages = parsedData;
  appState.collapsedState.clear();
  appState.expandedUserState.clear();
  appState.renderCache.clear();

  // Populate collapse defaults
  appState.messages.forEach(msg => {
    if (msg.role === 'assistant') {
      appState.collapsedState.set(msg.id, true);
    } else {
      appState.expandedUserState.set(msg.id, false);
    }
  });

  // Re-route to viewer if we were on saved view
  if (appState.currentView === 'saved') {
    window.location.hash = '#/viewer';
  }

  renderMessageList();
  updateRecentChips();
  
  if (storedSuccessfully) {
    showToast(`Đã tải file "${fileName}" thành công!`, 'success');
  }
}

// Reopen file
function loadStoredFile(fileName) {
  try {
    const raw = localStorage.getItem(`saveai:${fileName}`);
    if (!raw) {
      showToast('Không tìm thấy tệp tin được lưu trong trình duyệt.', 'error');
      // Clean index item
      const index = getStoredIndex();
      const newIndex = index.filter(x => x !== fileName);
      setStoredIndex(newIndex);
      updateRecentChips();
      return;
    }

    // Update lastOpenedAt in meta
    const metaRaw = localStorage.getItem(`saveai:meta:${fileName}`);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      meta.lastOpenedAt = Date.now();
      localStorage.setItem(`saveai:meta:${fileName}`, JSON.stringify(meta));
    }

    processLoadedFile(fileName, raw);
  } catch (e) {
    showToast('Lỗi khi mở file được lưu trữ.', 'error');
    console.error(e);
  }
}

// Reset current file
function resetCurrentFile() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    clearSpeakingState();
  }
  appState.currentFileName = null;
  appState.messages = [];
  appState.collapsedState.clear();
  appState.expandedUserState.clear();
  appState.renderCache.clear();

  renderMessageList();
  updateRecentChips();
}

// User Message Card Body Renderer
function renderUserCardBody(message, container) {
  const rawText = getRawMessageText(message);
  const isExpanded = appState.expandedUserState.get(message.id);

  if (rawText.length <= 100) {
    const processedText = parseSpeakableTags(rawText);
    const html = DOMPurify.sanitize(marked.parse(processedText), purifyOptions);
    container.innerHTML = `<div class="user-text-content">${html}</div>`;
    return;
  }

  if (isExpanded) {
    const processedText = parseSpeakableTags(rawText);
    const html = DOMPurify.sanitize(marked.parse(processedText), purifyOptions);
    container.innerHTML = `
      <div class="user-text-content">${html}</div>
      <button class="see-more-btn" data-action="toggle-user" data-id="${message.id}">See less</button>
    `;
  } else {
    const truncatedText = rawText.substring(0, 100) + '...';
    const safeText = escapeHtml(truncatedText);
    container.innerHTML = `
      <div class="user-text-content" style="white-space: pre-wrap;">${safeText}</div>
      <button class="see-more-btn" data-action="toggle-user" data-id="${message.id}">See more</button>
    `;
  }
}

// Assistant Collapse Card toggler
function toggleAssistantCollapse(messageId, cardElement) {
  const isCollapsed = cardElement.classList.contains('collapsed');
  const newCollapsedState = !isCollapsed;
  appState.collapsedState.set(messageId, newCollapsedState);

  if (newCollapsedState) {
    cardElement.classList.add('collapsed');
    cardElement.setAttribute('aria-expanded', 'false');
  } else {
    cardElement.classList.remove('collapsed');
    cardElement.setAttribute('aria-expanded', 'true');

    const bodyContainer = cardElement.querySelector('.card-body');
    if (!appState.renderCache.has(messageId)) {
      const message = appState.messages.find(m => m.id === messageId);
      const rawText = getRawMessageText(message);

      const processedText = parseSpeakableTags(rawText);
      const rawHtml = marked.parse(processedText);
      const cleanHtml = DOMPurify.sanitize(rawHtml, purifyOptions);

      bodyContainer.innerHTML = cleanHtml;

      // Apply highlighting
      bodyContainer.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
      });

      // Cache output
      appState.renderCache.set(messageId, bodyContainer.innerHTML);
    } else {
      bodyContainer.innerHTML = appState.renderCache.get(messageId);
    }
  }
}

// Viewer Message List Render
function renderMessageList() {
  const messageList = document.getElementById('message-list');
  const messageContainer = document.getElementById('message-container');
  const emptyState = document.getElementById('empty-state');
  const resetBtn = document.getElementById('btn-reset-file');
  const currentFilenameText = document.getElementById('current-filename');

  if (appState.messages.length === 0) {
    messageContainer.style.display = 'none';
    emptyState.style.display = 'flex';
    resetBtn.style.display = 'none';
    currentFilenameText.textContent = 'Chưa tải file';
    return;
  }

  emptyState.style.display = 'none';
  messageContainer.style.display = 'block';
  resetBtn.style.display = 'block';
  currentFilenameText.textContent = appState.currentFileName;

  messageList.innerHTML = '';
  
  let lastGroupId = null;

  appState.messages.forEach(msg => {
    // Optional Chat Group dividers
    if (msg.chatGroupId && msg.chatGroupId !== lastGroupId) {
      const divider = document.createElement('div');
      divider.className = 'chat-group-divider';
      
      const shortGroupId = msg.chatGroupId.substring(0, 8);
      divider.innerHTML = `<span class="chat-group-tag" title="Group ID: ${msg.chatGroupId}">Nhóm ${shortGroupId}</span>`;
      messageList.appendChild(divider);
      lastGroupId = msg.chatGroupId;
    }

    const card = document.createElement('article');
    card.className = `message-card ${msg.role}`;
    card.setAttribute('data-id', msg.id);

    const isCollapsed = msg.role === 'assistant' && appState.collapsedState.get(msg.id);
    if (isCollapsed) {
      card.classList.add('collapsed');
      card.setAttribute('aria-expanded', 'false');
    } else if (msg.role === 'assistant') {
      card.setAttribute('aria-expanded', 'true');
    }

    // Header layout
    const formattedDate = formatTime(msg.created_at);
    let headerHTML = '';

    if (msg.role === 'user') {
      headerHTML = `
        <div class="card-header">
          <div class="card-header-left">
            <span class="role-badge">Bạn</span>
            <span class="card-time">${formattedDate}</span>
          </div>
        </div>
      `;
    } else {
      const modelLabel = msg.displayModel || msg.model || 'AI Assistant';
      const previewText = getFirstLinePreview(msg);
      headerHTML = `
        <div class="card-header">
          <div class="card-header-left">
            <span class="role-badge" title="${msg.modelId || ''}">${escapeHtml(modelLabel)}</span>
            <span class="card-time">${formattedDate}</span>
          </div>
          <span class="card-header-preview">${escapeHtml(previewText)}</span>
          <span class="material-symbols-outlined card-chevron">expand_more</span>
        </div>
      `;
    }

    card.innerHTML = headerHTML;

    // Body Container layout
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'card-body';
    
    if (msg.role === 'user') {
      renderUserCardBody(msg, bodyContainer);
    } else {
      // If expanded initially, populate body
      if (!isCollapsed) {
        const rawText = getRawMessageText(msg);
        const processedText = parseSpeakableTags(rawText);
        const rawHtml = marked.parse(processedText);
        const cleanHtml = DOMPurify.sanitize(rawHtml, purifyOptions);
        bodyContainer.innerHTML = cleanHtml;
        bodyContainer.querySelectorAll('pre code').forEach(block => {
          hljs.highlightElement(block);
        });
        appState.renderCache.set(msg.id, bodyContainer.innerHTML);
      }
    }
    
    card.appendChild(bodyContainer);
    messageList.appendChild(card);
  });
}

// Saved Files view list Renderer
function renderSavedList() {
  const savedList = document.getElementById('saved-list');
  const savedEmptyState = document.getElementById('saved-empty-state');
  const index = getStoredIndex();

  if (index.length === 0) {
    savedList.innerHTML = '';
    savedEmptyState.style.display = 'flex';
    return;
  }

  savedEmptyState.style.display = 'none';
  savedList.innerHTML = '';

  const filesMeta = index.map(fileName => {
    try {
      const meta = localStorage.getItem(`saveai:meta:${fileName}`);
      return {
        name: fileName,
        ...(meta ? JSON.parse(meta) : { lastOpenedAt: 0, messageCount: 0, firstUserPreview: '' })
      };
    } catch (e) {
      return { name: fileName, lastOpenedAt: 0, messageCount: 0, firstUserPreview: '' };
    }
  }).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  filesMeta.forEach(file => {
    const card = document.createElement('div');
    card.className = 'saved-file-card';
    card.setAttribute('data-name', file.name);

    const dateStr = new Date(file.lastOpenedAt).toLocaleString('vi-VN', { 
      hour: '2-digit', 
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const countText = file.messageCount === 1 ? '1 tin nhắn' : `${file.messageCount} tin nhắn`;

    card.innerHTML = `
      <div class="saved-file-content">
        <div class="saved-file-header">
          <span class="saved-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="saved-file-count">${countText}</span>
        </div>
        <div class="saved-file-preview">${escapeHtml(file.firstUserPreview || 'Không có tin nhắn người dùng')}</div>
        <div class="saved-file-time">Mở lần cuối: ${dateStr}</div>
      </div>
      <div class="saved-file-actions">
        <button class="icon-button btn-delete-saved" aria-label="Xóa file ${escapeHtml(file.name)}" title="Xóa file">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    `;

    // Click handler for card
    card.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.btn-delete-saved');
      if (deleteBtn) {
        e.stopPropagation();
        showDeleteConfirm(file.name);
      } else {
        loadStoredFile(file.name);
      }
    });

    savedList.appendChild(card);
  });
}

// Delete saved file
const confirmDialog = document.getElementById('confirm-dialog');
let fileToDelete = null;

function showDeleteConfirm(fileName) {
  fileToDelete = fileName;
  confirmDialog.showModal();
}

confirmDialog.addEventListener('close', () => {
  if (confirmDialog.returnValue === 'confirm' && fileToDelete) {
    deleteSavedFile(fileToDelete);
  }
  fileToDelete = null;
});

function deleteSavedFile(fileName) {
  try {
    localStorage.removeItem(`saveai:${fileName}`);
    localStorage.removeItem(`saveai:meta:${fileName}`);
    
    const index = getStoredIndex();
    const newIndex = index.filter(x => x !== fileName);
    setStoredIndex(newIndex);

    showToast(`Đã xóa file "${fileName}"`, 'success');

    // If it was the open file, reset viewer
    if (appState.currentFileName === fileName) {
      resetCurrentFile();
    }

    renderSavedList();
    updateRecentChips();
  } catch (e) {
    showToast('Lỗi khi xóa file.', 'error');
    console.error(e);
  }
}

// Event Listeners setup
function setupEvents() {
  const fileInput = document.getElementById('file-input');
  const selectBtn = document.getElementById('btn-select-file');
  const selectBtnSaved = document.getElementById('btn-select-file-saved');
  const loadHeaderBtn = document.getElementById('btn-load-header');
  const fabBtn = document.getElementById('fab-load-file');
  const resetBtn = document.getElementById('btn-reset-file');
  const dropZone = document.getElementById('drop-zone');

  // Input picker triggers
  const triggerPicker = () => fileInput.click();
  if (selectBtn) selectBtn.addEventListener('click', triggerPicker);
  if (selectBtnSaved) selectBtnSaved.addEventListener('click', triggerPicker);
  if (loadHeaderBtn) loadHeaderBtn.addEventListener('click', triggerPicker);
  if (fabBtn) fabBtn.addEventListener('click', triggerPicker);

  // File Change trigger
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        processLoadedFile(file.name, event.target.result);
        fileInput.value = ''; // Reset file input so same file can be reloaded
      };
      reader.readAsText(file);
    }
  });

  // Drag and Drop
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type === "application/json" || file.name.endsWith('.json')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            processLoadedFile(file.name, event.target.result);
          };
          reader.readAsText(file);
        } else {
          showToast('Chỉ chấp nhận tệp tin JSON (.json)', 'error');
        }
      }
    });

    // Clicking dropzone clicks the picker too
    dropZone.addEventListener('click', (e) => {
      // Prevent double trigger if click hit the selectBtn inside it
      if (e.target !== selectBtn && !selectBtn.contains(e.target)) {
        triggerPicker();
      }
    });
  }

  // Reset/Clear button
  if (resetBtn) {
    resetBtn.addEventListener('click', resetCurrentFile);
  }

  // Delegated clicks inside messages listing (Copy code, speech spans, expansions)
  document.getElementById('message-list').addEventListener('click', (e) => {
    // Speakable spans play/stop
    const speakSpan = e.target.closest('.speak');
    if (speakSpan) {
      e.stopPropagation();
      const lang = speakSpan.getAttribute('data-lang');
      toggleSpeak(speakSpan, lang);
      return;
    }

    // Code copying
    const copyBtn = e.target.closest('.btn-copy-code');
    if (copyBtn) {
      e.stopPropagation();
      const codeBlock = copyBtn.closest('.code-block-wrapper').querySelector('code');
      copyCodeBlock(copyBtn, codeBlock);
      return;
    }

    // User message expand
    const seeMoreBtn = e.target.closest('.see-more-btn');
    if (seeMoreBtn) {
      e.stopPropagation();
      const msgId = seeMoreBtn.getAttribute('data-id');
      const isExpanded = appState.expandedUserState.get(msgId);
      appState.expandedUserState.set(msgId, !isExpanded);
      const cardBody = seeMoreBtn.closest('.card-body');
      const message = appState.messages.find(m => m.id === msgId);
      renderUserCardBody(message, cardBody);
      return;
    }

    // Assistant header click (expands card)
    const assistantHeader = e.target.closest('.message-card.assistant .card-header');
    if (assistantHeader) {
      e.stopPropagation();
      const card = assistantHeader.closest('.message-card.assistant');
      const msgId = card.getAttribute('data-id');
      toggleAssistantCollapse(msgId, card);
      return;
    }

    // Expand card if clicked anywhere on a collapsed card
    const assistantCardCollapsed = e.target.closest('.message-card.assistant.collapsed');
    if (assistantCardCollapsed) {
      e.stopPropagation();
      const msgId = assistantCardCollapsed.getAttribute('data-id');
      toggleAssistantCollapse(msgId, assistantCardCollapsed);
      return;
    }
  });

  // Global speech keyup handler for keyboard accessibility (Space/Enter to speak)
  document.getElementById('message-list').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      const speakSpan = e.target.closest('.speak');
      if (speakSpan) {
        e.preventDefault();
        speakSpan.click();
      }
    }
  });

  // Routing changes
  window.addEventListener('hashchange', handleHashChange);
}

// Auto Load last viewed file on startup
function autoRestoreLastOpened() {
  const index = getStoredIndex();
  if (index.length === 0) {
    updateRecentChips();
    return;
  }

  let newestFile = null;
  let newestTime = -1;

  index.forEach(fileName => {
    try {
      const metaRaw = localStorage.getItem(`saveai:meta:${fileName}`);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        if (meta.lastOpenedAt > newestTime) {
          newestTime = meta.lastOpenedAt;
          newestFile = fileName;
        }
      }
    } catch (e) {
      // Ignore corrupted entries
    }
  });

  if (newestFile) {
    loadStoredFile(newestFile);
  } else {
    updateRecentChips();
  }
}

// App Entry Point
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  handleHashChange(); // Run router on startup in case page loaded with specific hash
  autoRestoreLastOpened();
});
