const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Настройка Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Статическая папка для файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка CORS
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT"]
  }
});

app.use(cors());
app.use(express.json());

// --- БАЗА ДАННЫХ ---
const db = new sqlite3.Database('./whyhot.db', (err) => {
  if (err) console.error('Ошибка открытия БД:', err.message);
  else console.log('Подключено к SQLite базе данных.');
});

// Создание таблиц и миграции
db.serialize(() => {
  // Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    avatar_url TEXT DEFAULT 'https://cdn-icons-png.flaticon.com/512/149/149071.png'
  )`);

  // Messages
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    sender_username TEXT,
    receiver_username TEXT, 
    timestamp TEXT,
    type TEXT DEFAULT 'text',
    file_url TEXT
  )`);

  // Friends
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_username TEXT,
    friend_username TEXT,
    status TEXT DEFAULT 'pending',
    UNIQUE(user_username, friend_username)
  )`);

  // Миграции "на лету" (если колонок нет - добавляем, ошибки игнорируем)
  db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT 'https://cdn-icons-png.flaticon.com/512/149/149071.png'", () => {});
  db.run("ALTER TABLE messages ADD COLUMN receiver_username TEXT", () => {});
  db.run("ALTER TABLE friends ADD COLUMN status TEXT DEFAULT 'pending'", () => {});
  db.run("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'", () => {});
  db.run("ALTER TABLE messages ADD COLUMN file_url TEXT", () => {});
});

// --- API ROUTES ---

// Загрузка файла
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `http://localhost:3001/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// Регистрация
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (username, password) VALUES (?, ?)`;
    db.run(sql, [username, hashedPassword], function(err) {
      if (err) return res.status(400).json({ error: 'Пользователь уже существует' });
      res.json({ success: true, username });
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Логин
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (await bcrypt.compare(password, user.password)) {
      res.json({ success: true, username: user.username, avatar_url: user.avatar_url });
    } else {
      res.status(400).json({ error: 'Неверный пароль' });
    }
  });
});

// Получить текущего юзера (для обновления данных на клиенте)
app.get('/user/:username', (req, res) => {
  db.get(`SELECT username, avatar_url FROM users WHERE username = ?`, [req.params.username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  });
});

// Поиск пользователей
app.get('/users/search', (req, res) => {
  const { q, current } = req.query;
  if (!q) return res.json([]);
  
  const sql = `SELECT username, avatar_url FROM users WHERE username LIKE ? AND username != ? LIMIT 20`;
  db.all(sql, [`%${q}%`, current], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Добавить друга (Создать запрос)
app.post('/friends', (req, res) => {
  const { user, friend } = req.body;
  if(user === friend) return res.json({ success: false, message: 'Нельзя добавить самого себя' });
  
  const sql = `INSERT INTO friends (user_username, friend_username, status) VALUES (?, ?, 'pending')`;
  db.run(sql, [user, friend], function(err) {
    if (err) return res.json({ success: false, message: 'Запрос уже отправлен' });
    res.json({ success: true, message: 'Запрос отправлен' });
  });
});

// Принять/Отклонить запрос
app.put('/friends/respond', (req, res) => {
  const { user, friend, action } = req.body; // user = кто принимает, friend = кто отправил
  
  if (action === 'accept') {
    // Обновляем статус на accepted
    const sql = `UPDATE friends SET status = 'accepted' WHERE user_username = ? AND friend_username = ?`;
    db.run(sql, [friend, user], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      // Создаем обратную запись, чтобы дружба была двусторонней
      db.run(`INSERT OR IGNORE INTO friends (user_username, friend_username, status) VALUES (?, ?, 'accepted')`, [user, friend]);
      
      res.json({ success: true });
    });
  } else {
    // Удаляем запись
    const sql = `DELETE FROM friends WHERE user_username = ? AND friend_username = ?`;
    db.run(sql, [friend, user], function(err) {
       res.json({ success: true });
    });
  }
});

// Получить список друзей (status='accepted')
app.get('/friends', (req, res) => {
  const { user } = req.query;
  const sql = `
    SELECT u.username, u.avatar_url 
    FROM friends f 
    JOIN users u ON f.friend_username = u.username 
    WHERE f.user_username = ? AND f.status = 'accepted'
  `;
  db.all(sql, [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Получить входящие запросы (где friend_username = я, status = 'pending')
app.get('/friends/requests', (req, res) => {
  const { user } = req.query;
  const sql = `
    SELECT u.username, u.avatar_url 
    FROM friends f 
    JOIN users u ON f.user_username = u.username 
    WHERE f.friend_username = ? AND f.status = 'pending'
  `;
  db.all(sql, [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Обновление профиля
app.put('/user/profile', (req, res) => {
  let { currentUsername, newUsername, newAvatar } = req.body;
  if (!newUsername) newUsername = currentUsername;

  const sql = `UPDATE users SET username = ?, avatar_url = ? WHERE username = ?`;
  db.run(sql, [newUsername, newAvatar, currentUsername], function(err) {
    if (err) return res.status(400).json({ error: 'Этот ник занят или ошибка обновления' });
    
    // Ручное обновление зависимостей (Cascade update simulation)
    if (newUsername !== currentUsername) {
       db.run(`UPDATE messages SET sender_username = ? WHERE sender_username = ?`, [newUsername, currentUsername]);
       db.run(`UPDATE messages SET receiver_username = ? WHERE receiver_username = ?`, [newUsername, currentUsername]);
       db.run(`UPDATE friends SET user_username = ? WHERE user_username = ?`, [newUsername, currentUsername]);
       db.run(`UPDATE friends SET friend_username = ? WHERE friend_username = ?`, [newUsername, currentUsername]);
    }
    
    res.json({ success: true, username: newUsername, avatar_url: newAvatar });
  });
});

// --- SOCKET.IO ---

io.on('connection', (socket) => {
  
  // Пользователь сообщает кто он, чтобы получать личные сообщения
  socket.on('join', (username) => {
    socket.join(username);
    socket.username = username;
  });

  // Запрос истории сообщений
  socket.on('getMessages', ({ type, mate, me }) => {
    let sql = '';
    let params = [];
    
    if (type === 'global') {
      sql = `SELECT * FROM messages WHERE receiver_username IS NULL ORDER BY id ASC`;
    } else {
      // Личка: сообщения где (я отправил, он получил) ИЛИ (он отправил, я получил)
      sql = `SELECT * FROM messages 
             WHERE (sender_username = ? AND receiver_username = ?) 
                OR (sender_username = ? AND receiver_username = ?) 
             ORDER BY id ASC`;
      params = [me, mate, mate, me];
    }

    db.all(sql, params, (err, rows) => {
      if (!err) socket.emit('history', rows);
    });
  });

  // Отправка сообщения
  socket.on('sendMessage', (data) => {
    const { text, sender_username, receiver_username, type = 'text', file_url = null } = data;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Сохраняем в БД
    const insertSql = `INSERT INTO messages (text, sender_username, receiver_username, timestamp, type, file_url) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(insertSql, [text || '', sender_username, receiver_username || null, timestamp, type, file_url], function(err) {
      if (err) return console.error(err);
      
      const newMessage = {
        id: this.lastID,
        text,
        sender_username,
        receiver_username,
        timestamp,
        type,
        file_url
      };

      if (!receiver_username) {
        // Global
        io.emit('receiveMessage', newMessage);
      } else {
        // Private: send to sender (to see it instantly) AND to receiver
        io.to(receiver_username).to(sender_username).emit('receiveMessage', newMessage);
      }
    });
  });

  socket.on('disconnect', () => {
    // 
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});