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
  const confirmRow = document.getElementById('confirm-password-row');

  // Catalog
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

  /* -------------------- STATE -------------------- */
  let isLight = localStorage.getItem('theme') === 'light';
  let registerMode = false;
  let intendedRoute = null;

  let fullGameLists = { pc: [], mobile: [], apps: [] };
  let allItems = [];
  let selectedGame = null;

  /* -------------------- UTIL -------------------- */
  const token = () => localStorage.getItem('token');
  const auth = () => !!token();
  const json = (body) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  /* -------------------- THEME -------------------- */
  const applyTheme = () => {
    body.classList.toggle('light-theme', isLight);
    if (themeToggle) themeToggle.innerHTML = isLight ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  };
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
    authOverlay.classList.remove('hidden');
  };
  const hideAuth = () => authOverlay.classList.add('hidden');

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
      if (intendedRoute) navigate(intendedRoute);
    } catch (err) { authError.textContent = err.message; }
  });

  /* -------------------- NAV -------------------- */
  const navigate = (id) => {
    if (id === 'profile') {
      if (auth()) return location.href = 'profile.html';
      intendedRoute = 'profile';
      return showAuth(false);
    }
    pages.forEach(p => p.classList.toggle('active', p.id === id));
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.target === id));
  };
  navBtns.forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); navigate(b.dataset.target); }));

  /* -------------------- CATALOG -------------------- */
  const gameCard = (g) => `<div class="card game-card"><img src="${g.image_url || 'https://via.placeholder.com/200x270'}"><h3>${g.name}</h3></div>`;
  const itemCard = (i) => `<div class="card item-card"><img src="${i.photo_url || 'https://via.placeholder.com/200x270'}"><h3>${i.name}</h3><p>${i.price} ₽</p></div>`;

  const renderTab = (cat, showAll = false) => {
    const list = fullGameLists[cat] || [];
    const slice = showAll ? list : list.slice(0, 6);
    tabContainer.innerHTML = slice.map(gameCard).join('');
    const many = list.length > 6;
    showAllBtn.style.display = many && !showAll ? 'block' : 'none';
    showLessBtn.style.display = many && showAll ? 'block' : 'none';
  };

  const setupTabs = () => {
    renderTab('pc'); // default
    document.querySelectorAll('.tab-button').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderTab(t.dataset.category);
    }));
    showAllBtn.addEventListener('click', () => renderTab(document.querySelector('.tab-button.active').dataset.category, true));
    showLessBtn.addEventListener('click', () => renderTab(document.querySelector('.tab-button.active').dataset.category, false));
  };

  /* -------------------- SELL -------------------- */
  const gameSelectRender = (list) => sellGameList.innerHTML = list.map(g => `
    <div class="card game-card" data-id='${g.id}' data-name='${g.name}' data-img='${g.image_url}'>
      <img src="${g.image_url || 'https://via.placeholder.com/200x270'}"><h3>${g.name}</h3>
    </div>`).join('');

  sellSearch?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    gameSelectRender(fullGameLists.pc.concat(fullGameLists.mobile, fullGameLists.apps).filter(g => g.name.toLowerCase().includes(q)));
  });

  sellGameList?.addEventListener('click', e => {
    const card = e.target.closest('.game-card');
    if (!card) return;
    selectedGame = { id: card.dataset.id, name: card.dataset.name, image_url: card.dataset.img };
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
    if (!selectedGame) return alert('Выберите игру');
    const fd = new FormData(sellForm);
    fd.append('game_id', selectedGame.id);
    try {
      const r = await fetch('/api/items', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: fd });
      if (!r.ok) throw new Error('Не удалось выставить');
      const newItem = await r.json();
      allItems.unshift(newItem);
      allItemsBlock.innerHTML = allItems.map(itemCard).join('');
      changeGameBtn.click();
      alert('Товар добавлен');
    } catch (err) { alert(err.message); }
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
    } catch (err) { console.error(err); }
  };
  loadContent();
});
