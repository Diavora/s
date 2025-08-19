/* Clean, consolidated script.js replacement. Handles SPA navigation, theme, auth, catalog, selling flow. */

document.addEventListener('DOMContentLoaded', () => {
  /* -------------------- DOM -------------------- */
  const body = document.body;
  const navBtns = document.querySelectorAll('.nav-btn');
  const pages = document.querySelectorAll('.page');

  // Theme
  const themeToggle = document.getElementById('theme-toggle');

  // Auth modal
  const authOverlay = document.getElementById('auth-overlay');
  const authForm = document.getElementById('auth-form');
  const authError = document.getElementById('auth-error');
  const authSwitch = document.getElementById('switch-auth-btn');
  const authTitle = document.getElementById('auth-title');
  const confirmRow = document.getElementById('confirm-password-label');

  // Catalog
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContainer = document.getElementById('tab-content');
  const showAllBtn = document.getElementById('show-all-btn');
  const showLessBtn = document.getElementById('show-less-btn');
  const allItemsBlock = document.getElementById('all-items-content');
  const searchInput = document.getElementById('catalog-search');

  // Sell page
  const sellSelect = document.getElementById('sell-select');
  const sellSearch = document.getElementById('sell-search');
  const sellGameList = document.getElementById('sell-game-list');
  const sellFormWrap = document.getElementById('sell-form-wrapper');
  const sellForm = document.getElementById('sell-form');
  const chosenImg = document.getElementById('chosen-img');
  const chosenTitle = document.getElementById('chosen-title');
  const changeGameBtn = document.getElementById('change-game');
  const brServerField = document.getElementById('br-server-field');
  const brServerSelect = document.getElementById('br-server-select');
  // Photo uploader
  const sellPhotoInput = document.getElementById('sell-photo');
  const sellUploader = document.getElementById('sell-photo-uploader');
  const sellDrop = sellUploader ? sellUploader.querySelector('.uploader-drop') : null;
  const sellPreviewWrap = document.getElementById('sell-photo-preview-wrap');
  const sellPreviewImg = document.getElementById('sell-photo-preview');
  const sellPhotoClear = document.getElementById('sell-photo-clear');

  // Item modal DOM
  const itemModal = document.getElementById('item-modal');
  const itemImgEl = document.getElementById('item-modal-img');
  const itemNameEl = document.getElementById('item-modal-name');
  const itemDescEl = document.getElementById('item-modal-desc');
  const itemSellerEl = document.getElementById('item-modal-seller');
  const itemPriceEl = document.getElementById('item-modal-price');
  const itemBuyBtn = document.getElementById('item-buy');
  const itemCloseBtn = document.getElementById('item-close');
  const itemShareBtn = document.getElementById('item-share');
  const itemBackBtn = document.getElementById('item-back');
  const itemFavBtn = document.getElementById('item-fav');
  const shareTipEl = document.getElementById('share-tip');
  const favTipEl = document.getElementById('fav-tip');
  const howDealBtn = document.getElementById('item-how-deal');
  const problemBtn = document.getElementById('item-problem');
  const faqPanelDeal = document.getElementById('faq-panel-deal');
  const faqPanelProblem = document.getElementById('faq-panel-problem');
  // Deals
  const dealsList = document.getElementById('deals-list');
  // Deal modal & help
  const dealModal = document.getElementById('deal-modal');
  const dealModalBody = document.getElementById('deal-modal-body');
  const dealActions = document.getElementById('deal-actions');
  const dealCloseBtn = document.getElementById('deal-close');
  const dealsHelpBtn = document.getElementById('deals-help-btn');
  const dealHelp = document.getElementById('deal-help');
  const dealHelpClose = document.getElementById('deal-help-close');

  // Chats DOM
  const chatsPage = document.getElementById('chats');
  const dialogsRoot = document.getElementById('dialogs');
  const chatThread = document.getElementById('chat-thread');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-text');
  const chatSendBtn = chatForm ? chatForm.querySelector('button[type="submit"]') : null;
  const chatBackBtn = document.getElementById('chat-back');
  const chatPartnerName = document.getElementById('chat-partner-name');
  const chatPartnerAvatar = document.getElementById('chat-partner-avatar');
  const presenceDot = document.querySelector('.presence-dot');
  const presenceText = document.querySelector('.presence .presence-text');
  const typingIndicator = document.querySelector('.typing-indicator');
  const scrollBottomBtn = document.getElementById('chat-scroll-bottom');
  const chatEmojiBtn = document.getElementById('chat-emoji');
  const chatAttachBtn = document.getElementById('chat-attach');
  const chatsLayout = document.querySelector('.chats-layout');
  const chatsHelpOverlay = document.getElementById('chats-help');
  const chatsHelpBtn = document.getElementById('chats-help-btn');
  const chatsHelpClose = document.getElementById('chats-help-close');

  /* -------------------- STATE -------------------- */
  let isLight = localStorage.getItem('theme') === 'light';
  let registerMode = false;
  let intendedRoute = null;

  let fullGameLists = { pc: [], mobile: [], apps: [] };
  let allItems = [];
  let selectedGame = null;
  let currentItem = null;
  let currentDeal = null;
  let chats = [];
  let activeChatId = null;
  let activePartner = { name: 'Выберите диалог', avatar: '' };
  // Флаг, чтобы отличать нашу управляемую анимацию перехода по клику от переходов по истории/внешних изменений hash
  let navAnimating = false;
  // Флаг подавления следующего hashchange после программной смены хэша
  let ignoreNextHash = false;
  let chatPollTimer = null;
  const CHAT_POLL_MS = 4000;
  const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 минут — эвристика для "в сети"

  function stopChatPolling(){
    if (chatPollTimer){ clearInterval(chatPollTimer); chatPollTimer = null; }
  }
  function startChatPolling(id){
    stopChatPolling();
    if (!id) return;
    chatPollTimer = setInterval(() => {
      // если пользователь покинул страницу чатов, остановим опрос
      const chatsPageActive = document.getElementById('chats')?.classList.contains('active');
      if (!chatsPageActive) return stopChatPolling();
      loadChatMessages(id);
    }, CHAT_POLL_MS);
  }

  /* -------------------- UTIL -------------------- */
  const token = () => localStorage.getItem('token');
  // Favorites helpers
  const FAV_KEY = 'fav_items';
  const getFavs = () => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
  };
  const setFavs = (arr) => { try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch {} };
  const isFav = (id) => {
    if (!id) return false; const list = getFavs(); return list.includes(String(id)) || list.includes(Number(id));
  };
  const toggleFav = (id) => {
    if (!id) return false; const strId = String(id); const list = getFavs().map(String);
    const idx = list.indexOf(strId);
    if (idx >= 0) { list.splice(idx, 1); setFavs(list); return false; }
    list.push(strId); setFavs(list); return true;
  };
  const auth = () => !!token();
  const json = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // Inline tips helper
  let tipTimer;
  function showTip(el, text) {
    if (!el) return;
    if (typeof text === 'string') el.textContent = text;
    el.classList.add('visible');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => el.classList.remove('visible'), 1600);
  }

// Remove price artifacts appended by parsers in item titles
// Examples handled: "Название - 500 ₽", "Название (1 200 руб.)", "Название 1200 RUB"
function cleanTitle(s) {
  if (!s) return '';
  let t = String(s);
  // 0) Удалим ведущую "цену" в начале (цифры с разделителями, опционально с валютой), не трогая цену после тире
  // Примеры: "14 000 ₽Хороший...", "5999PUBG ...", "3 750 ₽ВНЕШКА ..."
  // Повторяем, если в начале остаётся ещё один числовой токен
  // Расширено: (?=\D|$) — чтобы сработало перед эмодзи/символами (пример: "000⚜️...")
  const leadingNum = /^\s*(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:k|к|тыс\.?)*\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)?(?=\D|$)/i;
  while (leadingNum.test(t)) {
    t = t.replace(leadingNum, ' ').trimStart();
  }
  // 1) Удалим цены в скобках в конце
  t = t.replace(/\s*[\(\[]?\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB|RUR)\s*[\)\]]?\s*$/i, '');
  // 2) Удалим хвосты вида "— 1 200 руб." в конце
  t = t.replace(/\s*[-–—]\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB|RUR)\s*$/i, '');
  // 3) Глобально удалим все отдельно стоящие ценовые токены в строке (начало/середина/конец)
  // Also match cases like "2000 ₽Аккаунт" (currency immediately followed by a letter without space)
  const priceToken = /(?:^|[\s\-–—\(\[])(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|[A-Za-zА-Яа-я])/gi;
  let prev;
  do { prev = t; t = t.replace(priceToken, (m, _p1) => ' '); } while (t !== prev);
  // 3b) Удалим одиночные символы валюты без цифр вокруг (шум типа "₽⚡️ ...")
  t = t.replace(/(?:^|[\s\-–—\(\[])(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|\D)/gi, ' ');
  // 4) Удалим возможные повторные разделители после вырезаний
  t = t.replace(/\s*[-–—,:;]+\s*$/g, '');
  t = t.replace(/^[-–—,:;]+\s*/g, '');
  // 5) Нормализуем пробелы
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}
  // Экранирование текста сообщений (во избежание XSS и ошибок рендера)
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // Короткое время для превью (HH:MM)
  function formatTimeShort(ts){
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); } catch { return ''; }
  }
  // Помощник фолбэка для изображений
  const AV_PLACEHOLDER_SM = 'https://via.placeholder.com/40x40.png?text=U';
  const AV_PLACEHOLDER_XS = 'https://via.placeholder.com/28x28.png?text=U';

  // Нормализация URL изображений: приводим путь к /uploads/... с прямыми слешами
  function normalizeImageUrl(u) {
    if (!u) return '';
    let s = String(u).trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')) return s;
    s = s.replace(/^\.?\/+/, '');       // убрать ./ и ведущие слеши
    s = s.replace(/^public\//i, '');     // убрать public/
    s = s.replace(/\\/g, '/');          // обратные слеши -> прямые
    if (/^uploads\//i.test(s)) s = s.replace(/^uploads/i, 'uploads'); // Uploads -> uploads
    return '/' + s;
  }

  // Presence helpers
  function formatLastSeen(ts){
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(); } catch { return ''; }
  }
  function setPresence(info){
    if (!presenceDot || !presenceText) return;
    if (!info){
      presenceDot.classList.remove('online');
      presenceText.textContent = '—';
      return;
    }
    const online = !!info.online;
    presenceDot.classList.toggle('online', online);
    presenceText.textContent = online ? 'в сети' : (info.lastSeen ? `был(а) ${formatLastSeen(info.lastSeen)}` : 'не в сети');
  }
  function setPresenceFromDialog(d){
    const info = { online: false, lastSeen: null };
    const now = Date.now();
    if (d && d.partner_last_seen) info.lastSeen = d.partner_last_seen;
    if (d && typeof d.partner_online === 'boolean') {
      info.online = d.partner_online;
    } else {
      // Эвристика: если есть last_seen — онлайн, если были в сети < ONLINE_WINDOW_MS назад
      if (info.lastSeen) {
        const ts = new Date(info.lastSeen).getTime();
        if (!Number.isNaN(ts)) info.online = (now - ts) < ONLINE_WINDOW_MS;
      } else if (d && d.last_time) {
        // fallback: если в диалоге было последнее событие совсем недавно — считаем онлайн
        const ts = new Date(d.last_time).getTime();
        if (!Number.isNaN(ts)) info.online = (now - ts) < ONLINE_WINDOW_MS;
      }
    }
    setPresence(info);
  }

  // Обновление presence на основе массива сообщений
  function setPresenceFromMessages(msgs){
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    // если сервер не поддерживает explicit partner_online, используем время последнего НЕ моего сообщения
    const now = Date.now();
    const other = [...msgs].reverse().find(m => !m.me && m.created_at);
    if (!other) return;
    const ts = new Date(other.created_at).getTime();
    if (Number.isNaN(ts)) return;
    const online = (now - ts) < ONLINE_WINDOW_MS;
    setPresence({ online, lastSeen: other.created_at });
  }
  // Инициализация: не показывать "в сети" до выбора диалога
  setPresence(null);

  /* -------------------- THEME -------------------- */
  const applyTheme = () => {
    body.classList.toggle('light-theme', isLight);
    if (themeToggle) themeToggle.innerHTML = isLight ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  };

  // Поднимаем реальный кружок иконки у кнопки (CSS-анимация .lifting)
  const liftIconFromButton = (btn) => {
    if (!btn) return Promise.resolve();
    const icon = btn.querySelector('i');
    if (!icon) return Promise.resolve();
    // На время подъёма скрываем закреплённый пузырёк, чтобы не мигал
    if (typeof stickyBubble !== 'undefined' && stickyBubble) {
      stickyBubble.style.opacity = '0';
    }
    // Цвет для круга-иконки во время подъёма
    btn.style.setProperty('--lift-bg', colorForBtn(btn));
    // Форсируем перезапуск CSS-анимации
    void icon.offsetWidth;
    btn.classList.add('lifting');
    return new Promise((resolve) => {
      const cleanup = () => {
        btn.classList.remove('lifting');
        if (stickyBubble) {
          stickyBubble.classList.add('reveal-up');
          stickyBubble.style.opacity = '1';
          stickyBubble.addEventListener('animationend', () => stickyBubble.classList.remove('reveal-up'), { once: true });
        }
        resolve();
      };
      icon.addEventListener('animationend', cleanup, { once: true });
    });
  };

  // Right-side FAQ buttons toggle right panels
  function togglePanel(which) {
    const isDeal = which === 'deal';
    const dealHidden = faqPanelDeal?.hidden ?? true;
    const probHidden = faqPanelProblem?.hidden ?? true;
    // Если кликаем по уже открытой панели — закрыть её
    if (isDeal && !dealHidden) {
      faqPanelDeal.hidden = true;
      howDealBtn?.classList.remove('active');
      return;
    }
    if (!isDeal && !probHidden) {
      faqPanelProblem.hidden = true;
      problemBtn?.classList.remove('active');
      return;
    }
    // Иначе открыть выбранную и закрыть другую
    if (faqPanelDeal) faqPanelDeal.hidden = !isDeal;
    if (faqPanelProblem) faqPanelProblem.hidden = isDeal;
    howDealBtn?.classList.toggle('active', isDeal);
    problemBtn?.classList.toggle('active', !isDeal);
  }

  // Универсальная помощь для раздела сделок (кнопка вопроса)
  function openHelp(){
    // Если есть отдельная панель/оверлей помощи для сделок — откроем её
    if (dealHelp) {
      dealHelp.classList.add('active');
      dealHelp.classList.remove('hidden');
      try { document.body.classList.add('modal-open'); } catch {}
      return;
    }
    // Фолбэк: короткая подсказка
    showToast('Нужна помощь по сделке? Откройте карточку сделки для деталей. При проблеме — используйте «Открыть спор» или напишите в чат.', 'success', 6000);
  }

  function closeHelp(){
    if (dealHelp) {
      dealHelp.classList.remove('active');
      dealHelp.classList.add('hidden');
      try { document.body.classList.remove('modal-open'); } catch {}
    }
  }

  howDealBtn?.addEventListener('click', () => togglePanel('deal'));
  problemBtn?.addEventListener('click', () => togglePanel('problem'));

  // Delegated fallback (in case buttons are re-rendered)
  document.addEventListener('click', (e) => {
    const d = e.target.closest('#item-how-deal');
    if (d) { e.preventDefault(); togglePanel('deal'); return; }
    const p = e.target.closest('#item-problem');
    if (p) { e.preventDefault(); togglePanel('problem'); }
  });

  // Deals help button bindings
  dealsHelpBtn?.addEventListener('click', (e) => { e.stopPropagation(); openHelp(); });
  dealHelpClose?.addEventListener('click', closeHelp);
  dealHelp?.addEventListener('click', (e) => { if (e.target === dealHelp) closeHelp(); });

  // --- Fancy nav bubble effect ---
  const ensureBubbleLayer = () => {
    const wrap = document.querySelector('.nav-wrap');
    if (!wrap) return null;
    let layer = wrap.querySelector('.nav-bubble-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'nav-bubble-layer';
      wrap.appendChild(layer);
    }
    return layer;
  };

  const randomPastel = () => {
    // Разные яркие/пастельные цвета
    const hue = Math.floor(Math.random() * 360);
    const sat = 70 + Math.floor(Math.random() * 20); // 70-90%
    const light = 55 + Math.floor(Math.random() * 15); // 55-70%
    return `hsl(${hue} ${sat}% ${light}%)`;
  };

  const colorForBtn = (btn) => {
    const t = (btn?.dataset?.target || '').replace('-page','');
    const map = {
      catalog: 'hsl(210 85% 55%)',   // синий
      sell: 'hsl(28 90% 55%)',       // оранжевый
      deals: 'hsl(150 65% 45%)',     // зелёный
      chats: 'hsl(330 75% 55%)',     // розовый/магента
      profile: 'hsl(268 70% 60%)'    // фиолетовый
    };
    return map[t] || randomPastel();
  };

  let stickyBubble = null;
  const positionStickyBubble = (btn, opts = {}) => {
    const { instant = false, prehide = false } = opts;
    const layer = ensureBubbleLayer();
    if (!layer || !btn) return;
    const wrap = document.querySelector('.nav-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const cx = btnRect.left + btnRect.width / 2 - wrapRect.left;
    const yOffset = -32; // выровнено с финальной позицией анимации circleToBubble
    const cy = btnRect.top + btnRect.height / 2 - wrapRect.top + yOffset;
    if (!stickyBubble) {
      // Создаём новый пузырёк и сразу задаём нужные стили ДО добавления в DOM
      stickyBubble = document.createElement('div');
      stickyBubble.className = 'nav-bubble sticky';
      if (instant) stickyBubble.classList.add('no-trans');
      if (prehide) stickyBubble.style.opacity = '0';
      stickyBubble.style.background = colorForBtn(btn);
      stickyBubble.style.left = `${cx}px`;
      stickyBubble.style.top = `${cy}px`;
      const icon = btn.querySelector('i');
      if (icon) stickyBubble.appendChild(icon.cloneNode(true));
      layer.appendChild(stickyBubble);
      // Если мы мгновенно позиционировали новый пузырёк — мягко вернём переходы на следующий кадр
      if (instant) {
        requestAnimationFrame(() => {
          // второй rAF гарантирует, что браузер применил новые координаты до снятия no-trans
          requestAnimationFrame(() => {
            stickyBubble.classList.remove('no-trans');
            if (!prehide) stickyBubble.style.opacity = '1';
          });
        });
      }
    } else {
      // Перемещаем существующий: сначала отключаем переходы/прячем (если требуется), затем меняем координаты
      if (instant) stickyBubble.classList.add('no-trans');
      if (prehide) stickyBubble.style.opacity = '0';
      // Обновить иконку
      const icon = btn.querySelector('i');
      stickyBubble.innerHTML = '';
      if (icon) stickyBubble.appendChild(icon.cloneNode(true));
      stickyBubble.style.background = colorForBtn(btn);
      if (prehide) stickyBubble.style.opacity = '0';
      stickyBubble.style.left = `${cx}px`;
      stickyBubble.style.top = `${cy}px`;
      if (instant) {
        // вернём переходы через двойной rAF, чтобы исключить "телепорт" и мерцание
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            stickyBubble.classList.remove('no-trans');
            if (!prehide) stickyBubble.style.opacity = '1';
          });
        });
      }
    }
  };

  const spawnNavBubble = (btn) => {
    const layer = ensureBubbleLayer();
    if (!layer || !btn) return;
    const wrap = document.querySelector('.nav-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    // координата центра кнопки относительно wrap
    const cx = btnRect.left + btnRect.width / 2 - wrapRect.left;
    const cy = btnRect.top + btnRect.height / 2 - wrapRect.top;

    const bubble = document.createElement('div');
    bubble.className = 'nav-bubble lift';
    bubble.style.background = colorForBtn(btn);
    bubble.style.setProperty('--x', `${cx}px`);
    bubble.style.setProperty('--y', `${cy}px`);
    const icon = btn.querySelector('i');
    if (icon) bubble.appendChild(icon.cloneNode(true));
    layer.appendChild(bubble);
    bubble.addEventListener('animationend', () => bubble.remove());
  };

  /* -------------------- DEAL MODAL -------------------- */
  const openDealModal = (deal) => {
    currentDeal = deal;
    if (!dealModal || !dealModalBody || !dealActions) return;
    // Header/info
    const statusMap = { pending: 'Ожидание', seller_confirmed: 'Подтверждено', completed: 'Завершена', dispute: 'Спор' };
    const roleLabel = deal.role === 'buyer' ? 'Покупатель' : 'Продавец';
    const imgSrc = normalizeImageUrl(deal.item_photo || '');
    const img = imgSrc ? `<img class="deal-thumb" src="${imgSrc}" alt="${deal.item_name || ''}" onerror="this.onerror=null;this.src='https://via.placeholder.com/120x90?text=IMG'">` : '';
    dealModalBody.innerHTML = `
      <div class="deal-modal-top">
        <div class="deal-modal-left">${img}</div>
        <div class="deal-modal-right">
          <div class="deal-modal-title">${deal.item_name || 'Товар'}</div>
          <div class="deal-modal-sub">
            <span class="price-badge small">${deal.price} ₽</span>
            <span class="deal-status ${deal.status}">${statusMap[deal.status] || deal.status}</span>
          </div>
          <div class="deal-modal-meta">
            <span class="role-chip ${deal.role}">${roleLabel}</span>
            <span class="deal-users">Продавец: ${deal.seller_nickname || deal.seller_id} · Покупатель: ${deal.buyer_nickname || deal.buyer_id}</span>
            <span class="deal-created">${new Date(deal.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>
    `;
    // Actions
    const actions = [];
    const addBtn = (id, text, cls='accent-btn small outline') => `<button id="${id}" class="${cls}">${text}</button>`;
    if (deal.status !== 'completed' && deal.status !== 'dispute') {
      if (deal.role === 'seller' && deal.status === 'pending') {
        actions.push(addBtn('act-seller-confirm', 'Подтвердить передачу'));
      }
      if (deal.role === 'buyer' && (deal.status === 'pending' || deal.status === 'seller_confirmed')) {
        actions.push(addBtn('act-buyer-complete', 'Завершить сделку', 'accent-btn small'));
      }
    }
    if (deal.status !== 'completed' && deal.status !== 'dispute') {
      actions.push(addBtn('act-dispute', 'Открыть спор', 'accent-btn small danger'));
    }
    dealActions.innerHTML = actions.length ? actions.join('') : '<div class="no-actions">Действия недоступны</div>';

    // Bind actions
    const safeFetch = async (url, opts) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' }, ...(opts||{}) });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data?.error || 'Ошибка запроса');
      return data;
    };
    document.getElementById('act-seller-confirm')?.addEventListener('click', async () => {
      try {
        await safeFetch(`/api/deals/${deal.id}/seller-confirm`);
        showToast('Передача подтверждена', 'success');
        emitSystemChatNotice('Продавец подтвердил передачу товара.');
        await loadDeals();
        closeDealModal();
      } catch(e){ showToast(e.message, 'error'); }
    });
    document.getElementById('act-buyer-complete')?.addEventListener('click', async () => {
      try {
        await safeFetch(`/api/deals/${deal.id}/buyer-complete`);
        showToast('Сделка завершена', 'success');
        emitSystemChatNotice('Сделка завершена. Средства зачислены на баланс.');
        await loadDeals();
        closeDealModal();
      } catch(e){ showToast(e.message, 'error'); }
    });
    document.getElementById('act-dispute')?.addEventListener('click', async () => {
      try {
        await safeFetch(`/api/deals/${deal.id}/dispute`);
        showToast('Открыт спор по сделке', 'success');
        emitSystemChatNotice('Покупатель открыл спор по сделке.');
        await loadDeals();
        closeDealModal();
      } catch(e){ showToast(e.message, 'error'); }
    });

    dealModal.classList.add('active');
    dealModal.classList.remove('hidden');
  };
  const closeDealModal = () => {
    dealModal?.classList.remove('active');
    setTimeout(() => dealModal?.classList.add('hidden'), 250);
    currentDeal = null;
  };
  dealCloseBtn?.addEventListener('click', closeDealModal);
  dealModal?.addEventListener('click', (e) => { if (e.target === dealModal) closeDealModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dealModal && !dealModal.classList.contains('hidden')) closeDealModal(); });

  applyTheme();
  themeToggle?.addEventListener('click', () => {
    isLight = !isLight;
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    applyTheme();
  });

/* -------------------- AUTH -------------------- */
// Элементы вкладок и полей паролей
const loginTab = document.getElementById('auth-tab-login');
const registerTab = document.getElementById('auth-tab-register');
const termsRow = document.getElementById('terms-row');
const termsCheckbox = document.getElementById('terms');
const pass1 = document.getElementById('auth-password');
const pass2 = document.getElementById('auth-password-2');
const passToggle1 = document.getElementById('auth-pass-toggle');
const passToggle2 = document.getElementById('auth-pass2-toggle');
const authSubmitBtn = document.getElementById('auth-submit');

const showAuth = (reg = false) => {
  registerMode = reg;
  authTitle.textContent = reg ? 'Регистрация' : 'Вход';
  confirmRow.classList.toggle('hidden', !reg);
  confirmRow.classList.toggle('visible', reg);
  termsRow?.classList.toggle('hidden', !reg);
  loginTab?.classList.toggle('active', !reg);
  registerTab?.classList.toggle('active', reg);
  if (authSubmitBtn) authSubmitBtn.textContent = reg ? 'Зарегистрироваться' : 'Войти';
  if (authSwitch) authSwitch.textContent = reg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  authError.textContent = '';
  if (pass1) { pass1.type = 'password'; pass1.value = ''; pass1.setAttribute('autocomplete', reg ? 'new-password' : 'current-password'); }
  if (pass2) { pass2.type = 'password'; pass2.value = ''; pass2.setAttribute('autocomplete', 'new-password'); }
  const resetEye = (btn) => { const i = btn?.querySelector('i'); if (i){ i.classList.remove('fa-eye-slash'); i.classList.add('fa-eye'); } };
  resetEye(passToggle1); resetEye(passToggle2);
  try { authForm?.querySelector('input[name="nickname"]').focus(); } catch {}
  authOverlay.classList.add('active');
  authOverlay.classList.remove('hidden');
  try { document.body.classList.add('modal-open'); } catch {}
};

const hideAuth = () => {
  authOverlay.classList.remove('active');
  authOverlay.classList.add('hidden');
  try { document.body.classList.remove('modal-open'); } catch {}
};

// Переключатель под формой
authSwitch?.addEventListener('click', () => showAuth(!registerMode));
// Вкладки
loginTab?.addEventListener('click', () => showAuth(false));
registerTab?.addEventListener('click', () => showAuth(true));
// Клик по оверлею закрывает модалку
authOverlay?.addEventListener('click', (e) => { if (e.target === authOverlay) hideAuth(); });
// Переключатели показа пароля
function bindPassToggle(btn, input){
  if (!btn || !input) return;
  btn.addEventListener('click', () => {
    const toText = input.getAttribute('type') === 'password';
    input.setAttribute('type', toText ? 'text' : 'password');
    const icon = btn.querySelector('i');
    if (icon){
      icon.classList.toggle('fa-eye', !toText);
      icon.classList.toggle('fa-eye-slash', toText);
    }
  });
}
bindPassToggle(passToggle1, pass1);
bindPassToggle(passToggle2, pass2);

// Сабмит формы авторизации/регистрации
authForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const fd = new FormData(authForm);
  const data = Object.fromEntries(fd.entries());
  if (registerMode) {
    if (termsCheckbox && !termsCheckbox.checked) return authError.textContent = 'Подтвердите правила сервиса';
    if (data.password !== data.confirm_password) return authError.textContent = 'Пароли не совпадают';
    if ((data.password || '').length < 6) return authError.textContent = 'Мин. 6 символов';
  }
  const ep = registerMode ? '/api/register' : '/api/login';
  try {
    const r = await fetch(ep, { method: 'POST', ...json(data) });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || 'Ошибка');
    localStorage.setItem('token', res.token);
    hideAuth();
    if (intendedRoute) {
      const target = intendedRoute;
      intendedRoute = null;
      const currentHash = (window.location.hash || '').replace('#','');
      if (currentHash === target) {
        navigate(target);
      } else {
        window.location.hash = target;
      }
    }
  } catch (err) { authError.textContent = err.message; }
});

// --------- Downloads: APK & PWA ---------
const dlApkBtn = document.querySelector('.auth-aside .store-btn.android');
const dlPwaBtn = document.querySelector('.auth-aside .store-btn.pwa');
// APK URL можно задать глобально: window.APP_APK_URL = 'https://.../xpdrop.apk'
const APK_URL = (typeof window !== 'undefined' && window.APP_APK_URL) ? window.APP_APK_URL : '';

// APK download handler
dlApkBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  if (APK_URL) {
    window.open(APK_URL, '_blank', 'noopener');
  } else {
    showToast('APK скоро будет доступен. Свяжитесь с поддержкой для раннего доступа.', 'error');
  }
});

// PWA install handler via beforeinstallprompt
let deferredPrompt = null;
// Изначально кнопку можно сделать неактивной до события
if (dlPwaBtn) dlPwaBtn.classList.toggle('disabled', true);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Разблокируем кнопку PWA
  if (dlPwaBtn) dlPwaBtn.classList.remove('disabled');
});
window.addEventListener('appinstalled', () => {
  showToast('Приложение установлено как PWA', 'success');
  deferredPrompt = null;
});
dlPwaBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  // Если уже установлено (например, отображается в standalone), предложим инструкцию/сообщение
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) return showToast('PWA уже установлено', 'success');
  if (!deferredPrompt) {
    // iOS или десктопы без поддержки: показать подсказку
    return showToast('Установка PWA недоступна. Используйте меню браузера: «Добавить на главный экран».', 'error');
  }
  try {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      showToast('Установка PWA запущена', 'success');
    } else {
      showToast('Установка отменена', 'error');
    }
  } finally {
    deferredPrompt = null;
    // Можно снова заблокировать кнопку до нового события
    if (dlPwaBtn) dlPwaBtn.classList.add('disabled');
  }
});

  /* -------------------- NAV -------------------- */
const navChatsBadge = document.getElementById('nav-chats-badge');
function updateChatsBadge(count){
  if (!navChatsBadge) return;
  const c = Math.max(0, parseInt(count || 0, 10) || 0);
  navChatsBadge.dataset.count = String(c);
  navChatsBadge.textContent = c > 99 ? '99+' : String(c);
  navChatsBadge.classList.toggle('hidden', c === 0);
}

// Пометить диалог прочитанным локально и обновить бейджи
function markDialogRead(chatId, cardEl){
  try {
    // Обновим локальные данные
    if (Array.isArray(chats)){
      const idx = chats.findIndex(x => String(x.id) === String(chatId));
      if (idx !== -1) chats[idx].unread_count = 0;
      const total = chats.reduce((s, d) => s + (d.unread_count || 0), 0);
      updateChatsBadge(total);
    }
    // Уберём бейдж у карточки, если передан элемент
    if (cardEl){
      cardEl.querySelector('.badge.unread')?.remove();
    }
  } catch {}
}
  const getTargetFromHash = () => {
    const h = (window.location.hash || '').replace('#','').trim();
    if (!h) return 'catalog';
    if (h === 'catalog-page') return 'catalog';
    // Спец: страница товаров игры с id в hash
    if (/^game-items-page(:\d+)?$/.test(h)) return 'game-items-page';
    return h;
  };
  const navigate = (id) => {
    const targetId = id === 'catalog-page' ? 'catalog' : id;
    // Map subpages to their bottom-nav parent for active highlight
    const navTargetFor = (tid) => {
      if (tid === 'catalog' || tid === 'game-items-page') return 'catalog-page';
      return tid;
    };

    // Handle protected routes
    const protectedPages = ['sell', 'profile', 'deals', 'chats'];
    if (protectedPages.includes(targetId) && !auth()) {
      intendedRoute = targetId;
      return showAuth();
    }

    if (targetId === 'profile') {
      return window.location.href = 'profile.html';
    }

    // Остановим опрос чата, если уходим со страницы чатов
    if (targetId !== 'chats') stopChatPolling();
    pages.forEach(p => p.classList.toggle('active', p.id === targetId));
    const navActive = navTargetFor(targetId);
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.target === navActive));

    if (targetId === 'deals') loadDeals();
    if (targetId === 'chats') loadChats();
    if (targetId === 'game-items-page') {
      const h = (window.location.hash || '').replace('#','').trim();
      const m = h.match(/^game-items-page:(\d+)/);
      if (m && m[1]) {
        showItemsForGame(m[1]);
      } else if (h === 'game-items-page') {
        window.location.hash = 'catalog';
      }
    }
  };

  navBtns.forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const target = b.dataset.target;
    if (!target) return;
    // Глобально: если пользователь не авторизован — открываем авторизацию для любого таргета
    if (!auth()) {
      // сопоставим catalog-page -> catalog, чтобы после логина открылась корректная страница
      const intended = (target === 'catalog-page') ? 'catalog' : target;
      intendedRoute = intended;
      showAuth();
      return;
    }
    // Если уже активна — не перезапускаем анимации
    const isAlreadyActive = b.classList.contains('active');
    // Спец-логика для профиля: уважаем авторизацию
    if (target === 'profile') {
      // Переходим на отдельную страницу профиля
      if (!isAlreadyActive) navBtns.forEach(x => x.classList.toggle('active', x === b));
      window.location.href = 'profile.html';
      return;
    }

    // Обычные вкладки: моментальный переход без ожидания hashchange
    if (isAlreadyActive) return;
    navBtns.forEach(x => x.classList.toggle('active', x === b));
    // Немедленно отрисуем нужную страницу
    navigate(target);
    // Обновим хэш, подавив обработчик hashchange, чтобы избежать двойной отрисовки
    ignoreNextHash = true;
    window.location.hash = target;
    return;
  }));

  // Первичная навигация по hash (например, из profile.html приходим с #deals)
  navigate(getTargetFromHash());
  window.addEventListener('hashchange', () => {
    if (ignoreNextHash) { ignoreNextHash = false; return; }
    navigate(getTargetFromHash());
  });
  // Упрощённая версия без спец-обработки resize/sticky

  /* -------------------- CHATS -------------------- */
  function setChatEnabled(enabled){
    if (chatInput) chatInput.disabled = !enabled;
    if (chatSendBtn) chatSendBtn.disabled = !enabled;
    if (chatForm) chatForm.classList.toggle('disabled', !enabled);
  }
  // По умолчанию запретим писать, пока не выбран диалог
  setChatEnabled(false);
  function openChatsHelp(){
    if (!chatsHelpOverlay) return;
    chatsHelpOverlay.classList.add('active');
    chatsHelpOverlay.classList.remove('hidden');
  }
  function closeChatsHelp(){
    if (!chatsHelpOverlay) return;
    chatsHelpOverlay.classList.remove('active');
    setTimeout(() => chatsHelpOverlay.classList.add('hidden'), 250);
  }
  chatsHelpBtn?.addEventListener('click', openChatsHelp);
  chatsHelpClose?.addEventListener('click', closeChatsHelp);
  chatsHelpOverlay?.addEventListener('click', (e) => { if (e.target === chatsHelpOverlay) closeChatsHelp(); });

  // Scroll helpers for chat thread
  function isAtBottom(){
    if (!chatThread) return true;
    const delta = chatThread.scrollHeight - chatThread.scrollTop - chatThread.clientHeight;
    return delta < 4;
  }
  function updateScrollBtn(){
    if (!scrollBottomBtn) return;
    scrollBottomBtn.classList.toggle('visible', !isAtBottom());
  }
  chatThread?.addEventListener('scroll', updateScrollBtn);
  scrollBottomBtn?.addEventListener('click', () => { if (chatThread) chatThread.scrollTop = chatThread.scrollHeight; updateScrollBtn(); });

  // ---------- Emoji Picker (минимальный поповер) ----------
  let emojiPopover = null;
  const EMOJIS = ['😀','😁','😂','😊','😍','😘','😎','🤔','👍','👏','🙏','🔥','🎉','💎','💬','📷'];
  function openEmojiPopover(){
    if (!chatEmojiBtn || !chatForm) return;
    if (!emojiPopover){
      emojiPopover = document.createElement('div');
      emojiPopover.id = 'emoji-popover';
      emojiPopover.style.position = 'absolute';
      emojiPopover.style.bottom = '56px';
      emojiPopover.style.left = '12px';
      emojiPopover.style.background = 'rgba(0,0,0,0.85)';
      emojiPopover.style.border = '1px solid rgba(255,255,255,0.12)';
      emojiPopover.style.borderRadius = '10px';
      emojiPopover.style.padding = '6px';
      emojiPopover.style.display = 'grid';
      emojiPopover.style.gridTemplateColumns = 'repeat(8, 1fr)';
      emojiPopover.style.gap = '4px';
      emojiPopover.style.zIndex = '1000';
      EMOJIS.forEach(e => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e;
        b.style.fontSize = '18px';
        b.style.padding = '4px';
        b.style.background = 'transparent';
        b.style.border = 'none';
        b.style.cursor = 'pointer';
        b.addEventListener('click', () => { insertAtCaret(chatInput, e + ' '); closeEmojiPopover(); chatInput?.focus(); });
        emojiPopover.appendChild(b);
      });
      chatForm.appendChild(emojiPopover);
      document.addEventListener('click', outsideEmoji, { capture: true });
    } else {
      emojiPopover.style.display = 'grid';
    }
  }
  function closeEmojiPopover(){ if (emojiPopover) emojiPopover.style.display = 'none'; }
  function outsideEmoji(e){
    if (!emojiPopover) return;
    if (emojiPopover.contains(e.target) || chatEmojiBtn.contains(e.target)) return;
    closeEmojiPopover();
  }
  function insertAtCaret(input, text){
    if (!input) return;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const val = input.value;
    input.value = val.slice(0, start) + text + val.slice(end);
    const pos = start + text.length;
    input.setSelectionRange(pos, pos);
  }
  chatEmojiBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (!activeChatId) return showToast('Выберите диалог', 'error'); openEmojiPopover(); });

  // ---------- Attach photo ----------
  let hiddenFileInput = null;
  function ensureHiddenFile(){
    if (hiddenFileInput) return hiddenFileInput;
    hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = 'image/*';
    hiddenFileInput.style.display = 'none';
    document.body.appendChild(hiddenFileInput);
    hiddenFileInput.addEventListener('change', async () => {
      if (!activeChatId) { hiddenFileInput.value = ''; return showToast('Выберите диалог', 'error'); }
      const file = hiddenFileInput.files && hiddenFileInput.files[0];
      if (!file) return;
      if (file.size > 7 * 1024 * 1024) { // 7MB ограничение
        hiddenFileInput.value = '';
        return showToast('Слишком большой файл (макс 7 МБ)', 'error');
      }
      const fd = new FormData();
      fd.append('image', file);
      const text = (chatInput?.value || '').trim();
      if (text) fd.append('text', text);
      try {
        const r = await fetch(`/api/chats/${activeChatId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token() },
          body: fd
        });
        const data = await r.json().catch(()=>null);
        if (!r.ok) throw new Error(data?.error || 'Не удалось отправить изображение');
        if (chatInput) chatInput.value = '';
        await loadChatMessages(activeChatId);
      } catch(err){
        showToast(err.message || 'Ошибка при загрузке изображения', 'error');
      } finally { hiddenFileInput.value = ''; }
    });
    return hiddenFileInput;
  }
  chatAttachBtn?.addEventListener('click', () => {
    if (!activeChatId) return showToast('Выберите диалог', 'error');
    ensureHiddenFile().click();
  });

  function renderDialogs(list){
    if (!dialogsRoot) return;
    if (!Array.isArray(list) || list.length === 0){
      dialogsRoot.innerHTML = '<div class="empty">Пока нет диалогов</div>';
      updateChatsBadge(0);
      return;
    }
    dialogsRoot.innerHTML = list.map(d => {
      const isActive = String(d.id) === String(activeChatId);
      const name = d.partner_nickname || 'Пользователь';
      const subtitle = d.item_name || '';
      const lastText = d.last_message ? escapeHtml(d.last_message) : '';
      const time = d.last_time ? formatTimeShort(d.last_time) : '';
      const unread = d.unread_count || 0;
      const badge = unread > 0 ? `<span class="badge unread">${unread > 99 ? '99+' : unread}</span>` : '';
      const timeHtml = time ? `<span class="time">${time}</span>` : '';
      const previewHtml = lastText ? `<div class="preview">${lastText}</div>` : '';
      const av = d.partner_avatar || AV_PLACEHOLDER_SM;
      return `
        <div class="dialog-item ${isActive ? 'active' : ''}" data-id="${d.id}">
          <img class="avatar sm" src="${av}" alt="" onerror="this.onerror=null;this.src='${AV_PLACEHOLDER_SM}'" />
          <div class="dialog-texts">
            <div class="row-top">
              <div class="dialog-title">${name}</div>
              <div class="meta">${timeHtml}${badge}</div>
            </div>
            <div class="row-bottom">
              <div class="dialog-sub">${subtitle}</div>
              ${previewHtml}
            </div>
          </div>
        </div>`;
    }).join('');
    dialogsRoot.querySelectorAll('.dialog-item').forEach(el => {
      el.addEventListener('click', async () => {
        activeChatId = el.getAttribute('data-id');
        setChatEnabled(true);
        // Обновить шапку чата
        const d = list.find(x => String(x.id) === String(activeChatId));
        activePartner = {
          name: (d && (d.partner_nickname || 'Пользователь')) || 'Диалог',
          avatar: (d && d.partner_avatar) || ''
        };
        if (chatPartnerName) chatPartnerName.textContent = activePartner.name;
        if (chatPartnerAvatar) {
          chatPartnerAvatar.src = activePartner.avatar || AV_PLACEHOLDER_SM;
          chatPartnerAvatar.onerror = function(){ this.onerror=null; this.src = AV_PLACEHOLDER_SM; };
        }
        // По умолчанию не показываем "в сети" — только по данным
        setPresenceFromDialog(d);
        // Мгновенно пометим диалог прочитанным (локально) и обновим бейджи
        markDialogRead(d.id, el);
        if (chatsLayout) chatsLayout.classList.add('chat-open');
        await loadChatMessages(activeChatId);
        startChatPolling(activeChatId);
      });
    });
    // Обновим бейдж непрочитанных на вкладке Чаты
    try {
      const totalUnread = list.reduce((sum, d) => sum + (d.unread_count || 0), 0);
      updateChatsBadge(totalUnread);
    } catch {}
    // если чат был активен ранее — восстановим опрос
    if (activeChatId) startChatPolling(activeChatId);
  }

  // Кнопка Назад: вернуться к списку
  if (chatBackBtn) {
    chatBackBtn.addEventListener('click', () => {
      activeChatId = null;
      stopChatPolling();
      setChatEnabled(false);
      if (chatPartnerName) chatPartnerName.textContent = 'Выберите диалог';
      if (chatPartnerAvatar) chatPartnerAvatar.src = 'https://via.placeholder.com/40x40.png?text=U';
      if (chatThread) chatThread.innerHTML = '<div class="sys-msg">Выберите диалог слева, чтобы начать общение.</div>';
      setPresence(null);
      if (chatsLayout) chatsLayout.classList.remove('chat-open');
      renderDialogs(chats);
    });
  }

  function renderMessages(msgs){
    if (!chatThread) return;
    if (!Array.isArray(msgs) || msgs.length === 0){
      chatThread.innerHTML = '<div class="sys-msg">Нет сообщений. Напишите что-нибудь…</div>';
      chatThread.scrollTop = chatThread.scrollHeight;
      updateScrollBtn();
      return;
    }
    let lastDate = '';
    const parts = [];
    for (const m of msgs){
      const date = m.created_at ? new Date(m.created_at) : null;
      const dayKey = date ? date.toDateString() : '';
      const time = date ? date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      if (dayKey && dayKey !== lastDate){
        lastDate = dayKey;
        const dLabel = date.toLocaleDateString([], { day:'2-digit', month:'2-digit', year:'numeric' });
        parts.push(`<div class="day-sep"><span>${dLabel}</span></div>`);
      }
      if (m.type === 'system') {
        parts.push(`<div class="sys-msg">${escapeHtml(m.text)}</div>`);
        continue;
      }
      if (m.me) {
        const imgHtml = m.image_url ? `<div class="media"><img class="msg-image" src="${m.image_url}" alt="" loading="lazy" /></div>` : '';
        const textHtml = m.text ? `<div class="text">${escapeHtml(m.text)}</div>` : '';
        parts.push(`
          <div class="msg me">
            <div class="bubble">
              ${imgHtml}
              ${textHtml}
              ${time ? `<div class="meta"><span class="time">${time}</span><span class="ticks"><i class="fa-solid fa-check"></i><i class="fa-solid fa-check"></i></span></div>` : ''}
            </div>
          </div>`);
        continue;
      }
      const av = (activePartner?.avatar || AV_PLACEHOLDER_XS);
      const imgHtml2 = m.image_url ? `<div class="media"><img class="msg-image" src="${m.image_url}" alt="" loading="lazy" /></div>` : '';
      const textHtml2 = m.text ? `<div class="text">${escapeHtml(m.text)}</div>` : '';
      parts.push(`
        <div class="msg">
          <img class="avatar xs" src="${av}" alt="" onerror="this.onerror=null;this.src='${AV_PLACEHOLDER_XS}'" />
          <div class="bubble">
            ${imgHtml2}
            ${textHtml2}
            ${time ? `<div class="meta"><span class="time">${time}</span></div>` : ''}
          </div>
        </div>`);
    }
    chatThread.innerHTML = parts.join('');
    // автоскролл вниз
    chatThread.scrollTop = chatThread.scrollHeight;
    updateScrollBtn();
  }

  async function loadChats(){
    if (!dialogsRoot) return;
    if (!auth()) { dialogsRoot.innerHTML = 'Войдите, чтобы видеть чаты'; return; }
    try {
      const r = await fetch('/api/chats', { headers: { 'Authorization': 'Bearer ' + token() } });
      const data = await r.json().catch(()=>[]);
      if (!r.ok) throw new Error(data?.error || 'Не удалось загрузить чаты');
      chats = data;
      renderDialogs(chats);
      if (activeChatId) { await loadChatMessages(activeChatId); startChatPolling(activeChatId); }
    } catch(e){
      console.error(e);
      dialogsRoot.innerHTML = `<span class="error-msg">${e.message}</span>`;
    }
  }

  async function loadChatMessages(id){
    if (!chatThread || !id) return;
    try {
      const r = await fetch(`/api/chats/${id}/messages`, { headers: { 'Authorization': 'Bearer ' + token() } });
      const data = await r.json().catch(()=>[]);
      if (!r.ok) throw new Error(data?.error || 'Не удалось загрузить сообщения');
      renderMessages(data);
      // После обновления ленты — подправим presence по последним сообщениям (если нет явного флага)
      setPresenceFromMessages(data);
      // Если чат открыт — сбросим непрочитанные локально и обновим бейджи
      if (String(activeChatId) === String(id)) markDialogRead(id);
    } catch(e){
      console.error(e);
      chatThread.innerHTML = `<span class="error-msg">${e.message}</span>`;
    }
  }

  chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChatId) return showToast('Выберите диалог', 'error');
    const text = (chatInput?.value || '').trim();
    if (!text) return;
    const payload = { text };
    try {
      const r = await fetch(`/api/chats/${activeChatId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await r.json().catch(()=>null);
      if (!r.ok) throw new Error(data?.error || 'Не удалось отправить');
      chatInput.value = '';
      await loadChatMessages(activeChatId);
    } catch(e){ showToast(e.message, 'error'); }
  });

  // Локальный помощник: добавить системное сообщение в текущий открытный чат (если он связан с сделкой)
  function emitSystemChatNotice(text){
    if (!chatThread || !Array.isArray(chats)) return;
    // Если открыт чат — просто дорисуем локально (бэкенд может добавить своё уведомление отдельно)
    if (activeChatId) {
      const existing = chatThread.innerHTML;
      chatThread.innerHTML = existing + `<div class="sys-msg">${text}</div>`;
      chatThread.scrollTop = chatThread.scrollHeight;
    }
  }

  /* -------------------- CATALOG -------------------- */
  const gameCard = (g) => {
    const bannerHtml = g.banner_url
      ? `<img src="${normalizeImageUrl(g.banner_url)}" alt="${g.name}" class="game-banner" onerror="this.onerror=null;this.src='https://via.placeholder.com/600x150?text=Banner'">`
      : '<div class="game-banner-placeholder"></div>';

    return `
      <div class="game-card" data-id="${g.id}" data-name="${g.name}">
        ${bannerHtml}
        <div class="card-body">
          <h5 class="card-title">${g.name}</h5>
        </div>
      </div>
    `;
  };
  const itemCard = (i) => `
  <div class="shop-item" data-id="${i.id || ''}" data-seller="${i.seller_nickname || i.seller_id || ''}">
    <div class="thumb-wrap">
      <img class="thumb" src="${normalizeImageUrl(i.image_url) || 'https://via.placeholder.com/300x200?text=Item'}" alt="${i.title}" onerror="this.onerror=null;this.src='https://via.placeholder.com/300x200?text=IMG'">
      <span class="badge-price">${i.price} ₽</span>
    </div>
    <div class="meta">
      <h4 class="title">${cleanTitle(i.title)}</h4>
      ${i.seller_nickname ? `<span class="seller">${i.seller_nickname}</span>` : ''}
      ${i.server ? `<div class="extra">Сервер: ${escapeHtml(i.server)}</div>` : ''}
    </div>
  </div>`;

  // Item modal logic
  const openItemModal = (item) => {
    currentItem = item;
    if (itemImgEl) {
      itemImgEl.onerror = () => { itemImgEl.onerror = null; itemImgEl.src = 'https://via.placeholder.com/600x360?text=IMG'; };
      itemImgEl.src = normalizeImageUrl(item.image_url) || 'https://via.placeholder.com/600x360?text=IMG';
    }
    if (itemNameEl) itemNameEl.textContent = cleanTitle(item.title || 'Товар');
    if (itemDescEl) {
      const baseDesc = item.description || item.desc || 'Нет подробного описания. Задайте вопрос продавцу — он ответит быстрее всего.';
      itemDescEl.textContent = baseDesc + (item.server ? `\nСервер: ${item.server}` : '');
    }
    if (itemSellerEl) itemSellerEl.textContent = item.seller_nickname ? `Продавец: ${item.seller_nickname}` : '';
    if (itemPriceEl) itemPriceEl.textContent = `${item.price} ₽`;
    // Sync fav state and icon
    if (itemFavBtn) {
      const active = isFav(item?.id);
      itemFavBtn.classList.toggle('fav-active', active);
      const icon = itemFavBtn.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-regular', !active);
        icon.classList.toggle('fa-solid', active);
      }
    }
    // Reset right FAQ panels/buttons
    try {
      const deal = document.getElementById('faq-panel-deal');
      const prob = document.getElementById('faq-panel-problem');
      if (deal) deal.hidden = true;
      if (prob) prob.hidden = true;
      document.getElementById('item-how-deal')?.classList.remove('active');
      document.getElementById('item-problem')?.classList.remove('active');
    } catch {}
    // Заблокируем прокрутку фона
    document.body.classList.add('modal-open');
    itemModal.classList.add('active');
    itemModal.classList.remove('hidden');
  };
  const closeItemModal = () => {
    itemModal.classList.remove('active');
    // match overlay transition
    setTimeout(() => itemModal.classList.add('hidden'), 250);
    currentItem = null;
    // Вернём прокрутку
    document.body.classList.remove('modal-open');
  };
  itemCloseBtn?.addEventListener('click', closeItemModal);
  itemBackBtn?.addEventListener('click', closeItemModal);
  itemModal?.addEventListener('click', (e) => { if (e.target === itemModal) closeItemModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !itemModal.classList.contains('hidden')) closeItemModal(); });

  // Share current page or copy link
  itemShareBtn?.addEventListener('click', async () => {
    const url = window.location.href;
    const title = itemNameEl?.textContent || 'Товар';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        showTip(shareTipEl);
      } else if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        showTip(shareTipEl);
      } else {
        // Фолбэк: текстовое поле
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        showTip(shareTipEl);
      }
    } catch(e){ showToast('Не удалось поделиться', 'error'); }
  });

  // Toggle favorites
  itemFavBtn?.addEventListener('click', () => {
    if (!currentItem || !currentItem.id) return showToast('Товар не выбран', 'error');
    const active = toggleFav(currentItem.id);
    itemFavBtn.classList.toggle('fav-active', active);
    const icon = itemFavBtn.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-regular', !active);
      icon.classList.toggle('fa-solid', active);
    }
    showTip(favTipEl, active ? 'Добавлено в избранное' : 'Удалено из избранного');
  });
  itemBuyBtn?.addEventListener('click', async () => {
    if (!auth()) return showAuth();
    if (!currentItem || !currentItem.id) return showToast('Товар не выбран', 'error');
    const btn = itemBuyBtn;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Покупка...';
    try {
      const r = await fetch(`/api/items/${currentItem.id}/buy`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      const data = await r.json().catch(()=>({}));
      if (r.status === 201) {
        showToast('Сделка создана. Средства заморожены.', 'success');
        // Уберём товар из общей ленты (он стал reserved)
        if (Array.isArray(allItems)) {
          allItems = allItems.filter(x => String(x.id) !== String(currentItem.id));
          allItemsBlock.innerHTML = allItems.map(itemCard).join('');
          bindItemGrid(allItemsBlock);
        }
        // Обновим список сделок, если открыт соответствующий раздел
        loadDeals();
        closeItemModal();
      } else {
        const msg = data?.error || 'Не удалось купить товар';
        showToast(msg, 'error');
      }
    } catch (e) {
      showToast('Ошибка сети при покупке', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  });

  const bindItemGrid = (root, getList) => {
    if (!root) return;
    root.addEventListener('click', (e) => {
      const card = e.target.closest('.shop-item');
      if (!card || !root.contains(card)) return;
      const id = card.dataset.id;
      const list = (typeof getList === 'function' ? getList() : allItems) || [];
      const item = list.find(x => String(x.id) === String(id));
      if (item) openItemModal(item);
    });
  };

  // Toasts
  const toastRoot = document.getElementById('toast-root');
  const showToast = (msg, type = 'success', timeout = 4000, imageUrl = null) => {
    if (!toastRoot) return alert(msg);
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    // progress bar duration via CSS variable
    el.style.setProperty('--toast-life', `${timeout}ms`);

    // Optional image thumbnail support
    const imgSrc = imageUrl ? normalizeImageUrl(imageUrl) : '';
    const thumb = imgSrc ? `<img class="thumb" src="${imgSrc}" alt="" onerror="this.style.display='none'">` : '';
    el.innerHTML = `
      <span class="icon">${type === 'success' ? '✅' : '⚠️'}</span>
      ${thumb}
      <span class="msg">${msg}</span>
      <button class="close" aria-label="Закрыть уведомление">✖</button>
      ${timeout ? '<span class="progress" aria-hidden="true"></span>' : ''}
    `;

    let removeTimer = null;
    let endsAt = 0;
    const doRemove = () => {
      // graceful hide animation then remove
      el.classList.add('hide');
      setTimeout(() => el.remove(), 210);
    };
    const startTimer = (ms) => {
      if (!ms) return;
      endsAt = Date.now() + ms;
      removeTimer = setTimeout(doRemove, ms);
    };
    const pauseTimer = () => { if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; } };
    const resumeTimer = () => {
      if (!timeout) return;
      const remaining = Math.max(0, endsAt - Date.now());
      startTimer(remaining || 1);
    };

    el.querySelector('.close')?.addEventListener('click', doRemove);
    el.addEventListener('mouseenter', pauseTimer);
    el.addEventListener('mouseleave', resumeTimer);

    toastRoot.appendChild(el);
    if (timeout) startTimer(timeout);
  };

  const renderTab = (cat, showAll = false) => {
    const list = fullGameLists[cat];
    if (!list) return;
    const DEFAULT_COUNT = 6;
    const many = list.length > DEFAULT_COUNT;
    const toShow = showAll ? list : list.slice(0, DEFAULT_COUNT);
    tabContainer.innerHTML = toShow.map(gameCard).join('');
    showAllBtn.style.display = many && !showAll ? 'block' : 'none';
    showLessBtn.style.display = many && showAll ? 'block' : 'none';

  };

  const setupTabs = () => {
    // Initial active: prefer button with data-category="pc"
    const btnPc = [...tabButtons].find(b => b.dataset.category === 'pc') || tabButtons[0];
    if (btnPc) tabButtons.forEach(b => b.classList.toggle('active', b === btnPc));
    renderTab('pc'); // default content

    tabButtons.forEach(t => t.addEventListener('click', () => {
      // при смене вкладки очистим строку поиска
      if (searchInput) searchInput.value = '';
      // toggle active class between tabs
      tabButtons.forEach(b => b.classList.remove('active'));
      t.classList.add('active');
      renderTab(t.dataset.category);
    }));

    showAllBtn.addEventListener('click', () => {
      const activeCat = document.querySelector('.tab-button.active')?.dataset.category || 'pc';
      renderTab(activeCat, true);
    });
    showLessBtn.addEventListener('click', () => {
      const activeCat = document.querySelector('.tab-button.active')?.dataset.category || 'pc';
      renderTab(activeCat, false);
    });
  };

  const showItemsForGame = async (gameId, gameName) => {
    const itemsPage = document.getElementById('game-items-page');
    const itemsContainer = itemsPage.querySelector('.page-container');
    if (!itemsContainer) return;

    // Моментальный плейсхолдер до загрузки данных
    const skeletonBlock = () => {
      const sk = (w = 100) => `style="background: linear-gradient(45deg, #2a2a2a 25%, #333 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite linear; border-radius: 8px; height: 16px; width: ${w}%;"`;
      const thumb = `style="height: 150px; width: 100%; background: linear-gradient(45deg, #2a2a2a 25%, #333 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite linear; border-radius: 8px;"`;
      const cards = Array.from({length: 8}).map(() => `
        <div class="shop-item">
          <div class="thumb-wrap"><div ${thumb}></div></div>
          <div class="meta" style="gap:8px;">
            <div ${sk(90)}></div>
            <div ${sk(60)}></div>
          </div>
        </div>
      `).join('');
      return `
        <div class="items-header">
          <button class="accent-btn outline" id="back-to-catalog">Назад</button>
          <h2>${gameName ? `Товары — ${escapeHtml(gameName)}` : 'Товары'}</h2>
        </div>
        <div class="card-grid">${cards}</div>
      `;
    };
    itemsContainer.innerHTML = skeletonBlock();

    // Кнопка назад работает сразу
    itemsContainer.querySelector('#back-to-catalog')?.addEventListener('click', () => {
      window.location.hash = 'catalog';
      itemsContainer.innerHTML = '';
    });

    try {
      const res = await fetch(`/api/items/game/${gameId}`);
      if (!res.ok) throw new Error('Не удалось загрузить товары');
      const items = await res.json();

      const itemsHTML = items.length ? items.map(itemCard).join('') : '<p class="empty-list-msg">Для этой игры пока нет товаров.</p>';
      // Если не передано имя игры — попытаемся взять из кеша игр
      if (!gameName) {
        const findById = (arr) => (arr || []).find(g => String(g.id) === String(gameId));
        const g = (fullGameLists && (findById(fullGameLists.pc) || findById(fullGameLists.mobile) || findById(fullGameLists.apps))) || null;
        gameName = g?.name || 'Товары игры';
      }

      itemsContainer.innerHTML = `
        <div class="items-header">
          <button id="back-to-catalog" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Назад</button>
          <h2>${gameName}</h2>
        </div>
        <div class="card-grid">${itemsHTML}</div>
      `;

      // Установим hash с id игры
      const desiredHash = `game-items-page:${gameId}`;
      if ((window.location.hash || '').replace('#','') !== desiredHash) {
        window.location.hash = desiredHash;
      }

      // Привяжем обработчики
      const backBtn = document.getElementById('back-to-catalog');
      backBtn?.addEventListener('click', () => {
        window.location.hash = 'catalog';
        itemsContainer.innerHTML = '';
      });
      const grid = itemsContainer.querySelector('.card-grid');
      bindItemGrid(grid, () => items);

    } catch (err) {
      console.error(err);
      itemsContainer.innerHTML = `<p class="error-msg">${err.message}</p>`;
    }
  };

  tabContainer?.addEventListener('click', e => {
    const gameCard = e.target.closest('.game-card');
    if (gameCard && gameCard.dataset.id) {
      showItemsForGame(gameCard.dataset.id, gameCard.dataset.name);
    }
  });

  // Поиск по играм в активной вкладке
  searchInput?.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    const activeCat = document.querySelector('.tab-button.active')?.dataset.category || 'pc';
    if (!q) {
      // Пустой запрос — вернём стандартный список вкладки
      renderTab(activeCat, false);
      return;
    }
    const list = fullGameLists[activeCat] || [];
    const filtered = list.filter(g => (g.name || '').toLowerCase().includes(q));
    tabContainer.innerHTML = filtered.map(gameCard).join('');
    // во время поиска скрываем кнопки пагинации
    showAllBtn.style.display = 'none';
    showLessBtn.style.display = 'none';
  });

  /* -------------------- SELL -------------------- */
  // Black Russia servers list
  const BR_SERVERS = [
    'Red','Green','Blue','Yellow','Orange','Purple','Lime','Pink','Cherry','Black','Indigo','White','Magenta','Crimson','Gold','Azure','Platinum','Aqua','Gray','Ice','Chilli','Choco','Moscow','SPB','UFA','Sochi','Kazan','Samara','Rostov','Anapa','EKB','Krasnodar','Arzamas','Novosibirsk','Grozny','Saratov','Omsk','Irkutsk','Volgograd','Voronezh','Belgorod','Makhachkala','Vladikavkaz','Vladivostok','Kaliningrad','Chelyabinsk','Krasnoyarsk','Cheboksary','Khabarovsk','Perm','Tula','Ryazan','Murmansk','Penza','Kursk','Arkhangelsk','Orenburg','Kirov','Kemerovo','Tyumen','Tolyatti','Ivanovo','Stavropol','Smolensk','Pskov','Bryansk','Orel','Yaroslavl','Barnaul','Lipetsk','Ulyanovsk','Yakutsk','Tambov','Bratsk','Astrakhan','Chita','Kostroma','Vladimir','Kaluga','Novgorod','Taganrog','Vologda','Tver','Tomsk','Izhevsk','Surgut','Podolsk','Magadan','Cherepovets'
  ];

  function ensureBrServersPopulated(){
    if (!brServerSelect) return;
    if (brServerSelect.options.length > 0) return;
    const frag = document.createDocumentFragment();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Выберите сервер';
    placeholder.disabled = true;
    placeholder.selected = true;
    frag.appendChild(placeholder);
    BR_SERVERS.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      frag.appendChild(opt);
    });
    brServerSelect.appendChild(frag);
  }

  function toggleBrServer(gameName){
    const isBR = (gameName || '').toLowerCase().includes('black russia');
    if (!brServerField || !brServerSelect) return;
    if (isBR){
      ensureBrServersPopulated();
      brServerField.classList.remove('hidden');
      brServerSelect.required = true;
    } else {
      brServerField.classList.add('hidden');
      brServerSelect.required = false;
      brServerSelect.selectedIndex = 0; // сброс к placeholder (если есть)
    }
  }

  const gameSelectRender = (list) => {
    // Используем тот же шаблон, что и в каталоге, для единообразия карточек
    sellGameList.innerHTML = list.map(gameCard).join('');
  };

  sellSearch?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    gameSelectRender(fullGameLists.pc.concat(fullGameLists.mobile, fullGameLists.apps).filter(g => g.name.toLowerCase().includes(q)));
  });

  sellGameList?.addEventListener('click', e => {
    const card = e.target.closest('.game-card');
    if (!card) return;
    const imgEl = card.querySelector('img');
    const imgSrc = imgEl ? imgEl.src : '';
    selectedGame = { id: card.dataset.id, name: card.dataset.name, image_url: imgSrc };
    chosenImg.src = selectedGame.image_url || '';
    chosenTitle.textContent = selectedGame.name;
    toggleBrServer(selectedGame.name);
    sellSelect.classList.add('hidden');
    sellFormWrap.classList.remove('hidden');
  });

  changeGameBtn?.addEventListener('click', () => {
    selectedGame = null;
    sellForm.reset();
    toggleBrServer('');
    sellFormWrap.classList.add('hidden');
    sellSelect.classList.remove('hidden');
  });

  // --- Photo uploader: preview + drag&drop ---
  let currentPreviewUrl = '';
  const MAX_MB = 5;
  function setPreview(file){
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Можно загружать только изображения', 'error'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { showToast(`Размер файла не должен превышать ${MAX_MB} МБ`, 'error'); return; }
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = URL.createObjectURL(file);
    if (sellPreviewImg) sellPreviewImg.src = currentPreviewUrl;
    sellPreviewWrap?.classList.remove('hidden');
    sellDrop?.classList.add('hidden');
  }
  function clearPreview(){
    if (currentPreviewUrl) { URL.revokeObjectURL(currentPreviewUrl); currentPreviewUrl = ''; }
    if (sellPreviewImg) sellPreviewImg.removeAttribute('src');
    sellPreviewWrap?.classList.add('hidden');
    sellDrop?.classList.remove('hidden');
    if (sellPhotoInput) sellPhotoInput.value = '';
  }
  sellPhotoInput?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setPreview(f);
  });
  sellPhotoClear?.addEventListener('click', clearPreview);
  sellDrop?.addEventListener('click', () => sellPhotoInput?.click());
  ['dragenter','dragover'].forEach(ev => sellUploader?.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); sellUploader.classList.add('dragover');
  }));
  ;['dragleave','dragend','drop'].forEach(ev => sellUploader?.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); sellUploader.classList.remove('dragover');
  }));
  sellUploader?.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) { setPreview(file); if (sellPhotoInput) sellPhotoInput.files = e.dataTransfer.files; }
  });

  sellForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth()) return showAuth();
    if (!selectedGame) return showToast('Выберите игру', 'error');
    if (!sellPhotoInput || !sellPhotoInput.files || sellPhotoInput.files.length === 0) {
      return showToast('Добавьте фото товара', 'error');
    }
    const fd = new FormData(sellForm);
    // Инпут файла вне формы, добавляем явно
    if (sellPhotoInput && sellPhotoInput.files && sellPhotoInput.files[0]) {
      fd.append('photo', sellPhotoInput.files[0]);
    }
    fd.append('game_id', selectedGame.id);
    // Обязательный выбор сервера для Black Russia
    if ((selectedGame.name || '').toLowerCase() === 'black russia') {
      const server = brServerSelect ? brServerSelect.value : '';
      if (!server) return showToast('Выберите сервер Black Russia', 'error');
      fd.append('server', server);
    }
    try {
      const r = await fetch('/api/items', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: fd });
      let data = null;
      try { data = await r.json(); } catch (_) { data = null; }
      if (r.status === 201 || r.ok) {
        const newItem = data || {};
        allItems.unshift(newItem);
        allItemsBlock.innerHTML = allItems.map(itemCard).join('');
        bindItemGrid(allItemsBlock);
        changeGameBtn.click();
        showToast('Товар добавлен', 'success');
      } else if (r.status === 409) {
        // Дружелюбное сообщение о дубликате: подскажем пользователю, как изменить название
        const thumb = selectedGame?.image_url || '';
        const msg = data?.error || 'Похожий товар уже существует.';
        showToast(`${msg} Переименуйте объявление: добавьте уточнение (сервер, уровень, характеристики), чтобы отличалось.`, 'error', 7000, thumb);
      } else {
        const msg = (data && data.error) ? data.error : 'Не удалось выставить';
        showToast(msg, 'error');
      }
    } catch (err) {
      showToast(err.message || 'Ошибка запроса', 'error');
    }
  });

  /* -------------------- INITIAL LOAD -------------------- */
  const loadContent = async () => {
    try {
      const gRes = await fetch('/api/games');
      const games = await gRes.json();
      fullGameLists = {
        pc: games.filter(g => g.category === 'pc'),
        mobile: games.filter(g => g.category === 'mobile'),
        apps: games.filter(g => g.category === 'apps')
      };
      setupTabs();
      gameSelectRender(games);

      const iRes = await fetch('/api/items/all');
      allItems = await iRes.json();
      allItemsBlock.innerHTML = allItems.map(itemCard).join('');
      bindItemGrid(allItemsBlock);

    } catch (err) { console.error(err); }
  };
  loadContent();

  /* -------------------- DEALS -------------------- */
  function renderDeals(list){
    if (!dealsList) return;
    if (!Array.isArray(list) || list.length === 0){
      dealsList.innerHTML = 'Пока нет активных сделок';
      return;
    }
    dealsList.innerHTML = list.map(d => {
      const statusMap = { pending: 'Ожидание', seller_confirmed: 'Подтверждено', completed: 'Завершена', dispute: 'Спор' };
      const role = d.role === 'buyer' ? 'Покупатель' : 'Продавец';
      const thumb = d.item_photo ? `<img class="deal-thumb" src="${d.item_photo}" alt="${d.item_name || ''}">` : `<div class="deal-thumb placeholder"></div>`;
      return `
        <div class="deal-card" data-id="${d.id}">
          <div class="deal-left">${thumb}</div>
          <div class="deal-right">
            <div class="deal-top">
              <div class="deal-title-wrap">
                <div class="deal-title">${d.item_name || 'Товар'}</div>
                <span class="price-badge small">${d.price} ₽</span>
              </div>
              <div class="deal-top-right">
                <span class="deal-status ${d.status}">${statusMap[d.status] || d.status}</span>
                <button class="icon-btn small deal-help-inline" title="Как работает сделка?" data-help>
                  <i class="fa-solid fa-circle-question"></i>
                </button>
              </div>
            </div>
            <div class="deal-meta-row">
              <span class="role-chip ${d.role}">${role}</span>
              <span class="deal-users">Продавец: ${d.seller_nickname || d.seller_id} · Покупатель: ${d.buyer_nickname || d.buyer_id}</span>
            </div>
          </div>
        </div>`;
    }).join('');
    // Bind click to open modal
    dealsList.querySelectorAll('.deal-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const deal = list.find(x => String(x.id) === String(id));
        if (deal) openDealModal(deal);
      });
      // inline help button should not open modal
      card.querySelector('[data-help]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openHelp();
      });
    });
  }

  async function loadDeals(){
    if (!dealsList) return;
    if (!auth()) { dealsList.innerHTML = 'Войдите, чтобы видеть сделки'; return; }
    try{
      const r = await fetch('/api/deals', { headers: { 'Authorization': 'Bearer ' + token() }});
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Не удалось загрузить сделки');
      renderDeals(data);
    }catch(e){
      console.error(e);
      dealsList.innerHTML = `<span class="error-msg">${e.message}</span>`;
    }
  }
});
