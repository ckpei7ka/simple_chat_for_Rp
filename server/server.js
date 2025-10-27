const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../client')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Инициализация директорий
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
[dataDir, uploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Константы файлов
const CHARACTERS_FILE = path.join(dataDir, 'characters.json');
const CHAT_HISTORY_FILE = path.join(dataDir, 'chat_history.json');

// Утилиты для работы с файлами
const fileUtils = {
  loadJSON: (filePath, defaultValue = {}) => {
    try {
      return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : defaultValue;
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error);
      return defaultValue;
    }
  },
  
  saveJSON: (filePath, data) => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error saving ${filePath}:`, error);
    }
  }
};

// Инициализация данных
let characters = fileUtils.loadJSON(CHARACTERS_FILE, {});
let chatHistory = fileUtils.loadJSON(CHAT_HISTORY_FILE, []);

// Обработка загрузки файлов
app.post('/upload', (req, res) => {
  try {
    const { file, filename, characterName } = req.body;
    if (!file || !filename) return res.status(400).json({ error: 'No file data provided' });

    const base64Data = file.replace(/^data:([A-Za-z-+/]+);base64,/, '');
    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(__dirname, 'uploads', safeFilename);
    
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    
    if (characterName && filename.includes('avatar')) {
      if (!characters[characterName]) characters[characterName] = {};
      characters[characterName].avatar = `/uploads/${safeFilename}`;
      fileUtils.saveJSON(CHARACTERS_FILE, characters);
    }
    
    res.json({ filename: safeFilename, url: `/uploads/${safeFilename}` });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// API для работы с персонажами
app.get('/character/:name', (req, res) => {
  const character = characters[req.params.name];
  character ? res.json(character) : res.status(404).json({ error: 'Character not found' });
});

app.post('/character/:name', (req, res) => {
  const { avatar, description } = req.body;
  const characterName = req.params.name;
  
  if (!characters[characterName]) characters[characterName] = {};
  if (avatar) characters[characterName].avatar = avatar;
  if (description) characters[characterName].description = description;
  
  fileUtils.saveJSON(CHARACTERS_FILE, characters);
  res.json({ success: true, character: characters[characterName] });
});

// Логика броска кубиков
function rollDice(numberOfDice) {
  const results = Array.from({ length: numberOfDice }, () => Math.floor(Math.random() * 10) + 1);
  
  let initialSuccesses = results.filter(roll => roll >= 8).length;
  let tens = results.filter(roll => roll === 10).length;

  const extraRolls = [];
  let extraSuccesses = 0;
  let currentTens = tens;

  while (currentTens > 0) {
    const extraRoll = Math.floor(Math.random() * 10) + 1;
    extraRolls.push(extraRoll);
    if (extraRoll >= 8) extraSuccesses++;
    if (extraRoll === 10) currentTens++;
    currentTens--;
  }

  return {
    initial: results,
    extra: extraRolls,
    totalSuccesses: initialSuccesses + extraSuccesses,
    initialSuccesses: initialSuccesses,
    extraSuccesses: extraSuccesses
  };
}

// Управление пользователями
const users = new Map();

// Socket.io обработчики
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  const getUser = () => users.get(socket.id);
  
  const createMessage = (type, data = {}) => {
    const user = getUser();
    const messageData = {
      id: Date.now().toString(),
      user: {
        name: user.name,
        avatar: user.avatar,
        id: socket.id
      },
      timestamp: new Date().toISOString(),
      type,
      canEdit: user.isStoryteller || socket.id === user.id,
      ...data
    };

    // Обработка типа отправителя для Рассказчика
    if (data.senderType === 'anonymous') {
      // Для анонимных сообщений скрываем информацию об отправителе
      messageData.user = {
        name: '',
        avatar: '',
        id: socket.id
      };
    } else if (data.senderType === 'other' && data.customSender) {
      // Для сообщений от другого имени подменяем отправителя
      messageData.user = {
        name: data.customSender,
        avatar: '/uploads/default-avatar.png',
        id: socket.id
      };
    }

    return messageData;
  };

  socket.on('user-join', (userData) => {
    const characterName = userData.name;
    let character = characters[characterName];
    
    if (!character) {
      character = { avatar: '/uploads/default-avatar.png', description: '' };
      characters[characterName] = character;
      fileUtils.saveJSON(CHARACTERS_FILE, characters);
    }

    const user = {
      id: socket.id,
      name: characterName,
      avatar: character.avatar,
      description: character.description,
      isStoryteller: characterName === 'Рассказчик'
    };
    
    users.set(socket.id, user);
    socket.emit('chat-history', chatHistory);
    socket.emit('users-list', Array.from(users.values()));
    socket.broadcast.emit('user-joined', user);
  });

  socket.on('send-message', (messageData) => {
    const user = getUser();
    if (!user) return;

    const message = createMessage('message', {
      text: messageData.text,
      senderType: messageData.senderType || 'self',
      customSender: messageData.customSender || ''
    });

    chatHistory.push(message);
    fileUtils.saveJSON(CHAT_HISTORY_FILE, chatHistory);
    io.emit('new-message', message);
  });

  socket.on('edit-message', (data) => {
    const user = getUser();
    if (!user) return;

    const messageIndex = chatHistory.findIndex(msg => msg.id === data.messageId);
    if (messageIndex === -1) return;

    const message = chatHistory[messageIndex];
    if (!user.isStoryteller && message.user.id !== socket.id) return;

    chatHistory[messageIndex] = {
      ...message,
      text: data.newText,
      edited: true,
      editTimestamp: new Date().toISOString(),
      editedBy: user.name
    };
    
    fileUtils.saveJSON(CHAT_HISTORY_FILE, chatHistory);
    io.emit('message-edited', chatHistory[messageIndex]);
  });

  socket.on('roll-dice', (diceCount) => {
    const user = getUser();
    if (!user) return;

    const message = createMessage('dice', {
      diceCount,
      rollResult: rollDice(diceCount)
    });

    chatHistory.push(message);
    fileUtils.saveJSON(CHAT_HISTORY_FILE, chatHistory);
    io.emit('new-message', message);
  });

  socket.on('update-profile', (profileData) => {
    const user = getUser();
    if (!user) return;

    const oldName = user.name;
    const newName = profileData.name || oldName;
    const isNameChanged = oldName !== newName;

    characters[newName] = {
      avatar: profileData.avatar || user.avatar,
      description: profileData.description || user.description
    };

    if (isNameChanged && oldName !== 'Рассказчик' && characters[oldName]) {
      delete characters[oldName];
    }

    fileUtils.saveJSON(CHARACTERS_FILE, characters);

    Object.assign(user, {
      name: newName,
      avatar: characters[newName].avatar,
      description: characters[newName].description,
      isStoryteller: newName === 'Рассказчик'
    });

    io.emit('user-updated', user);
  });

  socket.on('send-file', (fileData) => {
    const user = getUser();
    if (!user) return;

    const message = createMessage('file', { file: fileData });
    chatHistory.push(message);
    fileUtils.saveJSON(CHAT_HISTORY_FILE, chatHistory);
    io.emit('new-message', message);
  });

  const handleDisconnect = () => {
    const user = getUser();
    if (user) {
      users.delete(socket.id);
      socket.broadcast.emit('user-left', user.id);
    }
    console.log('User disconnected:', socket.id);
  };

  socket.on('logout', handleDisconnect);
  socket.on('disconnect', handleDisconnect);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Client: http://localhost:${PORT}`);
});