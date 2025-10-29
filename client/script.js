/* полный файл без изменений логики (панель фиксируется стилями)
   ─ см. ваш исходный script.js ─ */
class ChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.avatarBase64 = null;
        this.isMobile = window.innerWidth <= 768;
        this.sidebarVisible = !this.isMobile;
        this.isConnected = false;
        this.eventListeners = new Map();
        this.scrollButton = null;
        this.isStoryteller = false;
        this.messageSender = 'self';
        this.customSenderName = '';
        this.initializeApp();
    }

    initializeApp() {
        this.setVhUnit();
        window.addEventListener('resize', this.setVhUnit, { passive: true });
        window.addEventListener('orientationchange', this.setVhUnit, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this.setVhUnit, { passive: true });
            window.visualViewport.addEventListener('scroll', this.setVhUnit, { passive: true });
        }

        this.setupEventListeners();
        this.checkExistingSession();
        this.setupGlobalEventListeners();
        this.createScrollButton();
        this.handleChatScroll();
    }

    setVhUnit = () => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        // После смены высоты пересчитаем контейнер и актуализируем видимость кнопки
        this.setupChatContainer();
        this.handleChatScroll();
    }

    setupGlobalEventListeners() {
        window.addEventListener('resize', this.handleResize.bind(this));

        document.addEventListener('click', (e) => {
            if (this.isMobile && this.sidebarVisible &&
                !e.target.closest('#sidebar') &&
                !e.target.closest('.mobile-menu-btn')) {
                this.hideSidebar();
            }
            if (e.target.id === 'user-profile-modal') {
                this.closeUserProfile();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeUserProfile();
                if (this.isMobile && this.sidebarVisible) {
                    this.hideSidebar();
                }
            }
        });

        this.addEventListener('sheet-upload-btn', 'click', () => {
            const inp = document.getElementById('sheet-file-input');
            if (inp) inp.click();
        });

        this.addEventListener('sheet-file-input', 'change', (e) => {
            const file = e.target.files?.[0];
            if (file) this.handleSheetUpload(file);
        });
    }

    createScrollButton() {
        if (this.scrollButton) this.scrollButton.remove();
        this.scrollButton = document.createElement('button');
        this.scrollButton.id = 'scroll-to-bottom';
        this.scrollButton.type = 'button';
        this.scrollButton.title = 'Прокрутить вниз';
        this.scrollButton.setAttribute('aria-label', 'Прокрутить вниз');
        this.scrollButton.className = 'scroll-to-bottom-button';
        // иконка (маска задаётся в CSS)
        const icon = document.createElement('span');
        icon.className = 'scroll-icon';
        this.scrollButton.appendChild(icon);
        // универсальный обработчик для тача/клика
        const handle = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); this.scrollToBottom(true); };
        this.scrollButton.addEventListener('pointerup', handle, { passive: false });
        this.scrollButton.addEventListener('touchend',  handle, { passive: false });
        this.scrollButton.addEventListener('click',     handle, { passive: false });
        // прячем по умолчанию — покажем логикой скролла
        document.body.appendChild(this.scrollButton);
    }

    scrollToBottom(force = false) {
        const container = document.getElementById('chat-container');
        if (!container) return;
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (force || distance < 150) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
        if (this.scrollButton) this.scrollButton.classList.remove('visible');
    }


    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;
        if (wasMobile !== this.isMobile) {
            this.isMobile ? this.optimizeForMobile() : this.optimizeForDesktop();
        }
    }

    optimizeForMobile() {
        const mobileUsersBtn = document.getElementById('mobile-users-btn');
        if (mobileUsersBtn) mobileUsersBtn.classList.remove('visible');
        this.setupChatContainer();
        this.handleChatScroll();
    }

    optimizeForDesktop() {
        const mobileUsersBtn = document.getElementById('mobile-users-btn');
        if (mobileUsersBtn) mobileUsersBtn.style.display = 'block';
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) chatContainer.style.height = '';
    }

    setupMessageInputListeners() {
        const input = document.getElementById('message-input');
        if (!input) return;

        input.addEventListener('input', () => this.autoResizeMessageInput());

        input.addEventListener('keydown', (e) => {
            if (!this.isMobile) {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            } else {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            }
        });

        input.addEventListener('focus', () => {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        this.autoResizeMessageInput();
    }

    setupChatContainer() {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;

        // Используем кастомный vh, чтобы на iOS/Android не прыгала высота при появлении/скрытии адресной строки
        chatContainer.style.height = 'calc(var(--vh, 1vh) * 100 - 140px)';
        chatContainer.style.overflowY = 'auto';
        chatContainer.style.webkitOverflowScrolling = 'touch';
        
        chatContainer.addEventListener('scroll', () => {
            this.handleChatScroll();
        }, { passive: true });
        this.handleChatScroll();
    }

    // handleChatScroll() {
    //     const container = document.getElementById('chat-container');
    //     if (!container || !this.scrollButton) return;
    //     // Предохраняемся от «резинового» скролла iOS (отрицательные значения)
    //     const raw = container.scrollHeight - container.scrollTop - container.clientHeight;
    //     const distance = Math.max(0, raw);
    //     const hasOverflow = (container.scrollHeight - container.clientHeight) > 1;
    //     // Порог поменьше, чтобы на компактных экранах кнопка не исчезала из-за округлений
    //     const shouldShow = hasOverflow && distance > 40;
    //     this.scrollButton.classList.toggle('visible', shouldShow);
    // }

    handleChatScroll() {
        const container = document.getElementById('chat-container');
        if (!container || !this.scrollButton) return;
        // защита от «резинового» скролла iOS
        const raw = container.scrollHeight - container.scrollTop - container.clientHeight;
        const distance = Math.max(0, raw);
        const hasOverflow = (container.scrollHeight - container.clientHeight) > 1;
        const shouldShow = hasOverflow && distance > 40;
        this.scrollButton.classList.toggle('visible', shouldShow);
    }

    setupEventListeners() {
        this.addEventListener('login-form', 'submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        this.addEventListener('avatar-upload', 'change', (e) => {
            this.handleAvatarUpload(e.target.files[0]);
        });

        this.addEventListener('mobile-menu-btn', 'click', () => {
            this.toggleSidebar();
        });

        this.addEventListener('profile-modal-close', 'click', () => {
            this.closeUserProfile();
        });
    }

    addEventListener(elementId, event, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener(event, handler);
            if (!this.eventListeners.has(elementId)) {
                this.eventListeners.set(elementId, []);
            }
            this.eventListeners.get(elementId).push({ event, handler });
        }
    }

    removeEventListeners() {
        for (const [elementId, listeners] of this.eventListeners) {
            const element = document.getElementById(elementId);
            if (element) {
                listeners.forEach(({ event, handler }) => {
                    element.removeEventListener(event, handler);
                });
            }
        }
        this.eventListeners.clear();
    }

    setupChatEventListeners() {
        this.removeChatEventListeners();

        const chatHandlers = {
            'send-btn': () => this.sendMessage(),
            'upload-btn': () => document.getElementById('file-input').click(),
            'file-input': (e) => this.handleFileUpload(e.target.files[0]),
            'edit-profile-btn': () => this.editProfile(),
            'logout-btn': () => this.logout(),
            'dice-roll-btn': () => this.rollDice(),
            'message-sender': (e) => this.handleSenderChange(e.target.value)
        };

        Object.entries(chatHandlers).forEach(([id, handler]) => {
            const eventType = id === 'message-input' ? 'keypress' : 
                id === 'message-sender' ? 'change' : 'click';
            this.addChatEventListener(id, eventType, handler);
        });

        // Особый случай для custom-sender
        const customSender = document.getElementById('custom-sender');
        if (customSender) {
            customSender.addEventListener('input', (e) => {
                this.customSenderName = e.target.value.trim();
            });
            customSender.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        }

        this.setupChatContainer();

        const ta = document.getElementById('message-input');
        if (ta) {
            // Автоподгон высоты при наборе
            ta.addEventListener('input', () => this.autoResizeMessageInput());
            // Первичная установка (и после смены placeholder)
            this.autoResizeMessageInput();

            // Горячие клавиши:
            ta.addEventListener('keydown', (e) => {
                // ПК: отправка Ctrl+Enter, обычный Enter — новая строка
                if (!this.isMobile) {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                    return; // на ПК Enter без Ctrl не трогаем — даём писать абзацы
                }

                // Мобильные: Enter отправляет, Shift+Enter — перенос строки
                if (this.isMobile) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                }
            });
        }
    }

    addChatEventListener(elementId, event, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener(event, handler);
            if (!this.eventListeners.has(elementId)) {
                this.eventListeners.set(elementId, []);
            }
            this.eventListeners.get(elementId).push({ event, handler });
        }
    }

    removeChatEventListeners() {
        const chatElements = [
            'send-btn', 'message-input', 'upload-btn', 'file-input',
            'edit-profile-btn', 'logout-btn', 'dice-roll-btn', 'chat-container',
            'message-sender', 'custom-sender'
        ];

        chatElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                const newElement = element.cloneNode(true);
                element.parentNode.replaceChild(newElement, element);
            }
        });
    }

    toggleSidebar() {
        this.sidebarVisible ? this.hideSidebar() : this.showSidebar();
    }

    showSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.add('active');
            this.sidebarVisible = true;
            if (this.isMobile) document.body.style.overflow = 'hidden';
        }
    }

    hideSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.remove('active');
            this.sidebarVisible = false;
            if (this.isMobile) {
                document.body.style.overflow = '';
                setTimeout(() => this.scrollToBottom(true), 100);
            }
        }
    }

    checkExistingSession() {
        const savedUser = localStorage.getItem('chatUser');
        if (savedUser) {
            try {
                this.currentUser = JSON.parse(savedUser);
                this.connectToChat();
            } catch (error) {
                localStorage.removeItem('chatUser');
            }
        }
    }

    async handleLogin() {
        const name = document.getElementById('character-name').value.trim();
        const description = document.getElementById('character-description').value.trim();

        if (!name) {
            alert('Пожалуйста, введите имя персонажа');
            return;
        }

        let characterData = await this.loadCharacter(name);
        let avatarUrl = characterData?.avatar || '/uploads/default-avatar.png';
        let finalDescription = characterData?.description || description;
        let sheetUrl = characterData?.sheet || '';
        if (this.avatarBase64) {
            avatarUrl = await this.uploadAvatar(name);
        }

        if (!characterData && !this.avatarBase64) {
            await this.createCharacter(name, avatarUrl, finalDescription);
        }

        this.currentUser = {
            name,
            avatar: avatarUrl,
            description: finalDescription,
            sheet: sheetUrl,
            isStoryteller: name === 'Рассказчик'
        };

        localStorage.setItem('chatUser', JSON.stringify(this.currentUser));
        this.connectToChat();
    }

    async loadCharacter(name) {
        try {
            const response = await fetch(`/character/${encodeURIComponent(name)}`);
            return response.ok ? await response.json() : null;
        } catch (error) {
            return null;
        }
    }

    async uploadAvatar(characterName) {
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file: this.avatarBase64,
                    filename: 'avatar.png',
                    characterName
                })
            });
            const result = await response.json();
            return result.url;
        } catch (error) {
            return '/uploads/default-avatar.png';
        }
    }

    async createCharacter(name, avatar, description) {
        try {
            await fetch(`/character/${encodeURIComponent(name)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatar, description })
            });
        } catch (error) {
            console.error('Error creating character:', error);
        }
    }

    connectToChat() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('chat-interface').classList.remove('hidden');

        if (this.isMobile) this.optimizeForMobile();

        this.setupChatEventListeners();
        this.updateUserProfile();
        this.setupSocketHandlers();

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.socket.emit('user-join', this.currentUser);
            
            if (this.currentUser.isStoryteller) {
                this.showStorytellerControls();
                // Инициализируем поле как disabled
                const customSender = document.getElementById('custom-sender');
                if (customSender) {
                    customSender.disabled = true;
                    customSender.placeholder = "Выберите 'От другого имени'";
                }
            }
        });
    }

    setupSocketHandlers() {
        if (!this.socket) return;

        this.socket.removeAllListeners();

        const handlers = {
            'chat-history': (history) => {
                this.displayChatHistory(history);
            },
            'new-message': (message) => {
                const c = document.getElementById('chat-container');
                const nearBottom = !c
                  || (c.scrollHeight - c.scrollTop - c.clientHeight) < 120;
                this.displayMessage(message);
                if (nearBottom) {
                    this.scrollToBottom(true);
                } else {
                    // пользователь читает историю — не автоскроллим, просто обновим состояние кнопки
                    this.handleChatScroll();
                }
            },
            'message-edited': (message) => {
                this.updateMessage(message);
            },
            'users-list': (users) => {
                this.updateUsersList(users);
            },
            'user-joined': (user) => {
                this.addUserToList(user);
                this.displaySystemMessage(`${user.name} присоединился к чату`);
            },
            'user-left': (userId) => {
                this.removeUserFromList(userId);
                this.displaySystemMessage('Пользователь покинул чат');
            },
            'user-updated': (user) => {
                this.updateUserInList(user);
            },
            'connect_error': (error) => {
                alert('Ошибка подключения к серверу');
            },
            'disconnect': () => {
                this.isConnected = false;
            },
            'connect': () => {
                this.isConnected = true;
            }
        };

        Object.entries(handlers).forEach(([event, handler]) => {
            this.socket.on(event, handler);
        });
    }

    handleSenderChange(senderType) {
        this.messageSender = senderType;
        const customSender = document.getElementById('custom-sender');
        
        if (senderType === 'other') {
            customSender.disabled = false;
            customSender.placeholder = "Введите имя отправителя...";
            customSender.focus();
        } else {
            customSender.disabled = true;
            customSender.value = '';
            customSender.placeholder = "Выберите 'От другого имени'";
        }
        
        this.updateMessageInputPlaceholder();
    }

    updateMessageInputPlaceholder() {
        const input = document.getElementById('message-input');
        switch (this.messageSender) {
            case 'anonymous':
                input.placeholder = 'Опишите ситуацию или окружение...';
                break;
            case 'other':
                input.placeholder = 'Сообщение от другого имени...';
                break;
            default:
                input.placeholder = 'Шепот в темноте...';
        }
    }

    showStorytellerControls() {
        const controls = document.getElementById('storyteller-controls');
        controls.classList.remove('hidden');
        this.isStoryteller = true;
        this.updateMessageInputPlaceholder();
    }

    handleAvatarUpload(file) {
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('avatar-preview').innerHTML = 
                    `<img src="${e.target.result}" alt="Preview">`;
                this.avatarBase64 = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    }

    async handleSheetUpload(file) {
        if (!file) return;
        if (!this.currentUser?.name) {
            alert('Сессия пользователя не найдена');
            return;
        }

        // Предупреждение при перезаписи
        if (this.currentUser.sheet) {
            const ok = confirm('Лист уже загружен. Перезаписать?');
            if (!ok) return;
        }

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
            const response = await fetch('/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                file: e.target.result,
                filename: 'sheet.png',            // ключевое слово "sheet" — сервер поймёт
                characterName: this.currentUser.name
                })
            });
            const result = await response.json();

            if (result?.url) {
                // Локально обновим currentUser и localStorage
                this.currentUser.sheet = result.url;
                localStorage.setItem('chatUser', JSON.stringify(this.currentUser));

                // На всякий — пропишем и в персонажа на сервере (не обязательно, но полезно)
                await fetch(`/character/${encodeURIComponent(this.currentUser.name)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sheet: result.url })
                });

                // ⬇️ Перечитаем профиль с сервера, чтобы избежать расхождений
                const fresh = await this.loadCharacter(this.currentUser.name);
                if (fresh && fresh.sheet) {
                    this.currentUser.sheet = fresh.sheet;
                    localStorage.setItem('chatUser', JSON.stringify(this.currentUser));
                }

                // Обновим модалку "на лету"
                const sheetImg = document.getElementById('profile-modal-sheet');
                const sheetEmpty = document.getElementById('profile-modal-sheet-empty');
                const openBtn = document.getElementById('sheet-open-btn');

                if (sheetImg) {
                sheetImg.src = result.url;
                sheetImg.classList.remove('hidden');
                }
                if (sheetEmpty) sheetEmpty.classList.add('hidden');
                if (openBtn) {
                openBtn.href = result.url;
                openBtn.classList.remove('hidden');
                }

                alert('Лист персонажа обновлён');
            } else {
                alert('Не удалось загрузить лист персонажа');
            }
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error(err);
            alert('Ошибка при загрузке листа персонажа');
        } finally {
            // Сброс input, чтобы при выборе того же файла событие сработало снова
            const inp = document.getElementById('sheet-file-input');
            if (inp) inp.value = '';
        }
    }

    async handleFileUpload(file) {
        if (!file) return;

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const response = await fetch('/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file: e.target.result,
                        filename: file.name
                    })
                });
                const result = await response.json();
                
                this.socket.emit('send-file', {
                    filename: result.filename,
                    originalName: result.originalName,
                    url: result.url
                });
            };
            reader.readAsDataURL(file);
        } catch (error) {
            alert('Ошибка при загрузке файла');
        }
    }

    sendMessage() {
        if (!this.isConnected) {
            alert('Нет подключения к серверу');
            return;
        }

        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (text) {
            // Валидация для отправки от другого имени
            if (this.messageSender === 'other') {
                const customSender = document.getElementById('custom-sender');
                const senderName = customSender.value.trim();
                
                if (!senderName) {
                    alert('Пожалуйста, введите имя отправителя');
                    customSender.focus();
                    return;
                }
                
                this.customSenderName = senderName;
            }
            
            const messageData = {
                text: text,
                senderType: this.messageSender,
                customSender: this.customSenderName
            };
            
            this.socket.emit('send-message', messageData);
            input.value = '';
            
            if (this.isMobile) {
                input.blur();
                setTimeout(() => this.scrollToBottom(true), 100);
            }
        }
    }

    rollDice() {
        const diceCount = prompt('Введите количество кубиков d10 (1-15):', '5');
        const count = parseInt(diceCount);
        
        if (count >= 1 && count <= 15) {
            this.socket.emit('roll-dice', count);
        } else if (diceCount !== null) {
            alert('Пожалуйста, введите число от 1 до 15');
        }
    }

    editMessage(messageId, currentText) {
        const newText = prompt('Редактировать сообщение:', currentText);
        if (newText !== null && newText.trim() !== '') {
            this.socket.emit('edit-message', {
                messageId: messageId,
                newText: newText.trim()
            });
        }
    }

    isDefaultAvatar(url) {
        // всё, что считаем "нет аватара"
        return !url || url === '/uploads/default-avatar.png';
    }

    getInitial(name = '') {
        const s = name.trim();
        return s ? s[0].toUpperCase() : '?';
    }

    createAvatarHTML(name, url, context) {
        // context: 'message' | 'userlist' | 'profile'
        const initial = this.getInitial(name);

        if (this.isDefaultAvatar(url)) {
            const sizeClass =
                context === 'message' ? 'avatar-initials--sm' :
                context === 'userlist' ? 'avatar-initials--md' :
                /* profile / default */   'avatar-initials--lg';

            // ВАЖНО: добавляем user-avatar, чтобы сработали размеры в CSS контейнеров
            return `<div class="user-avatar avatar-initials ${sizeClass}" aria-hidden="true">${initial}</div>`;
        }

        // Для изображений тоже всегда включаем user-avatar,
        // и при необходимости — доп.класс (например, message-avatar для сообщений)
        const extra =
            context === 'message' ? 'message-avatar' : '';
        return `<img src="${url}" alt="${name}" class="user-avatar ${extra}">`;
    } 

    async showUserProfile(user) {
        // Перед показом модалки перечитаем карточку с сервера,
        // чтобы гарантированно получить актуальный sheet/описание/аватар
        let profile = user;
        try {
            const fresh = await this.loadCharacter(user.name);
            if (fresh) {
                profile = {
                    ...user,
                    avatar: fresh.avatar || user.avatar,
                    description: fresh.description ?? user.description,
                    sheet: fresh.sheet || user.sheet
                };
                // Если это наш текущий пользователь — синхронизируем localStorage
                if (this.currentUser && this.currentUser.name === user.name) {
                    this.currentUser.avatar = profile.avatar;
                    this.currentUser.description = profile.description || '';
                    this.currentUser.sheet = profile.sheet || '';
                    localStorage.setItem('chatUser', JSON.stringify(this.currentUser));
                }
            }
        } catch (e) { /* no-op */ }

        // 1) Берём аватар модалки по id
        const profileAvatar = document.getElementById('profile-modal-avatar');
        const nameEl = document.getElementById('profile-modal-name');
        const descEl = document.getElementById('profile-modal-description');
        const storytellerBadge = document.getElementById('profile-modal-storyteller');

        // Защита от отсутствующих нод — чтобы не падало, а просто молча не открылось
        if (!profileAvatar || !nameEl || !descEl || !storytellerBadge) {
            console.warn('Profile modal elements not found');
            return;
        }

        // 2) Собираем HTML для аватара и заменяем узел в модалке
        const html = this.createAvatarHTML(profile?.name, profile?.avatar, 'user-avatar');
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const node = tmp.firstChild;
        node.id = 'profile-modal-avatar';

        const parent = profileAvatar.parentElement;
        parent.replaceChild(node, profileAvatar);

        // 3) Заполняем остальное
        nameEl.textContent = profile.name;
        descEl.textContent = profile.description || 'Описание отсутствует';
        storytellerBadge.classList[profile.isStoryteller ? 'remove' : 'add']('hidden');

        // 3.bis) Лист персонажа — проставляем превью и ссылку
        const sheetImg = document.getElementById('profile-modal-sheet');
        const sheetEmpty = document.getElementById('profile-modal-sheet-empty');
        const openBtn = document.getElementById('sheet-open-btn');
        const sheetUrl = profile.sheet || '';

        if (sheetUrl) {
            if (sheetImg) { sheetImg.src = sheetUrl; sheetImg.classList.remove('hidden'); }
            if (sheetEmpty) sheetEmpty.classList.add('hidden');
            if (openBtn) { openBtn.href = sheetUrl; openBtn.classList.remove('hidden'); }
        } else {
            if (sheetImg) { sheetImg.src = ''; sheetImg.classList.add('hidden'); }
            if (sheetEmpty) sheetEmpty.classList.remove('hidden');
            if (openBtn) openBtn.classList.add('hidden');
        }

        // 4) Показываем модалку и прячем сайдбар на мобиле
        document.getElementById('user-profile-modal').classList.remove('hidden');
        if (this.isMobile) this.hideSidebar();
    }

    closeUserProfile() {
        document.getElementById('user-profile-modal').classList.add('hidden');
    }

    async editProfile() {
        const newName = prompt('Новое имя персонажа:', this.currentUser.name);
        if (newName === null) return;

        const newDescription = prompt('Новое описание:', this.currentUser.description);
        
        let newAvatar = this.currentUser.avatar;
        
        if (this.avatarBase64) {
            newAvatar = await this.uploadAvatar(newName);
        }

        await this.createCharacter(newName, newAvatar, newDescription || '');

        this.currentUser.name = newName;
        this.currentUser.description = newDescription || '';
        this.currentUser.avatar = newAvatar;
        this.currentUser.isStoryteller = newName === 'Рассказчик';
        
        localStorage.setItem('chatUser', JSON.stringify(this.currentUser));
        this.updateUserProfile();
        
        this.socket.emit('update-profile', {
            name: newName,
            avatar: newAvatar,
            description: newDescription
        });

        this.avatarBase64 = null;
        document.getElementById('avatar-preview').innerHTML = '';
    }

    displayChatHistory(history) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        
        container.innerHTML = '';
        history.forEach(message => this.displayMessage(message));
        setTimeout(() => this.scrollToBottom(true), 100);
        this.handleChatScroll();
    }

    displayMessage(message) {
        const container = document.getElementById('messages-container');
        if (!container) return;

        const messageElement = document.createElement('div');
        messageElement.className = `message ${this.getMessageClasses(message)}`;
        messageElement.id = `message-${message.id}`;
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        
        if (message.type === 'file') {
            messageElement.innerHTML = this.createFileMessageHTML(message, time);
        } else if (message.type === 'dice') {
            messageElement.innerHTML = this.createDiceMessageHTML(message, time);
        } else {
            messageElement.innerHTML = this.createTextMessageHTML(message, time);
        }
        
        container.appendChild(messageElement);
        this.handleChatScroll();
    }

    getMessageClasses(message) {
        const classes = [];
        if (message.type === 'file') classes.push('file-message');
        if (message.type === 'dice') classes.push('dice-message');
        if (message.senderType === 'anonymous') classes.push('anonymous');
        if (message.senderType === 'other') classes.push('other-sender');
        return classes.join(' ');
    }

    createFileMessageHTML(message, time) {
        const displayName = message.senderType === 'other' ? message.customSender : message.user.name;
        
        // Для сообщений от другого имени убираем аватарку
        if (message.senderType === 'other') {
            return `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-user other-sender-name">${displayName}</span>
                        <span class="message-time">${time}</span>
                        ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'\')">✏️</button>' : ''}
                    </div>
                    <div class="message-text">
                        📎 <a href="${message.file.url}" class="file-link" target="_blank">${message.file.originalName}</a>
                    </div>
                </div>
            `;
        }
        
        // Обычное сообщение с аватаркой
        return `
            ${this.createAvatarHTML(displayName, message.user.avatar, 'message-avatar')}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-user">${displayName}</span>
                    <span class="message-time">${time}</span>
                    ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'\')">✏️</button>' : ''}
                </div>
                <div class="message-text">
                    📎 <a href="${message.file.url}" class="file-link" target="_blank">${message.file.originalName}</a>
                </div>
            </div>
        `;
    }

    createDiceMessageHTML(message, time) {
        const roll = message.rollResult;
        const successClass = roll.totalSuccesses >= 5 ? 'dice-success' : roll.totalSuccesses >= 3 ? 'dice-good' : 'dice-fail';
        
        const displayName = message.senderType === 'other' ? message.customSender : message.user.name;
        
        // Для сообщений от другого имени убираем аватарку
        if (message.senderType === 'other') {
            return `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-user other-sender-name">${displayName}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="dice-roll ${successClass}">
                        <div class="dice-header">
                            🎲 Бросок ${message.diceCount}d10
                            <span class="success-count">Успехов: ${roll.totalSuccesses}</span>
                        </div>
                        <div class="dice-results">
                            <div class="dice-set">
                                <strong>Основные кубики:</strong>
                                ${roll.initial.map(r => `<span class="dice ${r >= 8 ? 'success' : r === 10 ? 'explode' : ''}">${r}</span>`).join('')}
                            </div>
                            ${roll.extra.length > 0 ? `
                            <div class="dice-set">
                                <strong>Дополнительные (за 10):</strong>
                                ${roll.extra.map(r => `<span class="dice ${r >= 8 ? 'success' : r === 10 ? 'explode' : ''}">${r}</span>`).join('')}
                            </div>
                            ` : ''}
                        </div>
                        <div class="dice-summary">
                            Всего успехов: ${roll.totalSuccesses} 
                            (${roll.initialSuccesses} основных + ${roll.extraSuccesses} дополнительных)
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Обычное сообщение с аватаркой
        return `
            ${this.createAvatarHTML(displayName, message.user.avatar, 'message-avatar')}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-user">${displayName}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="dice-roll ${successClass}">
                    <div class="dice-header">
                        🎲 Бросок ${message.diceCount}d10
                        <span class="success-count">Успехов: ${roll.totalSuccesses}</span>
                    </div>
                    <div class="dice-results">
                        <div class="dice-set">
                            <strong>Основные кубики:</strong>
                            ${roll.initial.map(r => `<span class="dice ${r >= 8 ? 'success' : r === 10 ? 'explode' : ''}">${r}</span>`).join('')}
                        </div>
                        ${roll.extra.length > 0 ? `
                        <div class="dice-set">
                            <strong>Дополнительные (за 10):</strong>
                            ${roll.extra.map(r => `<span class="dice ${r >= 8 ? 'success' : r === 10 ? 'explode' : ''}">${r}</span>`).join('')}
                        </div>
                        ` : ''}
                    </div>
                    <div class="dice-summary">
                        Всего успехов: ${roll.totalSuccesses} 
                        (${roll.initialSuccesses} основных + ${roll.extraSuccesses} дополнительных)
                    </div>
                </div>
            </div>
        `;
    }


    
    createTextMessageHTML(message, time) {
        const editedInfo = message.edited ? `<span class="edited-info">(ред.)</span>` : '';
        const safeHtml = this.escapeHtml(message.text).replace(/\n/g, '<br>');


        if (message.senderType === 'anonymous') {
            return `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-text anonymous-message-text">
                        ${this.escapeHtml(message.text).replace(/\n/g, '<br>')}
                    </div>
                </div>
            `;
        }



        const displayName = message.senderType === 'other' ? message.customSender : message.user.name;


        if (message.senderType === 'other') {
            return `
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-user other-sender-name">${displayName}</span>
                        <span class="message-time">${time} ${editedInfo}</span>
                        ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'${this.escapeHtml(message.text)}\')">✏️</button>' : ''}
                    </div>
                    <div class="message-text">${safeHtml}</div>
                </div>
            `;
        }


        return `
            ${this.createAvatarHTML(displayName, message.user.avatar, 'message-avatar')}
            <div class="message-content">
                <div class="message-header">
                    <span class="message-user">${displayName}</span>
                    <span class="message-time">${time} ${editedInfo}</span>
                    ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'${this.escapeHtml(message.text)}\')">✏️</button>' : ''}
                </div>
                <div class="message-text">${safeHtml}</div>
            </div>
            `;
        }

    updateMessage(message) {
        const messageElement = document.getElementById(`message-${message.id}`);
        if (messageElement) {
            const textElement = messageElement.querySelector('.message-text');
            const timeElement = messageElement.querySelector('.message-time');
            
            if (textElement) {
                textElement.textContent = message.text;
            }
            
            if (timeElement && message.edited) {
                const editedTime = new Date(message.editTimestamp).toLocaleTimeString();
                timeElement.innerHTML = `${timeElement.textContent.split('(')[0]} (ред. ${message.editedBy} в ${editedTime})`;
            }
        }
    }

    displaySystemMessage(text) {
        const container = document.getElementById('messages-container');
        if (!container) return;

        const messageElement = document.createElement('div');
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="message-text" style="text-align: center; color: var(--cod-text-secondary); font-style: italic;">
                    ${text}
                </div>
            </div>
        `;
        container.appendChild(messageElement);
        this.scrollToBottom();
    }

    updateUserProfile() {
        const userAvatarEl = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');

        if (userAvatarEl) {
            const wrapper = userAvatarEl.parentElement;
            const html = this.createAvatarHTML(this.currentUser.name, this.currentUser.avatar, 'user-avatar');
            // Заменяем <img id="user-avatar"> на готовый HTML (сохраним id для будущих обращений)
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const node = tmp.firstChild;
            node.id = 'user-avatar';
            wrapper.replaceChild(node, userAvatarEl);
        }
        if (userName) userName.textContent = this.currentUser.name;
    }

    updateUsersList(users) {
        const container = document.getElementById('users-container');
        if (!container) return;
        
        container.innerHTML = '';
        users.forEach(user => this.addUserToList(user));
    }

    autoResizeMessageInput() {
        const input = document.getElementById('message-input');
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
    }

    addUserToList(user) {
        const container = document.getElementById('users-container');
        if (!container) return;

        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.id = `user-${user.id}`;
        
        const avatarHTML = this.createAvatarHTML(user.name, user.avatar, 'userlist-avatar');

        userElement.innerHTML = `
            ${avatarHTML}
            <div class="user-info">
                <div class="user-name">${this.escapeHtml(user.name)}</div>
            </div>
            <div class="user-info">
                <div class="user-name">
                    ${user.isStoryteller ? '<span class="storyteller-badge">🎭</span>' : ''}
                </div>
                <div class="user-status">В сети</div>
            </div>
        `;
        
        userElement.addEventListener('click', () => {
            this.showUserProfile(user);
        });
        
        container.appendChild(userElement);
    }

    removeUserFromList(userId) {
        const userElement = document.getElementById(`user-${userId}`);
        if (userElement) userElement.remove();
    }

    updateUserInList(user) {
        const userElement = document.getElementById(`user-${user.id}`);
        const avatarHTML = this.createAvatarHTML(user.name, user.avatar, 'userlist-avatar');
        if (userElement) {
            userElement.innerHTML = `
                ${avatarHTML}
                <div class="user-info">
                    <div class="user-name">${this.escapeHtml(user.name)}</div>
                    <div class="user-status">${user.isStoryteller ? 'Рассказчик' : 'В Тени'}</div>
                </div>
                <div class="user-info">
                    <div class="user-name">
                        ${user.name}
                        ${user.isStoryteller ? '<span class="storyteller-badge">🎭</span>' : ''}
                    </div>
                    <div class="user-status">В сети</div>
                </div>
            `;
            
            userElement.addEventListener('click', () => {
                this.showUserProfile(user);
            });
        }
    }

    logout() {
        if (confirm('Вы уверены, что хотите выйти?')) {
            if (this.socket) {
                this.socket.emit('logout');
                this.socket.disconnect();
                this.socket = null;
            }
            
            localStorage.removeItem('chatUser');
            this.currentUser = null;
            this.isConnected = false;
            this.isStoryteller = false;
            this.messageSender = 'self';
            this.customSenderName = '';
            
            this.removeEventListeners();
            
            document.getElementById('chat-interface').classList.add('hidden');
            document.getElementById('login-modal').classList.remove('hidden');
            
            const controls = document.getElementById('storyteller-controls');
            if (controls) controls.classList.add('hidden');
            
            const customSender = document.getElementById('custom-sender');
            if (customSender) {
                customSender.value = '';
                customSender.disabled = true;
                customSender.placeholder = "Выберите 'От другого имени'";
            }
            
            const senderSelect = document.getElementById('message-sender');
            if (senderSelect) senderSelect.value = 'self';
            
            document.getElementById('login-form').reset();
            document.getElementById('avatar-preview').innerHTML = '';
            this.avatarBase64 = null;
            
            const messagesContainer = document.getElementById('messages-container');
            const usersContainer = document.getElementById('users-container');
            if (messagesContainer) messagesContainer.innerHTML = '';
            if (usersContainer) usersContainer.innerHTML = '';
            
            this.sidebarVisible = !this.isMobile;
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList[this.isMobile ? 'remove' : 'add']('active');
            }

            document.body.style.overflow = '';
            this.setupEventListeners();
        }
    }

    scrollToBottom(instant = false) {
        const container = document.getElementById('chat-container');
        if (container) {
            setTimeout(() => {
                try {
                    if (instant) {
                        container.scrollTop = container.scrollHeight;
                    } else {
                        container.scrollTo({
                            top: container.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                    
                    if (this.scrollButton) {
                        if (this.scrollButton) this.scrollButton.classList.remove('visible');
                    }
                } catch (error) {
                    container.scrollTop = container.scrollHeight;
                }
            }, 50);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const btn = document.getElementById("floating-menu-btn");
  if (btn && sidebar) {
    btn.addEventListener("click", () => {
      sidebar.classList.toggle("active");
    });
  }
});

window.chatApp = null;

document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});

document.addEventListener('touchstart', function() {}, {passive: true});