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

  // Item modal DOM
  const itemModal = document.getElementById('item-modal');
  const itemImgEl = document.getElementById('item-modal-img');
  const itemNameEl = document.getElementById('item-modal-name');
  const itemDescEl = document.getElementById('item-modal-desc');
  const itemSellerEl = document.getElementById('item-modal-seller');
  const itemPriceEl = document.getElementById('item-modal-price');
  const itemBuyBtn = document.getElementById('item-buy');
  const itemCloseBtn = document.getElementById('item-close');
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
  const auth = () => !!token();
  const json = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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
    // Подмешаем цвет будущего пузырька, чтобы кружок визуально "становился" пузырьком
    btn.style.setProperty('--lift-bg', colorForBtn(btn));
    // Готовим закреплённый пузырёк: мгновенно переносим в целевую точку и прячем без анимаций
    // (чтобы не было видимого "телепорта" из-под панели)
    positionStickyBubble(btn, { instant: true, prehide: true });
    if (stickyBubble) {
      // Форсируем рефлоу, затем включаем переходы обратно (если они нужны позже)
      // eslint-disable-next-line no-unused-expressions
      void stickyBubble.offsetWidth;
      stickyBubble.classList.remove('no-trans');
    }
    // Если уже играет анимация, перезапуск
    btn.classList.remove('lifting');
    // Форсируем рефлоу для перезапуска анимации
    // eslint-disable-next-line no-unused-expressions
    void icon.offsetWidth;
    btn.classList.add('lifting');
    return new Promise((resolve) => {
      const cleanup = () => {
        btn.classList.remove('lifting');
        // По завершении — просто плавно проявляем already-позиционированный пузырёк
        if (stickyBubble) stickyBubble.style.opacity = '1';
        resolve();
      };
      icon.addEventListener('animationend', cleanup, { once: true });
    });
  };

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
    const img = deal.item_photo ? `<img class="deal-thumb" src="${deal.item_photo}" alt="${deal.item_name || ''}">` : '';
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

  // Help modal
  const openHelp = () => { if (!dealHelp) return; dealHelp.classList.add('active'); dealHelp.classList.remove('hidden'); };
  const closeHelp = () => { if (!dealHelp) return; dealHelp.classList.remove('active'); setTimeout(() => dealHelp.classList.add('hidden'), 250); };
  dealsHelpBtn?.addEventListener('click', openHelp);
  dealHelpClose?.addEventListener('click', closeHelp);
  dealHelp?.addEventListener('click', (e) => { if (e.target === dealHelp) closeHelp(); });
  applyTheme();
  themeToggle?.addEventListener('click', () => {
    isLight = !isLight;
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    applyTheme();
  });

  /* -------------------- AUTH -------------------- */
  const showAuth = (reg = false) => {
    registerMode = reg;
    authTitle.textContent = reg ? 'Регистрация' : 'Вход';
    confirmRow.classList.toggle('hidden', !reg);
    confirmRow.classList.toggle('visible', reg);
    authError.textContent = '';
    authOverlay.classList.add('active');
    authOverlay.classList.remove('hidden');
  };
  const hideAuth = () => {
    authOverlay.classList.remove('active');
    authOverlay.classList.add('hidden');
  };

  authSwitch?.addEventListener('click', () => showAuth(!registerMode));
  authOverlay?.addEventListener('click', (e) => { if (e.target === authOverlay) hideAuth(); });

  authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const fd = new FormData(authForm);
    const data = Object.fromEntries(fd.entries());
    if (registerMode) {
      if (data.password !== data.confirm_password) return authError.textContent = 'Пароли не совпадают';
      if (data.password.length < 6) return authError.textContent = 'Мин. 6 символов';
    }
    const ep = registerMode ? '/api/register' : '/api/login';
    try {
      const r = await fetch(ep, { method: 'POST', ...json(data) });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || 'Ошибка');
      localStorage.setItem('token', res.token);
      hideAuth();
      if (intendedRoute) {
        navigate(intendedRoute);
        intendedRoute = null;
      }
    } catch (err) { authError.textContent = err.message; }
  });

  /* -------------------- NAV -------------------- */
  const getTargetFromHash = () => {
    const h = (window.location.hash || '').replace('#','').trim();
    if (!h) return 'catalog';
    if (h === 'catalog-page') return 'catalog';
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
  };

  navBtns.forEach(b => b.addEventListener('click', async (e) => { 
    e.preventDefault(); 
    const target = b.dataset.target;
    if (!target) return;
    // Спец-логика для профиля: уважаем авторизацию
    if (target === 'profile') {
      // Если не авторизован — сразу показываем окно входа без подсветки и анимации
      if (!auth()) {
        intendedRoute = 'profile';
        showAuth();
        return;
      }
      // Авторизован — делаем красивую анимацию и переходим на profile.html
      navBtns.forEach(x => x.classList.toggle('active', x === b));
      await liftIconFromButton(b);
      window.location.href = 'profile.html';
      return;
    }
    window.location.hash = target;
  }));

  // Первичная навигация по hash (например, из profile.html приходим с #deals)
  navigate(getTargetFromHash());
  // Позиционируем закреплённый пузырёк на активной кнопке
  const initSticky = () => {
    const activeBtn = document.querySelector('.bottom-nav .nav-btn.active') ||
      [...navBtns].find(b => b.dataset.target === (getTargetFromHash() === 'catalog-page' ? 'catalog-page' : getTargetFromHash()));
    if (activeBtn) positionStickyBubble(activeBtn, { instant: true });
  };
  initSticky();
  window.addEventListener('hashchange', () => {
    navigate(getTargetFromHash());
    const activeBtn = document.querySelector('.bottom-nav .nav-btn.active');
    if (activeBtn) {
      // Реальный кружок уезжает вверх, по окончании появится закреплённый пузырёк
      liftIconFromButton(activeBtn);
    }
  });
  window.addEventListener('resize', () => {
    const activeBtn = document.querySelector('.bottom-nav .nav-btn.active');
    // На ресайзе переставляем без анимаций, чтобы избежать рывков
    if (activeBtn) positionStickyBubble(activeBtn, { instant: true });
  });

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
        if (chatsLayout) chatsLayout.classList.add('chat-open');
        await loadChatMessages(activeChatId);
        startChatPolling(activeChatId);
      });
    });
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
      ? `<img src="${g.banner_url}" alt="${g.name}" class="game-banner">`
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
      <img class="thumb" src="${i.image_url || 'https://via.placeholder.com/300x200?text=Item'}" alt="${i.title}">
      <span class="badge-price">${i.price} ₽</span>
    </div>
    <div class="meta">
      <h4 class="title">${cleanTitle(i.title)}</h4>
      ${i.seller_nickname ? `<span class="seller">${i.seller_nickname}</span>` : ''}
    </div>
  </div>`;

  // Item modal logic
  const openItemModal = (item) => {
    currentItem = item;
    if (itemImgEl) itemImgEl.src = item.image_url || 'https://via.placeholder.com/600x360?text=No+Image';
    if (itemNameEl) itemNameEl.textContent = cleanTitle(item.title || 'Товар');
    if (itemDescEl) itemDescEl.textContent = item.description || item.desc || 'Описание отсутствует';
    if (itemSellerEl) itemSellerEl.textContent = item.seller_nickname ? `Продавец: ${item.seller_nickname}` : '';
    if (itemPriceEl) itemPriceEl.textContent = `${item.price} ₽`;
    itemModal.classList.add('active');
    itemModal.classList.remove('hidden');
  };
  const closeItemModal = () => {
    itemModal.classList.remove('active');
    // match overlay transition
    setTimeout(() => itemModal.classList.add('hidden'), 250);
    currentItem = null;
  };
  itemCloseBtn?.addEventListener('click', closeItemModal);
  itemModal?.addEventListener('click', (e) => { if (e.target === itemModal) closeItemModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !itemModal.classList.contains('hidden')) closeItemModal(); });
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
  const showToast = (msg, type = 'success', timeout = 4000) => {
    if (!toastRoot) return alert(msg);
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    // progress bar duration via CSS variable
    el.style.setProperty('--toast-life', `${timeout}ms`);

    el.innerHTML = `
      <span class="icon">${type === 'success' ? '✅' : '⚠️'}</span>
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
    renderTab('pc'); // default
    tabButtons.forEach(t => t.addEventListener('click', () => {
      tabButtons.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      // при смене вкладки очистим строку поиска
      if (searchInput) searchInput.value = '';
      renderTab(t.dataset.category);
    }));

    showAllBtn.addEventListener('click', () => renderTab(document.querySelector('.tab-button.active').dataset.category, true));
    showLessBtn.addEventListener('click', () => renderTab(document.querySelector('.tab-button.active').dataset.category, false));
  };

  const showItemsForGame = async (gameId, gameName) => {
    const itemsPage = document.getElementById('game-items-page');
    const itemsContainer = itemsPage.querySelector('.page-container');
    if (!itemsContainer) return;

    try {
      const res = await fetch(`/api/items/game/${gameId}`);
      if (!res.ok) throw new Error('Не удалось загрузить товары');
      const items = await res.json();

      const itemsHTML = items.length ? items.map(itemCard).join('') : '<p class="empty-list-msg">Для этой игры пока нет товаров.</p>';
      itemsContainer.innerHTML = `
        <div class="items-header">
          <button id="back-to-catalog" class="back-btn"><i class="fas fa-arrow-left"></i> ${gameName}</button>
        </div>
        <div class="card-grid">${itemsHTML}</div>
      `;

      navigate('game-items-page');

      document.getElementById('back-to-catalog').addEventListener('click', () => {
        navigate('catalog');
        itemsContainer.innerHTML = ''; // Clear content after leaving
      });

      // Bind clicks for this list
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
    sellSelect.classList.add('hidden');
    sellFormWrap.classList.remove('hidden');
  });

  changeGameBtn?.addEventListener('click', () => {
    selectedGame = null;
    sellForm.reset();
    sellFormWrap.classList.add('hidden');
    sellSelect.classList.remove('hidden');
  });

  sellForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!auth()) return showAuth();
    if (!selectedGame) return showToast('Выберите игру', 'error');
    const fd = new FormData(sellForm);
    fd.append('game_id', selectedGame.id);
    try {
      const r = await fetch('/api/items', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: fd });
      if (!r.ok) throw new Error('Не удалось выставить');
      const newItem = await r.json();
      allItems.unshift(newItem);
      allItemsBlock.innerHTML = allItems.map(itemCard).join('');
      bindItemGrid(allItemsBlock);
      changeGameBtn.click();
      showToast('Товар добавлен', 'success');
    } catch (err) { showToast(err.message || 'Ошибка запроса', 'error'); }
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
