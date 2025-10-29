/* Новая стабильная реализация прокрутки вниз для мобильных (IntersectionObserver)
   Удалены все старые функции и вызовы, связанные со скроллом:
   - createScrollButton (старая)
   - handleChatScroll
   - любые старые setupChatContainer/scrollToBottom вариации
   Добавлены:
   - initScrollUI / createScrollButtonIfNeeded / installBottomSentinelObserver
   - обновлённый scrollToBottom + корректная автопрокрутка только когда пользователь внизу
*/

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
        this._bottomObserver = null; // IntersectionObserver
        this.isStoryteller = false;
        this.messageSender = 'self';
        this.customSenderName = '';
        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.checkExistingSession();
        this.setupGlobalEventListeners();
        // Кнопку и наблюдателя ставим после появления интерфейса (в connectToChat)
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
        if (mobileUsersBtn) mobileUsersBtn.style.display = 'none';
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.style.overflowY = 'auto';
            chatContainer.style.webkitOverflowScrolling = 'touch';
        }
    }

    optimizeForDesktop() {
        const mobileUsersBtn = document.getElementById('mobile-users-btn');
        if (mobileUsersBtn) mobileUsersBtn.style.display = 'block';
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.style.overflowY = 'auto';
            chatContainer.style.webkitOverflowScrolling = 'touch';
        }
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

        /* === Поддержка загрузки листа персонажа === */
        this.addEventListener('sheet-upload-btn', 'click', () => {
            const input = document.getElementById('sheet-file-input');
            if (input) input.click();
        });
        this.addEventListener('sheet-file-input', 'change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.handleSheetUpload(file);
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
                              id === 'message-sender' ? 'change'  : 'click';
            this.addChatEventListener(id, eventType, handler);
        });

        // Текстовое поле
        const ta = document.getElementById('message-input');
        if (ta) {
            ta.addEventListener('input', () => this.autoResizeMessageInput());
            this.autoResizeMessageInput();

            ta.addEventListener('keydown', (e) => {
                if (!this.isMobile) {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                    return;
                }
                if (this.isMobile) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.sendMessage();
                    }
                }
            });
        }

        // После возможного «обнуления» узлов — заново ставим UI скролла
        this.initScrollUI();
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
        this.initScrollUI(); // <-- здесь создаём кнопку и наблюдатель
        this.updateUserProfile();
        this.setupSocketHandlers();

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.socket.emit('user-join', this.currentUser);

            if (this.currentUser.isStoryteller) {
                this.showStorytellerControls();
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
                const chatContainer = document.getElementById('chat-container');
                const wasAtBottom = chatContainer &&
                    (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 5);

                this.displayMessage(message);

                if (wasAtBottom) {
                    this.scrollToBottom();
                }
                // Если не были внизу — кнопка покажется/скроется наблюдателем автоматически
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
            'connect_error': () => {
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

    // ========= Новая логика скролла =========

    initScrollUI() {
        this.createScrollButtonIfNeeded();
        this.installBottomSentinelObserver();
    }

    createScrollButtonIfNeeded() {
        if (this.scrollButton && document.body.contains(this.scrollButton)) return;
        this.scrollButton = document.createElement('button');
        this.scrollButton.id = 'scroll-to-bottom';
        this.scrollButton.className = 'scroll-to-bottom-button';
        this.scrollButton.textContent = '⬇️';
        this.scrollButton.style.display = 'none';
        this.scrollButton.addEventListener('click', () => this.scrollToBottom(true));
        document.body.appendChild(this.scrollButton);
    }

    installBottomSentinelObserver() {
        const chatContainer = document.getElementById('chat-container');
        if (!chatContainer) return;

        // создаём или перемещаем маячок в самый низ
        let sentinel = document.getElementById('chat-bottom-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'chat-bottom-sentinel';
            sentinel.style.cssText = 'width:100%;height:1px;';
            chatContainer.appendChild(sentinel);
        } else if (sentinel.parentElement !== chatContainer) {
            chatContainer.appendChild(sentinel);
        } else {
            // гарантируем, что маячок самый нижний
            if (sentinel !== chatContainer.lastElementChild) {
                chatContainer.appendChild(sentinel);
            }
        }

        // отключаем старый наблюдатель
        if (this._bottomObserver) {
            this._bottomObserver.disconnect();
        }

        // наблюдаем видимость маячка внутри контейнера
        this._bottomObserver = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (this.scrollButton) {
                    this.scrollButton.style.display = entry.isIntersecting ? 'none' : 'flex';
                }
            },
            { root: chatContainer, threshold: 1.0 }
        );
        this._bottomObserver.observe(sentinel);
    }

    scrollToBottom(instant = false) {
        const container = document.getElementById('chat-container');
        if (!container) return;
        // Небольшая задержка, чтобы дождаться layout/рендеринга
        setTimeout(() => {
            try {
                if (instant) {
                    container.scrollTop = container.scrollHeight;
                } else {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }
                // Кнопка скроется автоматически, когда маячок окажется видимым
            } catch {
                container.scrollTop = container.scrollHeight;
            }
        }, 50);
    }

    // ========= Остальной функционал =========

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
        } catch {
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

    showUserProfile(user) {
        document.getElementById('profile-modal-avatar').src = user.avatar;
        document.getElementById('profile-modal-name').textContent = user.name;
        document.getElementById('profile-modal-description').textContent =
            user.description || 'Описание отсутствует';

        const storytellerBadge = document.getElementById('profile-modal-storyteller');
        if (user.isStoryteller) {
            storytellerBadge.classList.remove('hidden');
        } else {
            storytellerBadge.classList.add('hidden');
        }

        /* Инициализация листа персонажа в модалке */
        const sheetImg = document.getElementById('profile-modal-sheet');
        const sheetEmpty = document.getElementById('profile-modal-sheet-empty');
        const sheetOpen = document.getElementById('sheet-open-btn');
        if (user.sheet) {
            if (sheetImg){ sheetImg.src = user.sheet; sheetImg.classList.remove('hidden'); }
            if (sheetEmpty){ sheetEmpty.classList.add('hidden'); }
            if (sheetOpen){ sheetOpen.href = user.sheet; sheetOpen.classList.remove('hidden'); }
        } else {
            if (sheetImg){ sheetImg.classList.add('hidden'); sheetImg.removeAttribute('src'); }
            if (sheetEmpty){ sheetEmpty.classList.remove('hidden'); }
            if (sheetOpen){ sheetOpen.removeAttribute('href'); sheetOpen.classList.add('hidden'); }
        }

        document.getElementById('user-profile-modal').classList.remove('hidden');

        if (this.isMobile) {
            this.hideSidebar();
        }
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
        setTimeout(() => {
            this.scrollToBottom(true);
            this.installBottomSentinelObserver();
        }, 100);
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

        // Убеждаемся, что маячок — последний элемент в контейнере
        this.installBottomSentinelObserver();
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

        return `
            <img src="${message.user.avatar}" alt="${displayName}" class="message-avatar">
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

        return `
            <img src="${message.user.avatar}" alt="${displayName}" class="message-avatar">
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
                        ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'\')">✏️</button>' : ''}
                    </div>
                    <div class="message-text">${safeHtml}</div>
                </div>
            `;
        }

        return `
            <img src="${message.user.avatar}" alt="${displayName}" class="message-avatar">
            <div class="message-content">
                <div class="message-header">
                    <span class="message-user">${displayName}</span>
                    <span class="message-time">${time} ${editedInfo}</span>
                    ${message.canEdit ? '<button class="edit-btn" onclick="window.chatApp.editMessage(\'' + message.id + '\', \'\')">✏️</button>' : ''}
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

        const chatContainer = document.getElementById('chat-container');
        if (chatContainer &&
            (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 5)) {
            this.scrollToBottom();
        }
        this.installBottomSentinelObserver();
    }

    updateUserProfile() {
        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');

        if (userAvatar) userAvatar.src = this.currentUser.avatar;
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

        userElement.innerHTML = `
            <img src="${user.avatar}" alt="${user.name}" class="user-avatar">
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

        container.appendChild(userElement);
    }

    removeUserFromList(userId) {
        const userElement = document.getElementById(`user-${userId}`);
        if (userElement) userElement.remove();
    }

    updateUserInList(user) {
        const userElement = document.getElementById(`user-${user.id}`);
        if (userElement) {
            userElement.innerHTML = `
                <img src="${user.avatar}" alt="${user.name}" class="user-avatar">
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /* === Загрузка листа персонажа === */
    async handleSheetUpload(file) {
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                // 1) Отправляем изображение на сервер
                const res = await fetch('/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file: e.target.result,
                        filename: file.name || 'character-sheet.png',
                        characterName: this.currentUser?.name || ''
                    })
                });
                const result = await res.json();

                // 2) Обновляем UI модалки
                const sheetUrl = result.url;
                const sheetImg = document.getElementById('profile-modal-sheet');
                const sheetEmpty = document.getElementById('profile-modal-sheet-empty');
                const sheetOpen = document.getElementById('sheet-open-btn');
                if (sheetImg){ sheetImg.src = sheetUrl; sheetImg.classList.remove('hidden'); }
                if (sheetEmpty){ sheetEmpty.classList.add('hidden'); }
                if (sheetOpen){ sheetOpen.href = sheetUrl; sheetOpen.classList.remove('hidden'); }

                // 3) Пытаемся сохранить ссылку в карточке персонажа (если бэк поддерживает)
                try {
                    await fetch(`/character/${encodeURIComponent(this.currentUser.name)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            avatar: this.currentUser.avatar,
                            description: this.currentUser.description,
                            sheet: sheetUrl
                        })
                    });
                } catch(_) {}

                // 4) Локально положим в currentUser и при необходимости оповестим сервер/лист пользователей
                this.currentUser.sheet = sheetUrl;
                localStorage.setItem('chatUser', JSON.stringify(this.currentUser));
                if (this.socket) {
                    this.socket.emit('update-profile', {
                        name: this.currentUser.name,
                        avatar: this.currentUser.avatar,
                        description: this.currentUser.description,
                        sheet: sheetUrl
                    });
                }
            };
            reader.readAsDataURL(file);
        } catch (err) {
            alert('Ошибка при загрузке листа персонажа');
        } finally {
            // очистим инпут, чтобы можно было выбрать тот же файл ещё раз
            const input = document.getElementById('sheet-file-input');
            if (input) input.value = '';
        }
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const btnFloating = document.getElementById("floating-menu-btn");
    if (btnFloating && sidebar) {
        btnFloating.addEventListener("click", () => {
            sidebar.classList.toggle("active");
        });
    }

    /* === ВАЖНО: вынесем mobile-menu-btn в <body>, чтобы исключить влияние родительских
       stacking context/overflow/transform и гарантировать кликабельность поверх сайдбара */
    const mobileBtn = document.getElementById("mobile-menu-btn");
    if (mobileBtn && mobileBtn.parentElement !== document.body) {
        document.body.appendChild(mobileBtn);
    }
});

window.chatApp = null;

document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});

// пассивный обработчик для iOS Safari оптимизаций
document.addEventListener('touchstart', function(){}, {passive: true});
