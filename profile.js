document.addEventListener('DOMContentLoaded', () => {
    let currentUser = {}; // Глобальная переменная для данных пользователя

    /**
     * Загружает данные профиля пользователя с сервера.
     */
    const loadProfileData = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = 'index.html'; // Перенаправление на главную, если нет токена
            return;
        }

        try {
            const response = await fetch('/api/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('token');
                window.location.href = 'index.html'; // Перенаправление при невалидном токене
                return;
            }

            if (!response.ok) {
                throw new Error('Не удалось загрузить данные профиля.');
            }

            const user = await response.json();
            currentUser = user; // Сохраняем данные пользователя

            // Обновляем DOM
            document.getElementById('profile-nickname').textContent = user.nickname;
            document.getElementById('profile-balance').textContent = `${user.balance.toFixed(2)} ₽`;
            document.getElementById('profile-frozen-balance').textContent = `${user.frozen_balance.toFixed(2)} ₽`;

            const profileAvatar = document.getElementById('profile-avatar');
            if (profileAvatar && user.avatar_url) {
                profileAvatar.src = user.avatar_url.startsWith('http') ? user.avatar_url : `/${user.avatar_url}`;
            }

            loadTransactionHistory(); // Загружаем историю транзакций после данных профиля
        } catch (error) {
            console.error('Ошибка при загрузке профиля:', error);
            document.getElementById('profile-nickname').textContent = 'Ошибка';
        }
    };

    /**
     * Отрисовывает один элемент истории транзакций.
     * @param {object} transaction - Объект транзакции.
     * @returns {string} HTML-строка для элемента списка.
     */
    const renderTransactionItem = (transaction) => {
        const { type, date, amount, status } = transaction;
        const typeMap = { topup: 'Пополнение', withdraw: 'Вывод', purchase: 'Покупка', sale: 'Продажа' };
        const statusMap = { completed: 'Выполнено', pending: 'В обработке', failed: 'Отклонено' };
        const isCredit = ['topup', 'sale'].includes(type);
        const amountClass = isCredit ? 'success' : 'error';
        const sign = isCredit ? '+' : '-';
        const formattedAmount = `${sign} ${amount.toFixed(2)} ₽`;
        const formattedDate = new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

        return `
            <li class="transaction-item">
                <div class="transaction-info">
                    <span class="transaction-type">${typeMap[type] || type}</span>
                    <span class="transaction-date">${formattedDate}</span>
                </div>
                <div class="transaction-details">
                    <span class="transaction-amount ${amountClass}">${formattedAmount}</span>
                    <span class="transaction-status">${statusMap[status] || status}</span>
                </div>
            </li>
        `;
    };

    /**
     * Загружает и отображает историю транзакций.
     */
    const loadTransactionHistory = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;

        try {
            const response = await fetch('/api/finance', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Не удалось загрузить историю транзакций.');

            const transactions = (await response.json()).map(tx => ({...tx, date: tx.created_at}));
            const financeContent = document.getElementById('finance-content');

            if (transactions.length > 0) {
                const listHtml = transactions.map(renderTransactionItem).join('');
                financeContent.innerHTML = `<div class="transaction-history"><h3>История операций</h3><ul class="transaction-list">${listHtml}</ul></div>`;
            } else {
                financeContent.innerHTML = `<div class="transaction-history"><h3>История операций</h3><p>У вас пока нет операций.</p></div>`;
            }
        } catch (error) {
            console.error('Ошибка при загрузке истории транзакций:', error);
            document.getElementById('finance-content').innerHTML = '<p>Не удалось загрузить историю операций.</p>';
        }
    };

    /**
     * Устанавливает все основные обработчики событий на странице.
     */
    const setupEventListeners = () => {
        // Выход из системы
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            localStorage.removeItem('token');
            window.location.href = 'index.html';
        });

        // Загрузка аватара
        document.getElementById('avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('avatar', file);
            const token = localStorage.getItem('token');

            try {
                const response = await fetch('/api/avatar', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Не удалось загрузить аватар.');
                }

                const data = await response.json();
                document.getElementById('profile-avatar').src = data.avatarUrl.startsWith('http') ? data.avatarUrl : `/${data.avatarUrl}`;
                alert('Аватар успешно обновлен!');
            } catch (error) {
                console.error('Ошибка при загрузке аватара:', error);
                alert(`Ошибка: ${error.message}`);
            }
        });

        // Переключение вкладок
        document.querySelector('.profile-tabs-top')?.addEventListener('click', (e) => {
            const clickedButton = e.target.closest('.tab-btn');
            if (!clickedButton) return;

            const tabId = clickedButton.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            clickedButton.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === `${tabId}-content`);
            });

            // Динамическая подгрузка контента вкладок
            if (tabId === 'items') loadMyItems();
            else if (tabId === 'purchases') loadMyPurchases();
            else if (tabId === 'sales') loadMySales();
        });

        // Открытие и закрытие финансового мастера
        document.getElementById('balance-box')?.addEventListener('click', showFinanceWizard);
        document.getElementById('wizard-close-btn')?.addEventListener('click', hideFinanceWizard);
        document.getElementById('finance-wizard-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'finance-wizard-overlay') hideFinanceWizard();
        });
    };

    // --- Функции для рендера и загрузки контента вкладок ---

    const renderMyItemCard = (item) => {
        const { name, price, photo_url, status } = item;
        const statusText = status === 'active' ? 'Активен' : 'Продан';
        const statusClass = status === 'active' ? 'status-active' : 'status-sold';
        return `
            <div class="item-card-profile">
                <img src="${photo_url || 'https://via.placeholder.com/400x300?text=No+Image'}" alt="${name}" class="item-card-profile-img">
                <div class="item-card-profile-info">
                    <h4 class="item-card-profile-name">${name}</h4>
                    <p class="item-card-profile-price">${price.toFixed(2)} ₽</p>
                    <span class="item-card-profile-status ${statusClass}">${statusText}</span>
                </div>
            </div>
        `;
    };

    const renderMyPurchaseCard = (purchase) => {
        const name = purchase.name || purchase.item_name || 'Товар';
        const price = Number(purchase.purchase_price ?? purchase.price ?? 0);
        const photo = purchase.photo_url || purchase.item_photo || '';
        const dateRaw = purchase.purchase_date || purchase.created_at || purchase.date;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : '';
        return `
            <div class="item-card-profile">
                <img src="${photo || 'https://via.placeholder.com/400x300?text=No+Image'}" alt="${name}" class="item-card-profile-img">
                <div class="item-card-profile-info">
                    <h4 class="item-card-profile-name">${name}</h4>
                    <p class="item-card-profile-price">${price.toFixed(2)} ₽</p>
                    <span class="item-card-profile-status status-active">Куплено ${date}</span>
                </div>
            </div>
        `;
    };

    const renderMySaleCard = (sale) => {
        const name = sale.name || sale.item_name || 'Товар';
        const price = Number(sale.sale_price ?? sale.price ?? 0);
        const photo = sale.photo_url || sale.item_photo || '';
        const dateRaw = sale.sale_date || sale.created_at || sale.date;
        const buyer = sale.buyer_nickname || sale.buyer || '';
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString('ru-RU') : '';
        return `
            <div class="item-card-profile">
                <img src="${photo || 'https://via.placeholder.com/400x300?text=No+Image'}" alt="${name}" class="item-card-profile-img">
                <div class="item-card-profile-info">
                    <h4 class="item-card-profile-name">${name}</h4>
                    <p class="item-card-profile-price">${price.toFixed(2)} ₽</p>
                    <span class="item-card-profile-status status-sold">Покупатель: ${buyer || '—'} • ${date}</span>
                </div>
            </div>
        `;
    };

    const loadMyItems = async () => {
        const itemsContent = document.getElementById('items-content');
        if (!itemsContent || itemsContent.dataset.loaded) return; // Не перезагружать, если уже загружено
        itemsContent.innerHTML = '<p>Загрузка...</p>';
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('/api/me/items', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status} /api/me/items ${text || ''}`.trim());
            }
            const items = await response.json();
            itemsContent.innerHTML = items.length > 0
              ? `<div class="items-grid">${items.map(renderMyItemCard).join('')}</div>`
              : '<p>У вас нет товаров на продаже.</p>';
            itemsContent.dataset.loaded = 'true';
        } catch (error) {
            console.error('loadMyItems error:', error);
            itemsContent.innerHTML = `<p>Не удалось загрузить ваши товары. ${error?.message ? '(' + error.message + ')' : ''}</p>`;
        }
    };

    const loadMyPurchases = async () => {
        const purchasesContent = document.getElementById('purchases-content');
        if (!purchasesContent || purchasesContent.dataset.loaded) return; // Не перезагружать, если уже загружено
        purchasesContent.innerHTML = '<p>Загрузка...</p>';
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('/api/me/purchases', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status} /api/me/purchases ${text || ''}`.trim());
            }
            const purchases = await response.json();
            purchasesContent.innerHTML = purchases.length > 0
              ? `<div class="items-grid">${purchases.map(renderMyPurchaseCard).join('')}</div>`
              : '<p>У вас пока нет покупок.</p>';
            purchasesContent.dataset.loaded = 'true';
        } catch (error) {
            console.error('loadMyPurchases error:', error);
            purchasesContent.innerHTML = `<p>Не удалось загрузить ваши покупки. ${error?.message ? '(' + error.message + ')' : ''}</p>`;
        }
    };

    const loadMySales = async () => {
        const salesContent = document.getElementById('sales-content');
        if (!salesContent || salesContent.dataset.loaded) return; // Не перезагружать, если уже загружено
        salesContent.innerHTML = '<p>Загрузка...</p>';
        const token = localStorage.getItem('token');
        try {
            const response = await fetch('/api/me/sales', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status} /api/me/sales ${text || ''}`.trim());
            }
            const sales = await response.json();
            salesContent.innerHTML = sales.length > 0
              ? `<div class=\"items-grid\">${sales.map(renderMySaleCard).join('')}</div>`
              : '<p>У вас еще нет продаж.</p>';
            salesContent.dataset.loaded = 'true';
        } catch (error) {
            console.error('loadMySales error:', error);
            salesContent.innerHTML = `<p>Не удалось загрузить ваши продажи. ${error?.message ? '(' + error.message + ')' : ''}</p>`;
        }
    };

    // --- Логика финансового мастера (модальное окно) ---
    const financeWizardOverlay = document.getElementById('finance-wizard-overlay');
    const wizardContent = document.getElementById('wizard-content');
    let depositAmount = 0;
    let withdrawAmount = 0;
    let selectedDepositBank = 'sber';

    // --- Утилиты для реквизитов пополнения ---
    const BANK_BINS = {
        sber: ['427600', '546900', '220220'],
        tinkoff: ['521324', '553691', '220070'],
        alpha: ['415428', '548673', '220055']
    };

    const luhnCheckDigit = (digits15) => {
        // digits15: строка из 15 цифр
        const digits = digits15.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
            let d = digits[digits.length - 1 - i];
            if (i % 2 === 0) {
                d *= 2;
                if (d > 9) d -= 9;
            }
            sum += d;
        }
        const check = (10 - (sum % 10)) % 10;
        return String(check);
    };

    const formatCard = (raw) => raw.replace(/(\d{4})(?=\d)/g, '$1 ').trim();

    const generateCardNumber = (bankKey) => {
        const bins = BANK_BINS[bankKey] || BANK_BINS.sber;
        const bin = bins[Math.floor(Math.random() * bins.length)];
        let body = bin;
        while (body.length < 15) body += Math.floor(Math.random() * 10);
        const check = luhnCheckDigit(body);
        return formatCard(body + check);
    };

    const generateCommentCode = () => String(Math.floor(100000 + Math.random() * 900000));

    // Toast уведомления
    const showToast = (message, type = 'error') => {
        let root = document.getElementById('toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'toast-root';
            document.body.appendChild(root);
        }
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="icon">${type === 'success' ? '✔️' : '⚠️'}</span><div class="msg">${message}</div><button class="close">×</button>`;
        el.querySelector('.close').addEventListener('click', () => el.remove());
        root.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    };

    const showFinanceWizard = () => {
        financeWizardOverlay?.classList.add('active');
        renderWizardStep('initial');
    };

    const hideFinanceWizard = () => {
        financeWizardOverlay?.classList.remove('active');
    };

    /**
     * Отрисовывает определенный шаг в финансовом мастере.
     * @param {string} step - Название шага.
     */
    const renderWizardStep = (step) => {
        let content = '';
        switch (step) {
            case 'initial':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header"><h3>Финансовые операции</h3></div>
                        <div class="wizard-initial-buttons">
                            <button class="accent-btn" data-wizard-action="deposit">Пополнить</button>
                            <button class="accent-btn" data-wizard-action="withdraw">Вывести</button>
                        </div>
                    </div>
                `;
                break;
            case 'deposit-amount':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-initial"><i class="fas fa-arrow-left"></i></button>
                            <h3>Пополнение</h3>
                        </div>
                        <div class="wizard-body">
                            <input type="number" class="form-input" placeholder="Сумма пополнения" id="deposit-amount-input">
                            <button class="accent-btn" data-wizard-action="confirm-deposit">Далее</button>
                        </div>
                    </div>
                `;
                break;
            case 'deposit-bank':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-amount"><i class="fas fa-arrow-left"></i></button>
                            <h3>Выберите банк</h3>
                        </div>
                        <div class="wizard-body">
                            <div class="custom-select-wrapper"><select class="custom-select" id="bank-select"><option value="sber">Сбербанк</option><option value="tinkoff">Тинькофф</option><option value="alpha">Альфа-Банк</option></select></div>
                            <button class="accent-btn" data-wizard-action="select-bank">Далее</button>
                        </div>
                    </div>
                `;
                break;
            case 'deposit-details':
                const cardNumber = generateCardNumber(selectedDepositBank);
                const randomCode = generateCommentCode();
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-bank"><i class="fas fa-arrow-left"></i></button>
                            <h3>Детали пополнения</h3>
                        </div>
                        <div class="wizard-body deposit-details-container">
                            <p>Для пополнения на <strong>${depositAmount.toFixed(2)} RUB</strong>, совершите перевод:</p>
                            <div class="details-box">
                                <p><strong>Банк:</strong> ${selectedDepositBank === 'sber' ? 'Сбербанк' : selectedDepositBank === 'tinkoff' ? 'Тинькофф' : 'Альфа-Банк'}</p>
                                <p><strong>Карта:</strong> <span id="deposit-card-number">${cardNumber}</span></p>
                                <p><strong>Сумма:</strong> ${depositAmount.toFixed(2)} RUB</p>
                                <p><strong>Комментарий:</strong> <span class="accent-code" id="deposit-comment">${randomCode}</span> (обязательно)</p>
                            </div>
                            <button class="accent-btn" data-wizard-action="i-paid">Я оплатил</button>
                        </div>
                    </div>
                `;
                break;
            case 'withdraw-amount':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-initial"><i class="fas fa-arrow-left"></i></button>
                            <h3>Вывод средств</h3>
                        </div>
                        <div class="wizard-body">
                            <p>Ваш баланс: ${currentUser.balance?.toFixed(2) || '0.00'} RUB</p>
                            <div class="input-group">
                                <input type="number" class="form-input" placeholder="Сумма для вывода" id="withdraw-amount-input">
                                <button class="accent-btn" data-wizard-action="confirm-withdraw-amount">Далее</button>
                            </div>
                        </div>
                    </div>
                `;
                break;
            case 'withdraw-country':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-amount"><i class="fas fa-arrow-left"></i></button>
                            <h3>Выберите страну</h3>
                        </div>
                        <div class="wizard-body">
                            <div class="custom-select-wrapper"><select class="custom-select" id="withdraw-country-select"><option value="ru">Россия</option><option value="ua">Украина</option><option value="kz">Казахстан</option></select></div>
                            <button class="accent-btn" data-wizard-action="select-withdraw-country">Далее</button>
                        </div>
                    </div>
                `;
                break;
            case 'withdraw-bank':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-country"><i class="fas fa-arrow-left"></i></button>
                            <h3>Выберите банк</h3>
                        </div>
                        <div class="wizard-body">
                            <div class="custom-select-wrapper"><select class="custom-select" id="withdraw-bank-select"><option value="sber">Сбербанк</option><option value="tinkoff">Тинькофф</option><option value="alpha">Альфа-Банк</option></select></div>
                            <button class="accent-btn" data-wizard-action="select-withdraw-bank">Далее</button>
                        </div>
                    </div>
                `;
                break;
            case 'withdraw-card':
                content = `
                    <div class="wizard-step">
                        <div class="wizard-header">
                            <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-bank"><i class="fas fa-arrow-left"></i></button>
                            <h3>Введите номер карты</h3>
                        </div>
                        <div class="wizard-body">
                            <input type="text" class="form-input" placeholder="XXXX XXXX XXXX XXXX" id="card-number-input" maxlength="19">
                            <button class="accent-btn" data-wizard-action="confirm-withdraw-card">Подтвердить</button>
                        </div>
                    </div>
                `;
                break;
            default:
                content = '<p>Произошла ошибка.</p>';
        }
        wizardContent.innerHTML = content;
        
        const cardNumberInput = document.getElementById('card-number-input');
        if (cardNumberInput) {
            cardNumberInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[\D]/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
            });
        }
    };

    // Единый обработчик для всех действий в мастере
    wizardContent?.addEventListener('click', (e) => {
        const target = e.target.closest('[data-wizard-action]');
        if (!target) return;

        const action = target.dataset.wizardAction;

        // Используем объект для сопоставления действий с функциями
        const actions = {
            'deposit': () => renderWizardStep('deposit-amount'),
            'withdraw': () => renderWizardStep('withdraw-amount'),
            'back-to-initial': () => renderWizardStep('initial'),
            'confirm-deposit': () => {
                const amountInput = document.getElementById('deposit-amount-input');
                const amount = parseFloat(amountInput.value);
                if (isNaN(amount) || amount <= 0) {
                    alert('Введите корректную сумму.');
                    return;
                }
                depositAmount = amount;
                renderWizardStep('deposit-bank');
            },
            'back-to-amount': () => renderWizardStep('deposit-amount'),
            'select-bank': () => {
                const bankSelect = document.getElementById('bank-select');
                const bank = bankSelect?.value;
                if (bank) selectedDepositBank = bank;
                renderWizardStep('deposit-details');
            },
            'back-to-bank': () => renderWizardStep('deposit-bank'),
            'close': hideFinanceWizard,
            'i-paid': () => {
                // имитация проверки оплаты
                showToast('Оплата не найдена. Проверьте реквизиты и комментарий к переводу.', 'error');
            },
            'confirm-withdraw-amount': () => {
                const amountInput = document.getElementById('withdraw-amount-input');
                const amount = parseFloat(amountInput.value);
                if (isNaN(amount) || amount <= 0) {
                    alert('Введите корректную сумму.');
                    return;
                }
                if (amount > currentUser.balance) {
                    alert('Недостаточно средств.');
                    return;
                }
                withdrawAmount = amount;
                renderWizardStep('withdraw-country');
            },
            'back-to-withdraw-amount': () => renderWizardStep('withdraw-amount'),
            'select-withdraw-country': () => renderWizardStep('withdraw-bank'),
            'back-to-withdraw-country': () => renderWizardStep('withdraw-country'),
            'select-withdraw-bank': () => renderWizardStep('withdraw-card'),
            'back-to-withdraw-bank': () => renderWizardStep('withdraw-bank'),
            'confirm-withdraw-card': () => {
                const cardNumberInput = document.getElementById('card-number-input');
                const cardNumber = cardNumberInput.value.replace(/\s/g, '');
                if (cardNumber.length !== 16 || isNaN(cardNumber)) {
                    alert('Введите корректный 16-значный номер карты.');
                    return;
                }
                // Здесь должна быть логика отправки запроса на сервер
                alert('Заявка на вывод успешно создана!');
                hideFinanceWizard();
            }
        };

        // Вызываем нужную функцию
        actions[action]?.();
    });

    // --- Инициализация ---
    loadProfileData();
    setupEventListeners();

    // По умолчанию активируем «Мои товары» и подгружаем их
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(cnt => cnt.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="items"]')?.classList.add('active');
    document.getElementById('items-content')?.classList.add('active');
    loadMyItems();

    /*
                        <button class="accent-btn" data-wizard-action="deposit">Пополнить</button>
                        <button class="accent-btn" data-wizard-action="withdraw">Вывести</button>
                    </div>
                </div>
            `;
            break;
        case 'deposit-country':
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-initial"><i class="fas fa-arrow-left"></i></button>
                        <h3>Выберите страну</h3>
                    </div>
                    <div class="custom-select-wrapper">
                        <select class="custom-select" id="country-select">
                            <option value="ru">Россия</option>
                            <option value="kz">Казахстан</option>
                            <option value="ua">Украина</option>
                        </select>
                    </div>
                    <button class="accent-btn" data-wizard-action="select-country">Далее</button>
                </div>
            `;
            break;
        case 'deposit-amount':
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-country"><i class="fas fa-arrow-left"></i></button>
                        <h3>Пополнение баланса</h3>
                    </div>
                    <p>Введите сумму для пополнения.</p>
                    <input type="number" class="form-input" placeholder="Например, 1000" id="deposit-amount-input">
                    <button class="accent-btn" data-wizard-action="confirm-deposit">Далее</button>
                </div>
            `;
            break;
        case 'deposit-bank':
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-amount"><i class="fas fa-arrow-left"></i></button>
                        <h3>Выберите банк</h3>
                    </div>
                    <div class="custom-select-wrapper">
                        <select class="custom-select" id="bank-select">
                            <option value="sber">Сбербанк</option>
                            <option value="tinkoff">Тинькофф</option>
                            <option value="alpha">Альфа-Банк</option>
                        </select>
                    </div>
                    <button class="accent-btn" data-wizard-action="select-bank">Получить реквизиты</button>
                </div>
            `;
            break;
        case 'deposit-details':
            const commentCode = Math.floor(10000 + Math.random() * 90000);
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-bank"><i class="fas fa-arrow-left"></i></button>
                        <h3>Реквизиты для пополнения</h3>
                    </div>
                    <div class="payment-details">
                        <p><strong>Карта для перевода:</strong> 1234 5678 1234 5678</p>
                        <p><strong>Сумма:</strong> ${depositAmount} RUB</p>
                        <p><strong>Обязательный комментарий к переводу:</strong> ${commentCode}</p>
                    </div>
                    <button class="accent-btn" data-wizard-action="close">Готово</button>
                </div>
            `;
            break;
        case 'withdraw-amount':
            // For now, we assume a static balance. This should be fetched from the server.
            const userBalance = 5000;
            content = `
                </div>
                <div class="custom-select-wrapper">
                    <select class="custom-select" id="bank-select">
                        <option value="sber">Сбербанк</option>
                        <option value="tinkoff">Тинькофф</option>
                        <option value="alpha">Альфа-Банк</option>
                    </select>
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-amount"><i class="fas fa-arrow-left"></i></button>
                        <h3>Выберите страну</h3>
                    </div>
                    <div class="custom-select-wrapper">
                        <select class="custom-select" id="withdraw-country-select">
                            <option value="ru">Россия</option>
                            <option value="kz">Казахстан</option>
                            <option value="ua">Украина</option>
                        </select>
                    </div>
                    <button class="accent-btn" data-wizard-action="select-withdraw-country">Далее</button>
                </div>
            `;
            break;
        case 'withdraw-bank':
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-country"><i class="fas fa-arrow-left"></i></button>
                        <h3>Выберите банк</h3>
                    </div>
                    <div class="custom-select-wrapper">
                        <select class="custom-select" id="withdraw-bank-select">
                            <option value="sber">Сбербанк</option>
                            <option value="tinkoff">Тинькофф</option>
                            <option value="alpha">Альфа-Банк</option>
                        </select>
                    </div>
                    <button class="accent-btn" data-wizard-action="select-withdraw-bank">Далее</button>
                </div>
            `;
            break;
        case 'withdraw-card':
            content = `
                <div class="wizard-step">
                    <div class="wizard-header">
                        <button class="wizard-back-btn" data-wizard-action="back-to-withdraw-bank"><i class="fas fa-arrow-left"></i></button>
                        <h3>Введите номер карты</h3>
                    </div>
                    <input type="text" class="form-input" placeholder="16-значный номер карты" id="card-number-input" maxlength="16">
                    <button class="accent-btn" data-wizard-action="confirm-withdraw-card">Подтвердить вывод</button>
                </div>
            `;
            break;
        // More steps will be added here
        }
        if (wizardContent) {
            wizardContent.innerHTML = content;
        }
    };
    if (wizardContent) {
        renderWizardStep('initial'); // Render the initial step when the modal is shown

        wizardContent.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            const action = target.dataset.wizardAction;
            if (!action) return;

            switch (action) {
                case 'deposit':
                    renderWizardStep('deposit-country');
                    break;
                case 'withdraw':
                    renderWizardStep('withdraw-amount');
                    break;
                case 'back-to-initial':
                    renderWizardStep('initial');
                    break;
                case 'select-country': {
                    const country = document.getElementById('country-select').value;
                    console.log(`Selected country: ${country}`);
                    renderWizardStep('deposit-amount');
                    break;
                }
                case 'back-to-country':
                    renderWizardStep('deposit-country');
                    break;
                case 'confirm-deposit':
                    const amountInput = document.getElementById('deposit-amount-input');
                    const amount = amountInput.value;
                    if (!amount || parseFloat(amount) <= 0) {
                        alert('Пожалуйста, введите корректную сумму.');
                        return;
                    }
                    depositAmount = parseFloat(amount);
                    console.log(`Deposit amount: ${depositAmount}`);
                    renderWizardStep('deposit-bank');
                    break;
                case 'back-to-amount':
                    renderWizardStep('deposit-amount');
                    break;
                case 'select-bank':
                    const bank = document.getElementById('bank-select').value;
                    console.log(`Selected bank: ${bank}`);
                    renderWizardStep('deposit-details');
                    break;
                case 'back-to-bank':
                    renderWizardStep('deposit-bank');
                    break;
                case 'close':
                    hideFinanceWizard();
                    break;
                case 'confirm-withdraw-amount':
                    const amountToWithdraw = document.getElementById('withdraw-amount-input').value;
                    const userBalance = currentUser.balance || 0;
                    if (!amountToWithdraw || parseFloat(amountToWithdraw) <= 0) {
                        alert('Пожалуйста, введите корректную сумму.');
                        return;
                    }
                    if (parseFloat(amountToWithdraw) > userBalance) {
                        alert('Недостаточно средств на балансе.');
                        return;
                    }
                    withdrawAmount = parseFloat(amountToWithdraw);
                    console.log(`Withdraw amount: ${withdrawAmount}`);
                    renderWizardStep('withdraw-country');
                    break;
                case 'back-to-withdraw-amount':
                    renderWizardStep('withdraw-amount');
                    break;
                case 'select-withdraw-country': {
                    const country = document.getElementById('withdraw-country-select').value;
                    console.log(`Selected withdraw country: ${country}`);
                    renderWizardStep('withdraw-bank');
                    break;
                }
                case 'back-to-withdraw-country':
                    renderWizardStep('withdraw-country');
                    break;
                case 'select-withdraw-bank': {
                    const bank = document.getElementById('withdraw-bank-select').value;
                    console.log(`Selected withdraw bank: ${bank}`);
                    renderWizardStep('withdraw-card');
                    break;
                }
                case 'back-to-withdraw-bank':
                    renderWizardStep('withdraw-bank');
                    break;
                case 'confirm-withdraw-card': {
                    const cardNumber = document.getElementById('card-number-input').value;
                    if (!cardNumber || cardNumber.length !== 16 || !/^[0-9]+$/.test(cardNumber)) {
                        alert('Пожалуйста, введите корректный 16-значный номер карты.');
                        return;
                    }
                    console.log(`Card number: ${cardNumber}`);
                    alert('Заявка на вывод успешно создана!');
                    hideFinanceWizard();
                    break;
                }
            }
        });
    }

*/
  // --- Fancy nav bubble effect for profile bottom-nav ---
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
    const hue = Math.floor(Math.random() * 360);
    const sat = 70 + Math.floor(Math.random() * 20);
    const light = 55 + Math.floor(Math.random() * 15);
    return `hsl(${hue} ${sat}% ${light}%)`;
  };

  const colorForNavEl = (el) => {
    const href = (el.getAttribute('href') || '').toLowerCase();
    if (href.includes('#sell')) return 'hsl(28 90% 55%)';
    if (href.includes('#deals')) return 'hsl(150 65% 45%)';
    if (href.includes('#') || href.includes('index.html')) return 'hsl(210 85% 55%)';
    // Текущая страница профиль — кнопка без href
    return 'hsl(268 70% 60%)';
  };

  let stickyBubble = null;
  const positionStickyBubble = (btn) => {
    const layer = ensureBubbleLayer();
    if (!layer || !btn) return;
    const wrap = document.querySelector('.nav-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const cx = btnRect.left + btnRect.width / 2 - wrapRect.left;
    const yOffset = -32; // ещё выше центра
    const cy = btnRect.top + btnRect.height / 2 - wrapRect.top + yOffset;
    if (!stickyBubble) {
      stickyBubble = document.createElement('div');
      stickyBubble.className = 'nav-bubble sticky';
      const icon = btn.querySelector('i');
      if (icon) stickyBubble.appendChild(icon.cloneNode(true));
      layer.appendChild(stickyBubble);
    } else {
      const icon = btn.querySelector('i');
      stickyBubble.innerHTML = '';
      if (icon) stickyBubble.appendChild(icon.cloneNode(true));
    }
    stickyBubble.style.background = colorForNavEl(btn);
    stickyBubble.style.left = `${cx}px`;
    stickyBubble.style.top = `${cy}px`;
  };

  // Инициализация закреплённого пузырька на активной кнопке (профиль)
  const activeBtn = document.querySelector('.bottom-nav .nav-btn.active');
  if (activeBtn) positionStickyBubble(activeBtn);

  document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const href = btn.getAttribute('href');
      if (href) {
        e.preventDefault();
        // Плавно перевезём пузырёк на выбранную вкладку, затем перейдём
        positionStickyBubble(btn);
        setTimeout(() => { window.location.href = href; }, 180);
      }
    });
  });

  window.addEventListener('resize', () => {
    const active = document.querySelector('.bottom-nav .nav-btn.active');
    if (active) positionStickyBubble(active);
  });
});