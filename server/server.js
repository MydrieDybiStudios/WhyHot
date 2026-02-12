const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();

// ========== ПОДКЛЮЧЕНИЕ К POSTGRESQL ==========
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Создание таблиц при запуске
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        avatar_url TEXT DEFAULT 'https://cdn-icons-png.flaticon.com/512/149/149071.png'
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT,
        sender_username TEXT,
        receiver_username TEXT,
        timestamp TEXT,
        type TEXT DEFAULT 'text',
        file_url TEXT
      );
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_username TEXT,
        friend_username TEXT,
        status TEXT DEFAULT 'pending',
        UNIQUE(user_username, friend_username)
      );
    `);
    console.log('✅ Таблицы PostgreSQL готовы');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
};
initDB();

// ========== НАСТРОЙКА MULTER (ЗАГРУЗКА ФАЙЛОВ) ==========
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

// Статическая раздача файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== CORS ==========
const allowedOrigins = [
  process.env.CORS_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

// ========== ВСПОМОГАТЕЛЬНЫЙ ОБЪЕКТ db ДЛЯ СОВМЕСТИМОСТИ ==========
const db = {
  run: (sql, params, callback) => {
    pool.query(sql, params, (err, res) => {
      if (callback) {
        callback(err, { lastID: res?.rows?.[0]?.id });
      }
    });
  },
  get: (sql, params, callback) => {
    pool.query(sql, params, (err, res) => {
      callback(err, res?.rows[0]);
    });
  },
  all: (sql, params, callback) => {
    pool.query(sql, params, (err, res) => {
      callback(err, res?.rows || []);
    });
  }
};

// ========== API РОУТЫ ==========
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password) VALUES ($1, $2)`,
      [username, hashedPassword],
      function(err) {
        if (err) return res.status(400).json({ error: 'Пользователь уже существует' });
        res.json({ success: true, username });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = $1`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (await bcrypt.compare(password, user.password)) {
      res.json({ success: true, username: user.username, avatar_url: user.avatar_url });
    } else {
      res.status(400).json({ error: 'Неверный пароль' });
    }
  });
});

app.get('/user/:username', (req, res) => {
  db.get(`SELECT username, avatar_url FROM users WHERE username = $1`, [req.params.username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  });
});

app.get('/users/search', (req, res) => {
  const { q, current } = req.query;
  if (!q) return res.json([]);
  db.all(
    `SELECT username, avatar_url FROM users WHERE username ILIKE $1 AND username != $2 LIMIT 20`,
    [`%${q}%`, current],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/friends', (req, res) => {
  const { user, friend } = req.body;
  if (user === friend) return res.json({ success: false, message: 'Нельзя добавить самого себя' });

  db.run(
    `INSERT INTO friends (user_username, friend_username, status) VALUES ($1, $2, 'pending')`,
    [user, friend],
    function(err) {
      if (err) return res.json({ success: false, message: 'Запрос уже отправлен' });
      res.json({ success: true, message: 'Запрос отправлен' });
    }
  );
});

app.put('/friends/respond', (req, res) => {
  const { user, friend, action } = req.body;

  if (action === 'accept') {
    db.run(
      `UPDATE friends SET status = 'accepted' WHERE user_username = $1 AND friend_username = $2`,
      [friend, user],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(
          `INSERT INTO friends (user_username, friend_username, status) VALUES ($1, $2, 'accepted') ON CONFLICT DO NOTHING`,
          [user, friend]
        );
        res.json({ success: true });
      }
    );
  } else {
    db.run(
      `DELETE FROM friends WHERE user_username = $1 AND friend_username = $2`,
      [friend, user],
      function(err) {
        res.json({ success: true });
      }
    );
  }
});

app.get('/friends', (req, res) => {
  const { user } = req.query;
  db.all(
    `SELECT u.username, u.avatar_url 
     FROM friends f 
     JOIN users u ON f.friend_username = u.username 
     WHERE f.user_username = $1 AND f.status = 'accepted'`,
    [user],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/friends/requests', (req, res) => {
  const { user } = req.query;
  db.all(
    `SELECT u.username, u.avatar_url 
     FROM friends f 
     JOIN users u ON f.user_username = u.username 
     WHERE f.friend_username = $1 AND f.status = 'pending'`,
    [user],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.put('/user/profile', (req, res) => {
  let { currentUsername, newUsername, newAvatar } = req.body;
  if (!newUsername) newUsername = currentUsername;

  db.run(
    `UPDATE users SET username = $1, avatar_url = $2 WHERE username = $3`,
    [newUsername, newAvatar, currentUsername],
    function(err) {
      if (err) return res.status(400).json({ error: 'Этот ник занят или ошибка обновления' });

      if (newUsername !== currentUsername) {
        db.run(`UPDATE messages SET sender_username = $1 WHERE sender_username = $2`, [newUsername, currentUsername]);
        db.run(`UPDATE messages SET receiver_username = $1 WHERE receiver_username = $2`, [newUsername, currentUsername]);
        db.run(`UPDATE friends SET user_username = $1 WHERE user_username = $2`, [newUsername, currentUsername]);
        db.run(`UPDATE friends SET friend_username = $1 WHERE friend_username = $2`, [newUsername, currentUsername]);
      }

      res.json({ success: true, username: newUsername, avatar_url: newAvatar });
    }
  );
});

// ========== SOCKET.IO ==========
const http = require('http');
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT'], credentials: true }
});

io.on('connection', (socket) => {
  socket.on('join', (username) => {
    socket.join(username);
    socket.username = username;
  });

  socket.on('getMessages', ({ type, mate, me }) => {
    let sql, params;
    if (type === 'global') {
      sql = `SELECT * FROM messages WHERE receiver_username IS NULL ORDER BY id ASC`;
      params = [];
    } else {
      sql = `SELECT * FROM messages 
             WHERE (sender_username = $1 AND receiver_username = $2) 
                OR (sender_username = $3 AND receiver_username = $4) 
             ORDER BY id ASC`;
      params = [me, mate, mate, me];
    }
    db.all(sql, params, (err, rows) => {
      if (!err) socket.emit('history', rows);
    });
  });

  socket.on('sendMessage', (data) => {
    const { text, sender_username, receiver_username, type = 'text', file_url = null } = data;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    db.run(
      `INSERT INTO messages (text, sender_username, receiver_username, timestamp, type, file_url) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [text || '', sender_username, receiver_username || null, timestamp, type, file_url],
      function(err, result) {
        if (err) return console.error(err);
        const newMessage = {
          id: result.lastID,
          text,
          sender_username,
          receiver_username,
          timestamp,
          type,
          file_url
        };
        if (!receiver_username) {
          io.emit('receiveMessage', newMessage);
        } else {
          io.to(receiver_username).to(sender_username).emit('receiveMessage', newMessage);
        }
      }
    );
  });
});

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
