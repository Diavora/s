import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

// Ensure we always reference the backend directory where this script resides
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'store.db');
const db = new Database(dbPath);

// --- ensure existing DB has latest columns ---
function ensureColumn(table, column, typeDef, unique = false) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!info.some(c => c.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`).run();
    if (unique) {
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table}(${column})`).run();
    }
    console.log(`Added column ${column} to ${table}`);
  }
}
ensureColumn('users', 'nickname', 'TEXT', true);
ensureColumn('users', 'frozen_balance', 'INTEGER DEFAULT 0');
ensureColumn('games', 'banner_url', 'TEXT');
ensureColumn('items', 'dedup_key', 'TEXT', true);
ensureColumn('chat_messages', 'image_url', 'TEXT');

// ---- DB Schema Bootstrap ----
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE,
  password_hash TEXT,
  avatar_url TEXT,
  balance INTEGER DEFAULT 0,
  frozen INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  name TEXT,
  category TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  seller_id INTEGER,
  name TEXT,
  desc TEXT,
  price INTEGER,
  photo_url TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  buyer_id INTEGER,
  price INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT, 
    amount INTEGER,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

// --- Chats schema ---
db.exec(`CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER UNIQUE,
  buyer_id INTEGER,
  seller_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  sender_id INTEGER,
  type TEXT DEFAULT 'text', -- 'text' | 'system'
  text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);
`);

// Seed games if empty
const gCount = db.prepare('SELECT COUNT(*) AS c FROM games').get().c;
if (!gCount) {
  const seedPath = path.join(__dirname, '..', 'games_seed.json');
  try {
    const games = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const ins = db.prepare('INSERT INTO games (id,name,category) VALUES (?,?,?)');
    const trx = db.transaction(arr => arr.forEach(g => ins.run(g.id, g.name, g.cat)));
    trx(games);
    console.log('Seeded games:', games.length);
  } catch (e) { console.warn('Failed to seed games', e) }
}

// Ensure uploads folder exists with robust fallback logic.
// Prefer project directory on Windows to avoid pointing to C:\data by accident.
// We try candidates in order and pick the first that is writable for creating 'uploads/'.
const isWin = process.platform === 'win32';
const uploadBaseCandidates = [
  process.env.UPLOADS_DIR,
  __dirname,
  process.env.RENDER_DISK,
  isWin ? null : '/data',
].filter(Boolean);

let uploadsBase = __dirname;
let uploadsDir = path.join(uploadsBase, 'uploads');
for (const base of uploadBaseCandidates) {
  try {
    const dir = path.join(base, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    uploadsBase = base;
    uploadsDir = dir;
    break;
  } catch (_) {
    // try next candidate
  }
}
const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
try { console.log('[uploads] base=', uploadsBase, 'dir=', uploadsDir); } catch(_) {}

// Global helper: remove/mask bottom-right PlayerOK watermark ("Playerok")
// Strategy: compute a rectangle at bottom-right, sample an area above it, blur and overlay
async function removePlayerOkWatermark(inputBuf) {
  try {
    const meta = await sharp(inputBuf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return inputBuf;

    const margin = Math.max(2, Math.round(Math.min(width, height) * 0.01));
    const wmH = Math.max(18, Math.min(Math.round(height * 0.12), Math.round(height * 0.25)));
    const wmW = Math.max(80, Math.min(Math.round(width * 0.32), Math.round(width * 0.5)));
    const x = Math.max(0, width - wmW - margin);
    const y = Math.max(0, height - wmH - margin);

    const srcTop = Math.max(0, y - wmH - margin);
    const srcHeight = Math.max(1, y - srcTop);
    if (srcHeight < 4) {
      const cut = Math.min(wmH + margin, Math.round(height * 0.2));
      if (height - cut > 16) {
        return await sharp(inputBuf).extract({ left: 0, top: 0, width, height: height - cut }).toBuffer();
      }
      return inputBuf;
    }

    const patchBuf = await sharp(inputBuf)
      .extract({ left: x, top: srcTop, width: wmW, height: srcHeight })
      .blur(3)
      .toBuffer();

    const out = await sharp(inputBuf)
      .composite([{ input: patchBuf, left: x, top: y }])
      .toBuffer();
    return out;
  } catch (_) {
    return inputBuf;
  }
}

// ---- Title/price normalization helpers (global) ----
// Normalize media URL to a consistent web path:
// - keep absolute (http/https, data:) as is
// - drop optional leading './' or '/'
// - strip optional 'public/' prefix
// - unify first segment 'uploads' casing to lower ('Uploads' -> 'uploads')
// - convert backslashes to forward slashes
// - ensure leading '/'
function normalizeMediaUrl(u) {
  let s = (u || '').toString().trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  s = s.replace(/^\.?\/+/, '');
  s = s.replace(/^public\//i, '');
  s = s.replace(/\\/g, '/');
  if (/^uploads\//i.test(s)) s = s.replace(/^uploads/i, 'uploads');
  return '/' + s;
}

function removePriceTokens(input) {
  let t = (input || '').toString();
  // remove price in parentheses/brackets at end
  t = t.replace(/\s*[\(\[]?\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)\s*[\)\]]?\s*$/gi, '');
  // remove trailing dash + price
  t = t.replace(/\s*[-–—]\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)\s*$/gi, '');
  // remove standalone price tokens globally (start/middle/end)
  const priceToken = /(?:^|[\s\-–—\(\[])(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|[A-Za-zА-Яа-я])/gi;
  let prev;
  do { prev = t; t = t.replace(priceToken, ' '); } while (t !== prev);
  // remove orphan currency symbols without digits around
  t = t.replace(/(?:^|[\s\-–—\(\[])(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|\D)/gi, ' ');
  // trim separators created by removals
  t = t.replace(/\s*[-–—,:;]+\s*$/g, '');
  t = t.replace(/^[-–—,:;]+\s*/g, '');
  return t;
}

// Clean title for display: strip discounts/promo words AND any price tokens
function cleanupTitle(raw) {
  let t = (raw || '').toString();
  // remove control chars
  t = t.replace(/[\u0000-\u001F\u007F]/g, ' ');
  // strip obvious code blocks
  t = t.replace(/try\s*\{[\s\S]*?\}\s*catch\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/gi, ' ');
  t = t.replace(/function\b[\s\S]{0,600}?\}/gi, ' ');
  // strip common code identifiers
  t = t.replace(/\b(document\.cookie|window\.[a-zA-Z_][\w]*|setCookie|getCookie|deleteCookie|reloadPage)\b/gi, ' ');
  // remove leftover code punctuation
  t = t.replace(/[{};<>]/g, ' ');
  // normalize spaces
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // remove leading numeric token (assumed price) at the very start
  const leadingNum = /^(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:k|к|тыс\.?)*\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)?(?=\s|[A-Za-zА-Яа-я]|$)/i;
  while (leadingNum.test(t)) {
    t = t.replace(leadingNum, ' ').trimStart();
  }
  // remove percent-based discount tokens
  t = t.replace(/[\(\[\-–—\s]*[-+−]?\d{1,3}\s*%[\)\]\s]*/g, ' ');
  // remove common discount words
  t = t.replace(/\b(скидк[а-я]*|распродажа|акци[яий]|sale|off)\b/gi, ' ');
  // remove stray separators
  t = t.replace(/[|\/•&]+/g, ' ');
  // remove any currency/price tokens anywhere
  t = removePriceTokens(t);
  // cleanup brackets and extra spaces
  t = t.replace(/[\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  // collapse excessive punctuation
  t = t.replace(/[\-–—]{2,}/g, '—').replace(/[,.;:]{2,}/g, m => m[0]);
  // final fallback if became empty or too short
  if (!t || t.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) {
    t = 'Товар';
  }
  return t;
}

// Normalize title for deduplication
function normalizeTitleForDedup(raw) {
  let t = cleanupTitle(raw).toLowerCase();
  // remove trailing long numeric or code-like suffixes
  t = t.replace(/(?:\s*[\-–—#№]\s*\d{4,})+$/g, '').trim();
  // remove trailing pure numeric suffixes
  t = t.replace(/\s+\d{4,}$/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

const app = express();
app.set('etag', false);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));
// Serve frontend
// Раздача статических файлов (HTML, CSS, JS) из корневой папки проекта
app.use(express.static(path.join(__dirname, '..')));

app.use('/avatars', express.static(path.join(__dirname, 'avatars')));
app.use(express.static(path.join(__dirname, 'public'))); // Для раздачи баннеров и др. статики

// --- Admin guard (simple) ---
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No auth' });
  try {
    const env = process.env.ADMIN_NICKS || '';
    const configured = env.split(',').map(s => s.trim()).filter(Boolean);
    // Always include hardcoded admin nickname(s)
    const adminNicks = Array.from(new Set([...configured, 'Laperouse']));
    const isAdminByNick = req.user.nickname
      && adminNicks.length
      && adminNicks.map(n => n.toLowerCase()).includes(String(req.user.nickname).toLowerCase());
    const isAdminById = req.user.id === 1; // fallback for backward compatibility
    if (!(isAdminByNick || isAdminById)) return res.status(403).json({ error: 'Только для админа' });
    return next();
  } catch (e) {
    console.error('requireAdmin error:', e);
    return res.status(500).json({ error: 'Admin check failed' });
  }
}

// --- Multer Configuration for Avatars ---
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `avatar-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// --- Chats API ---
// List my chats
app.get('/api/chats', auth, (req, res) => {
  try {
    const sql = `
      SELECT 
        c.*, d.item_id, i.name as item_name,
        buyer.nickname as buyer_nickname, buyer.avatar_url as buyer_avatar,
        seller.nickname as seller_nickname, seller.avatar_url as seller_avatar,
        (
          SELECT m.text FROM chat_messages m 
          WHERE m.chat_id = c.id 
          ORDER BY m.created_at DESC, m.id DESC 
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.created_at FROM chat_messages m 
          WHERE m.chat_id = c.id 
          ORDER BY m.created_at DESC, m.id DESC 
          LIMIT 1
        ) AS last_time
      FROM chats c
      JOIN deals d ON c.deal_id = d.id
      JOIN items i ON d.item_id = i.id
      JOIN users buyer ON d.buyer_id = buyer.id
      JOIN users seller ON i.seller_id = seller.id
      WHERE c.buyer_id = ? OR c.seller_id = ?
      ORDER BY COALESCE(last_time, c.created_at) DESC`;
    const rows = db.prepare(sql).all(req.user.id, req.user.id);
    const mapped = rows.map(r => ({
      id: r.id,
      deal_id: r.deal_id,
      item_name: r.item_name,
      partner_nickname: r.buyer_id === req.user.id ? r.seller_nickname : r.buyer_nickname,
      partner_avatar: r.buyer_id === req.user.id ? r.seller_avatar : r.buyer_avatar,
      last_message: r.last_message || null,
      last_time: r.last_time || r.created_at,
      unread_count: 0
    }));
    res.json(mapped);
  } catch (e) {
    console.error('Get chats error:', e);
    res.status(500).json({ error: 'Ошибка загрузки чатов' });
  }
});

// List messages for a chat
app.get('/api/chats/:id/messages', auth, (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  if (chat.buyer_id !== req.user.id && chat.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа к чату' });
  }
  const msgs = db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC').all(chatId);
  const data = msgs.map(m => ({
    id: m.id,
    type: m.type,
    text: m.text,
    image_url: m.image_url || null,
    me: m.sender_id && m.sender_id === req.user.id,
    created_at: m.created_at
  }));
  res.json(data);
});

// Send a message into a chat
app.post('/api/chats/:id/messages', auth, (req, res) => {
  const chatId = parseInt(req.params.id, 10);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  if (chat.buyer_id !== req.user.id && chat.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа к чату' });
  }

  const ct = (req.headers['content-type'] || '').toLowerCase();
  const isMultipart = ct.includes('multipart/form-data');

  if (isMultipart) {
    const handler = uploadChatPhoto.single('image');
    handler(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        console.error('Multer error (chat photo):', err);
        return res.status(400).json({ error: `Ошибка загрузки: ${err.message}` });
      } else if (err) {
        console.error('Upload error (chat photo):', err);
        return res.status(400).json({ error: err.message });
      }

      const text = (req.body?.text || '').toString().trim();
      if (!req.file && !text) return res.status(400).json({ error: 'Пустое сообщение' });

      let imageUrl = null;
      if (req.file) {
        try {
          const absPath = path.join(chatPhotosDir, req.file.filename);
          // Optional: apply watermark removal or resizing if desired
          // no-op for chat images now
          imageUrl = path.join('uploads', 'messages', req.file.filename).replace(/\\/g, '/');
        } catch (_) {}
      }

      const type = imageUrl ? 'image' : 'text';
      const info = db.prepare('INSERT INTO chat_messages (chat_id, sender_id, type, text, image_url) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, req.user.id, type, text || null, imageUrl);
      const created = db.prepare('SELECT id FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
      return res.status(201).json({ id: created.id, image_url: imageUrl || undefined });
    });
    return;
  }

  // JSON text message fallback
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const info = db.prepare('INSERT INTO chat_messages (chat_id, sender_id, type, text) VALUES (?, ?, ?, ?)')
    .run(chatId, req.user.id, 'text', text);
  const created = db.prepare('SELECT id FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ id: created.id });
});

// Настройка хранилища для баннеров
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public/banners');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `banner-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const uploadBanner = multer({ 
  storage: bannerStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения'), false);
    }
  },
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

const uploadAvatar = multer({ 
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Ошибка: Разрешены только изображения (jpeg, png, gif)!'));
    }
});

// --- Multer Configuration for Item Photos ---
const itemPhotosDir = path.join(uploadsDir, 'items');
if (!fs.existsSync(itemPhotosDir)) fs.mkdirSync(itemPhotosDir, { recursive: true });
const itemPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, itemPhotosDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `item-${unique}${path.extname(file.originalname)}`);
  }
});
const uploadItemPhoto = multer({
  storage: itemPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Разрешены только изображения'), false)
});

// --- Chat message photos ---
const chatPhotosDir = path.join(uploadsDir, 'messages');
if (!fs.existsSync(chatPhotosDir)) fs.mkdirSync(chatPhotosDir, { recursive: true });
const chatPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, chatPhotosDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `chat-${unique}${path.extname(file.originalname)}`);
  }
});
const uploadChatPhoto = multer({
  storage: chatPhotoStorage,
  limits: { fileSize: 7 * 1024 * 1024 }, // 7 MB
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Разрешены только изображения'), false)
});

const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY_CHANGE_IN_PROD';

// --- Auth Middleware ---
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Auth Routes ---
app.post('/api/register', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: 'Никнейм и пароль обязательны' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  try {
    const existingUser = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
    if (existingUser) return res.status(409).json({ error: 'Этот никнейм уже занят' });

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const info = db.prepare('INSERT INTO users (nickname, password_hash) VALUES (?, ?)').run(nickname, hash);
    const token = jwt.sign({ id: info.lastInsertRowid, nickname }, JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: 'Никнейм и пароль обязательны' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
    if (!user) return res.status(401).json({ error: 'Неверный никнейм или пароль' });

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Неверный никнейм или пароль' });

    const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '1d' });
    console.log(`[LOGIN] User '${user.nickname}' (ID: ${user.id}) logged in successfully.`);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// --- User Profile & Actions ---
app.post('/api/avatar', auth, (req, res) => {
    const upload = uploadAvatar.single('avatar');

    upload(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            // A Multer error occurred when uploading.
            console.error('Multer error:', err);
            return res.status(400).json({ message: `Ошибка Multer: ${err.message}` });
        } else if (err) {
            // An unknown error occurred when uploading.
            console.error('Unknown upload error:', err);
            return res.status(400).json({ message: err.message });
        }

        // Everything went fine.
        if (!req.file) {
            return res.status(400).json({ message: 'Файл не был загружен.' });
        }

        try {
            const avatarUrl = path.join('uploads', 'avatars', req.file.filename).replace(/\\/g, '/');
            db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
            res.json({ 
                message: 'Аватар успешно обновлен!',
                avatarUrl: avatarUrl 
            });
        } catch (error) {
            console.error('Ошибка при обновлении аватара в БД:', error);
            res.status(500).json({ message: 'Ошибка сервера при обновлении аватара.' });
        }
    });
});

app.get('/api/me', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  console.log(`[API/ME] Request received for user: ${req.user.nickname} (ID: ${req.user.id})`);
    const user = db.prepare('SELECT id, nickname, balance, frozen AS frozen_balance, avatar_url FROM users WHERE id = ?').get(req.user.id);
  console.log(`[API/ME] DB query for ID ${req.user.id} returned user: ${user ? user.nickname : 'null'}`);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/me/items', auth, (req, res) => {
  const items = db.prepare("SELECT * FROM items WHERE seller_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(items);
});

app.get('/api/me/purchases', auth, (req, res) => {
  const deals = db.prepare(`SELECT d.price, d.created_at, i.name, i.photo_url FROM deals d JOIN items i ON d.item_id = i.id WHERE d.buyer_id = ? ORDER BY d.created_at DESC`).all(req.user.id);
  res.json(deals);
});

app.get('/api/me/sales', auth, (req, res) => {
  const deals = db.prepare(`SELECT d.price, d.created_at, i.name, i.photo_url FROM deals d JOIN items i ON d.item_id = i.id WHERE i.seller_id = ? ORDER BY d.created_at DESC`).all(req.user.id);
  res.json(deals);
});

app.get('/api/finance', auth, (req, res) => {
  const operations = db.prepare("SELECT * FROM operations WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(operations);
});

app.get('/api/me/items', auth, (req, res) => {
    try {
        const items = db.prepare('SELECT * FROM items WHERE seller_id = ? ORDER BY created_at DESC').all(req.user.id);
        res.json(items);
    } catch (err) {
        console.error('Error fetching user items:', err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке товаров' });
    }
});

app.get('/api/me/purchases', auth, (req, res) => {
    try {
        const query = `
            SELECT i.*, d.price as purchase_price, d.created_at as purchase_date
            FROM items i
            JOIN deals d ON i.id = d.item_id
            WHERE d.buyer_id = ?
            ORDER BY d.created_at DESC
        `;
        const purchases = db.prepare(query).all(req.user.id);
        res.json(purchases);
    } catch (err) {
        console.error('Error fetching user purchases:', err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке покупок' });
    }
});

app.get('/api/me/sales', auth, (req, res) => {
    try {
        const query = `
            SELECT 
                i.name, 
                i.photo_url, 
                d.price as sale_price, 
                d.created_at as sale_date,
                u.nickname as buyer_nickname
            FROM deals d
            JOIN items i ON d.item_id = i.id
            JOIN users u ON d.buyer_id = u.id
            WHERE i.seller_id = ?
            ORDER BY d.created_at DESC
        `;
        const sales = db.prepare(query).all(req.user.id);
        res.json(sales);
    } catch (err) {
        console.error('Error fetching user sales:', err);
        res.status(500).json({ error: 'Ошибка сервера при загрузке продаж' });
    }
});

// --- Items (create) ---
app.post('/api/items', auth, (req, res) => {
  const handler = uploadItemPhoto.single('photo');
  handler(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error (item photo):', err);
      return res.status(400).json({ error: `Ошибка загрузки: ${err.message}` });
    } else if (err) {
      console.error('Upload error (item photo):', err);
      return res.status(400).json({ error: err.message });
    }

    const { game_id, name, desc, price } = req.body;
    if (!game_id || !name || !desc || !price) {
      return res.status(400).json({ error: 'game_id, name, desc, price обязательны' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Не загружено фото товара (field: photo)' });
    }

    const priceInt = parseInt(price, 10);
    if (Number.isNaN(priceInt) || priceInt < 0) {
      return res.status(400).json({ error: 'Неверная цена' });
    }

    try {
      // Apply watermark removal on the uploaded image file
      try {
        const absItemPath = path.join(itemPhotosDir, req.file.filename);
        const rawBuf = fs.readFileSync(absItemPath);
        const processed = await removePlayerOkWatermark(rawBuf);
        if (processed && processed.length) {
          fs.writeFileSync(absItemPath, processed);
        }
      } catch (e) {
        console.warn('Watermark removal (manual upload) skipped:', e?.message || e);
      }

      const photoUrl = path.join('uploads', 'items', req.file.filename).replace(/\\/g, '/');
      // Clean and build dedup key (uniform across sources): item|game|seller|normalized_title
      const cleanName = cleanupTitle(name);
      const titleKey = normalizeTitleForDedup(cleanName);
      const gid = parseInt(game_id, 10) || game_id;
      const dedupKey = `item|${gid}|${req.user.id}|${titleKey}`;

      // Pre-check for legacy keys to avoid duplicates with older records
      const legacyManual = `manual|${gid}|${req.user.id}|${titleKey}`;
      const legacyPlayerOk = `playerok|${gid}|${req.user.id}|${titleKey}`;
      const existsAny = db.prepare('SELECT id FROM items WHERE dedup_key IN (?, ?, ?) LIMIT 1').get(dedupKey, legacyManual, legacyPlayerOk);
      if (existsAny) {
        try {
          const absItemPath = path.join(itemPhotosDir, req.file.filename);
          if (fs.existsSync(absItemPath)) fs.unlinkSync(absItemPath);
        } catch (_) {}
        return res.status(409).json({ error: 'Похожий товар уже существует' });
      }

      // Insert with DB-level deduplication
      const stmt = db.prepare(`INSERT OR IGNORE INTO items (game_id, seller_id, name, desc, price, photo_url, status, dedup_key) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`);
      const info = stmt.run(gid, req.user.id, cleanName, desc, priceInt, photoUrl, dedupKey);

      if (info.changes === 0) {
        // Duplicate detected - remove uploaded file and return a conflict error
        try {
          const absItemPath = path.join(itemPhotosDir, req.file.filename);
          if (fs.existsSync(absItemPath)) fs.unlinkSync(absItemPath);
        } catch (e) {
          console.warn('Duplicate manual item - file cleanup warning:', e?.message || e);
        }
        return res.status(409).json({ error: 'Похожий товар уже существует' });
      }

      const created = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
      const response = { ...created, image_url: normalizeMediaUrl(created.photo_url), title: created.name };
      res.status(201).json(response);
    } catch (e) {
      console.error('Create item error:', e);
      res.status(500).json({ error: 'Ошибка сервера при создании товара' });
    }
  });
});

// --- Import from PlayerOK ---
app.post('/api/import/playerok', auth, requireAdmin, async (req, res) => {
  try {
    const { url, game_id, limit, html: pastedHtml } = req.body || {};
    const targetGameId = parseInt(game_id, 10);
    const max = Math.min(parseInt(limit || '50', 10) || 50, 50);
    if (!pastedHtml && (!url || !/^https?:\/\//i.test(url))) return res.status(400).json({ error: 'Некорректный URL или вставьте HTML' });
    if (!Number.isFinite(targetGameId) || targetGameId <= 0) return res.status(400).json({ error: 'Выберите игру (game_id)' });

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Accept-Encoding': 'gzip, deflate, br',
    };
    let html = pastedHtml && String(pastedHtml);
    if (!html) {
      let resp;
      try {
        resp = await fetch(url, { headers: { ...headers, Referer: url }, redirect: 'follow' });
      } catch (e) {
        return res.status(502).json({ error: 'Ошибка сети при обращении к PlayerOK', detail: e.message });
      }
      const status = resp.status;
      if (status >= 400) {
        return res.status(502).json({ error: `PlayerOK ответил статусом ${status}. Возможно, сработала антибот-защита.`, need_html: true });
      }
      html = await resp.text();
    }
    const $ = cheerio.load(html);

    const dbgVal = (req.query?.debug_dom ?? req.body?.debug_dom ?? req.query?.debug_ignore_existing ?? req.body?.debug_ignore_existing ?? '').toString().trim().toLowerCase();
    const verboseDom = (dbgVal === '1' || dbgVal === 'true' || dbgVal === 'yes');
    if (verboseDom) console.log('[PlayerOK][DEBUG] Verbose DOM scan enabled');

    // Helpers
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function attemptWithRetry(fn, retries = 2, baseDelayMs = 500) {
      let lastErr;
      for (let i = 0; i <= retries; i++) {
        try { return await fn(); }
        catch (e) {
          lastErr = e;
          if (i < retries) {
            const wait = baseDelayMs * (i + 1);
            await sleep(wait);
          }
        }
      }
      throw lastErr;
    }

    // Watermark removal: используем глобальную функцию removePlayerOkWatermark, объявленную выше

    function textTrim(el) {
        return $(el).text().replace(/\s+/g, ' ').trim();
    }
    function normalizePrice(str) {
        if (str == null) return NaN;
        const s = String(str).replace(/[\u00A0\s]/g, '').replace(',', '.');
        const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (!m) return NaN;
        const n = parseFloat(m[1]);
        return Number.isFinite(n) ? Math.round(n) : NaN;
    }
    function absUrl(u) {
        try { return new URL(u, url).toString(); } catch { return u; }
    }
    
    function normalizeTitle(s) {
        return (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function imageKey(u) {
        try {
            const uu = new URL(absUrl(u));
            return (uu.pathname || '').replace(/\/+$/, '').toLowerCase();
        } catch {
            return (u || '').toString().split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
        }
    }
    // Create a short, stable token from image/url/price to disambiguate equal titles
    function shortToken(str) {
      const s = String(str || '');
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
      const n = Math.abs(h) % 1000; // 0..999
      return String(n).padStart(3, '0');
    }
    function disambiguateTitle(baseTitle, imgUrl, price) {
      const token = shortToken(imageKey(imgUrl) + '|' + (Number.isFinite(price) ? price : ''));
      const withSuf = `${baseTitle} #${token}`;
      return { title: withSuf, titleKey: normalizeTitleForDedup(withSuf) };
    }

    // Helper: remove price/currency tokens anywhere in the string
    function removePriceTokens(input) {
      let t = (input || '').toString();
      // remove price in parentheses/brackets at end
      t = t.replace(/\s*[\(\[]?\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)\s*[\)\]]?\s*$/gi, '');
      // remove trailing dash + price
      t = t.replace(/\s*[-–—]\s*\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)\s*$/gi, '');
      // remove standalone price tokens globally (start/middle/end)
      const priceToken = /(?:^|[\s\-–—\(\[])(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|[A-Za-zА-Яа-я])/gi;
      let prev;
      do { prev = t; t = t.replace(priceToken, ' '); } while (t !== prev);
      // remove orphan currency symbols without digits around (noise like "₽⚡️ ...")
      t = t.replace(/(?:^|[\s\-–—\(\[])(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)(?=$|[\s\)\]\-–—,.:;]|\D)/gi, ' ');
      // trim leading/trailing separators created by removals
      t = t.replace(/\s*[-–—,:;]+\s*$/g, '');
      t = t.replace(/^[-–—,:;]+\s*/g, '');
      return t;
    }

    // Clean title for display: strip discounts/promo words AND any price tokens
    function cleanupTitle(raw) {
      let t = (raw || '').toString();
      // remove control chars
      t = t.replace(/[\u0000-\u001F\u007F]/g, ' ');
      // strip obvious code blocks
      t = t.replace(/try\s*\{[\s\S]*?\}\s*catch\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/gi, ' ');
      t = t.replace(/function\b[\s\S]{0,600}?\}/gi, ' ');
      // strip common code identifiers
      t = t.replace(/\b(document\.cookie|window\.[a-zA-Z_][\w]*|setCookie|getCookie|deleteCookie|reloadPage)\b/gi, ' ');
      // remove leftover code punctuation
      t = t.replace(/[{};<>]/g, ' ');
      // normalize spaces
      t = t.replace(/\s+/g, ' ').trim();
      if (!t) return '';
      // remove leading numeric token (assumed price) at the very start, even without currency
      // examples: "14 000 ₽Хороший...", "5999PUBG ...", "3 750 ₽ВНЕШКА ..."
      const leadingNum = /^(?:от\s*)?\d[\d\s.,]{0,9}\s*(?:k|к|тыс\.?)*\s*(?:₽|р(?:уб(?:\.|лей|ля)?|\b)|RUB\b|RUR\b)?(?=\s|[A-Za-zА-Яа-я]|$)/i;
      while (leadingNum.test(t)) {
        t = t.replace(leadingNum, ' ').trimStart();
      }
      // remove percent-based discount tokens like "-89%", "+15%", "(50%)"
      t = t.replace(/[\(\[\-–—\s]*[-+−]?\d{1,3}\s*%[\)\]\s]*/g, ' ');
      // remove common discount words
      t = t.replace(/\b(скидк[а-я]*|распродажа|акци[яий]|sale|off)\b/gi, ' ');
      // remove stray separators
      t = t.replace(/[|\/•&]+/g, ' ');
      // remove any currency/price tokens anywhere
      t = removePriceTokens(t);
      // cleanup brackets and extra spaces
      t = t.replace(/[\(\)\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      // collapse excessive punctuation
      t = t.replace(/[\-–—]{2,}/g, '—').replace(/[,.;:]{2,}/g, m => m[0]);
      // final fallback if became empty or too short
      if (!t || t.replace(/[^\p{L}\p{N}]+/gu, '').length < 2) {
        t = 'Товар';
      }
      return t;
    }
    // Normalize title for deduplication: cleaned, lowercased, no trailing code-like numeric suffixes
    function normalizeTitleForDedup(raw) {
      let t = cleanupTitle(raw).toLowerCase();
      // remove trailing long numeric or code-like suffixes (e.g., '- 12345', '#1234', '№ 5678')
      t = t.replace(/(?:\s*[\-–—#№]\s*\d{4,})+$/g, '').trim();
      // remove trailing pure numeric suffixes like ' 123456'
      t = t.replace(/\s+\d{4,}$/g, '').trim();
      t = t.replace(/\s+/g, ' ').trim();
      return t;
    }

    // Try to find a nearby title around the current element: search self, parents (up to 3), siblings, then image filename
    function findNearbyTitle($ctx, txt, priceText, imgSrc) {
      if (!$ctx) return '';
      let cand = $ctx.attr('aria-label') || $ctx.attr('title') || '';
      if (!cand) cand = $ctx.find('[title]').first().attr('title') || '';
      if (!cand) {
        const tNode = $ctx.find('[itemprop="name"],[data-name],[data-title],[data-qa*="title"],[data-testid*="title"],[data-test*="title"]').first();
        cand = tNode.attr('content') || tNode.text() || '';
      }
      cand = cleanupTitle(cand);
      if (cand) return cand;
      // parents
      let p = $ctx.parent();
      for (let i = 0; i < 3 && p && p.length; i++, p = p.parent()) {
        let t = p.find('h1,h2,h3,h4,h5,[class*="title"],[class*="name"],[itemprop="name"],a').first().text() || p.attr('aria-label') || p.attr('title') || '';
        t = cleanupTitle(t);
        if (t) return t;
      }
      // siblings
      const prev = $ctx.prev();
      const next = $ctx.next();
      let sib = cleanupTitle((prev && prev.text()) || '') || cleanupTitle((next && next.text()) || '');
      if (sib) return sib;
      // strip price from txt
      if (txt) {
        let t = String(txt);
        if (priceText) t = t.replace(String(priceText), ' ');
        t = cleanupTitle(t);
        if (t && /[A-Za-zА-Яа-я]/.test(t)) return t;
      }
      // filename
      try {
        const u = new URL(imgSrc || '', url);
        const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
        let base = seg.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        base = cleanupTitle(base);
        if (base) return base;
      } catch {}
      return '';
    }

    // 1) Try JSON-LD structured data
    function toArray(x) { return Array.isArray(x) ? x : (x != null ? [x] : []); }
    function pushCandidate(list, name, price, image) {
      const tClean = cleanupTitle((name || '').toString());
      const tKey = normalizeTitleForDedup(tClean);
      const p = normalizePrice(price);
      let img = Array.isArray(image) ? image[0] : image;
      img = img ? absUrl(img) : '';
      if (tClean && Number.isFinite(p) && img) list.push({ title: tClean, titleKey: tKey, price: p, imageUrl: img });
    }
    function extractFromJsonLdNode(node, out) {
      if (!node || typeof node !== 'object') return;
      const t = node['@type'];
      if (t === 'ItemList' || t === 'CollectionPage' || t === 'SearchResultsPage') {
        const items = toArray(node.itemListElement);
        for (const it of items) {
          const item = it && (it.item || it);
          if (item) extractFromJsonLdNode(item, out);
        }
      } else if (t === 'ListItem') {
        const item = node.item;
        if (item) extractFromJsonLdNode(item, out);
      } else if (t === 'Product' || node.name || node.image || node.offers) {
        const name = node.name || node.title;
        const image = node.image || node.photo || node.thumbnailUrl;
        let price = undefined;
        const offers = node.offers;
        if (offers) {
          if (Array.isArray(offers)) {
            for (const ofr of offers) {
              price = ofr && (ofr.price || ofr.lowPrice || ofr.highPrice);
              if (price) break;
            }
          } else if (typeof offers === 'object') {
            price = offers.price || offers.lowPrice || offers.highPrice;
          }
        }
        pushCandidate(out, name, price, image);
      }
    }
    const jsonLdCards = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      const txt = $(el).contents().text().trim();
      if (!txt) return;
      try {
        const data = JSON.parse(txt);
        const arr = toArray(data);
        for (const node of arr) extractFromJsonLdNode(node, jsonLdCards);
      } catch (_) { /* ignore */ }
    });
    console.log(`[PlayerOK] JSON-LD candidates: ${jsonLdCards.length}`);
    // 2) Try Next.js data (__NEXT_DATA__)
    function collectFromAny(obj, out, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 6 || out.length >= max) return;
      if (Array.isArray(obj)) {
        for (const v of obj) collectFromAny(v, out, depth + 1);
        return;
      }
      const keys = Object.keys(obj);
      const name = obj.name || obj.title;
      const image = obj.image || obj.img || obj.photo || obj.imageUrl || obj.thumbnailUrl || obj.cover || (obj.images && (obj.images[0]?.url || obj.images[0] || obj.images.url));
      const price = obj.price || obj.cost || obj.amount || obj.priceValue || obj.lowPrice || obj.highPrice || (obj.offer && (obj.offer.price || obj.offer.amount || obj.offer.value)) || (obj.prices && (obj.prices[0]?.price || obj.prices[0]));
      if ((name || obj.name_ru || obj.name_en || obj.label) && image && (price != null)) pushCandidate(out, name || obj.name_ru || obj.name_en || obj.label, price, image);
      for (const k of keys) collectFromAny(obj[k], out, depth + 1);
    }
    const nextCards = [];
    const nextScript = $('script#__NEXT_DATA__').first();
    if (nextScript.length) {
      try {
        const txt = nextScript.contents().text().trim();
        if (txt) {
          const data = JSON.parse(txt);
          collectFromAny(data, nextCards);
        }
      } catch (_) { /* ignore */ }
    }
    console.log(`[PlayerOK] __NEXT_DATA__ candidates: ${nextCards.length}`);
    // 3) Merge all sources (JSON-LD, __NEXT_DATA__, DOM) to fill up to max
const cards = [];
const seenTitle = new Set();
const seenImage = new Set();
let inRunAltUsed = 0, inRunDupDrops = 0;
function pushBatch(arr) {
  for (const c of arr) {
    if (!c || !c.title || !Number.isFinite(c.price) || !c.imageUrl) continue;
    let keyT = (c.titleKey || normalizeTitleForDedup(c.title)) + '';
    let t = c.title;
    const imgK = imageKey(c.imageUrl);
    if (imgK && seenImage.has(imgK)) continue; // avoid multiple items for same image
    if (seenTitle.has(keyT)) {
      // try to make it unique in-run using a stable short suffix
      const alt = disambiguateTitle(t, c.imageUrl, c.price);
      if (!seenTitle.has(alt.titleKey)) {
        keyT = alt.titleKey;
        t = alt.title;
        inRunAltUsed++;
      } else {
        // second attempt with alphabetic suffixes to keep uniqueness during this run
        const suffixes = ['-a','-b','-c','-d','-e','-f','-g','-h','-i','-j','-k','-l','-m','-n','-o','-p','-q','-r','-s','-t','-u','-v','-w','-x','-y','-z','-1','-2','-3','-4','-5','-6','-7','-8','-9'];
        let found = null;
        for (const suf of suffixes) {
          const candTitle = `${t} ${suf}`;
          const candKey = normalizeTitleForDedup(candTitle);
          if (!seenTitle.has(candKey)) { found = { key: candKey, title: candTitle }; break; }
        }
        if (found) {
          keyT = found.key;
          t = found.title;
          inRunAltUsed++;
        } else {
          inRunDupDrops++;
          continue; // still duplicate
        }
      }
    }
    seenTitle.add(keyT);
    if (imgK) seenImage.add(imgK);
    cards.push({ title: t, titleKey: keyT, price: c.price, imageUrl: c.imageUrl });
    if (cards.length >= max) return;
  }
}
if (jsonLdCards.length) pushBatch(jsonLdCards);
if (cards.length < max && nextCards.length) pushBatch(nextCards);
if (cards.length < max) {
  const currencyRe = /(₽|руб|RUB|\$|USD|€|EUR|грн|₴)/i;
  let domTotal = 0, domPass = 0, domSkipNoTitle = 0, domSkipNoPrice = 0, domSkipZeroPrice = 0, domSkipNoImg = 0, domSkipDupLocal = 0;
  $('a, div, li, article, section, main').each((i, el) => {
    if (cards.length >= max) return false;
    const $el = $(el);
    const txt = textTrim($el);
    domTotal++;

    // Картинка: может быть <img>, <source>, background-image или data-* атрибут
    const img = $el.find('img').first();

    // Заголовок: alt, aria-label, title-атрибуты и видимые текстовые узлы/семантические поля
    const titleCand = img.attr('alt')
      || $el.attr('aria-label')
      || $el.attr('title')
      || $el.find('[title]').first().attr('title')
      || $el.find('[data-qa*="title"],[data-testid*="title"],[data-test*="title"],[data-name],[data-title],[itemprop="name"]').first().attr('content')
      || $el.find('[data-qa*="title"],[data-testid*="title"],[data-test*="title"],[data-name],[data-title],[itemprop="name"]').first().text()
      || $el.find('h1,h2,h3,h4,h5,[class*="title"],[class*="name"],[class*="caption"],[class*="card"],[class*="MuiTypography"],a,span,p').first().text();
    let title = (titleCand || '').replace(/\s+/g, ' ').trim();
    // fallback to nearby if too short or generic — define after priceText is computed
    let tFallback = '';

    // Цена: сначала пробуем явные узлы цены, затем регулярки с валютой, затем fallback — длинный числовой блок
    let priceText = '';
    const priceNode = $el.find('[class*="price"],[data-qa*="price"],[data-testid*="price"],[data-test*="price"],[itemprop="price"]').first();
    if (priceNode.length) {
      priceText = priceNode.text() || priceNode.attr('content') || priceNode.attr('value') || '';
    }
    if (!priceText) {
      // data-* варианты
      priceText = $el.attr('data-price') || $el.attr('data-amount') || $el.attr('data-cost') || '';
    }
    if (!priceText) {
      // Попытка вытащить по валюте
      const m = txt.match(/([0-9\s\u00A0\.,]+)\s*(₽|руб|RUB|\$|USD|€|EUR|грн|₴)/i);
      if (m) priceText = m[1];
    }
    if ((!title || cleanupTitle(title).length < 4) && !tFallback) tFallback = findNearbyTitle($el, txt, priceText, '');
    let price = 0;
    if (priceText) {
      const nstr = (priceText.match(/[0-9\s\u00A0\.,]+/) || ['0'])[0]
        .replace(/[\s\u00A0,]+/g, '')
        .replace(',', '.');
      const n = parseFloat(nstr);
      if (Number.isFinite(n)) price = Math.round(n);
    } else {
      // Fallback: ищем первый "длинный" числовой блок (например 4+ цифры)
      const mNum = txt.match(/(?:^|[^0-9])([0-9][0-9\s\u00A0\.,]{3,})(?![0-9])/);
      if (mNum) {
        const nstr = mNum[1].replace(/[\s\u00A0,]+/g, '').replace(',', '.');
        const n = parseFloat(nstr);
        if (Number.isFinite(n)) price = Math.round(n);
      }
    }

    // Источник изображения
    let src = '';
    if (img && img.length) {
      src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy') || '';
      if (!src) {
        const ss = img.attr('srcset') || img.attr('data-srcset') || '';
        if (ss) src = ss.split(',')[0].trim().split(' ')[0];
      }
    }
    if (!src) {
      const source = $el.find('source[srcset], source[data-srcset]').first();
      const sset = source.attr('srcset') || source.attr('data-srcset') || '';
      if (sset) src = sset.split(',')[0].trim().split(' ')[0];
    }
    if (!src) {
      // Фоновые изображения
      let styleAttr = '';
      const bgNode = $el.find('[style*=background]').first();
      if (bgNode && bgNode.length) styleAttr = bgNode.attr('style') || '';
      if (!styleAttr) {
        const selfStyle = $el.attr('style') || '';
        if (/background/i.test(selfStyle)) styleAttr = selfStyle;
      }
      if (styleAttr) {
        const m = styleAttr.match(/url\((['\"]?)([^)\"']+)\1\)/i);
        if (m && m[2]) src = m[2].trim();
      }
    }
    if (!src) {
      // Популярные data-* атрибуты для ленивых картинок и семантические поля
      const dataImgNode = $el.find('[data-bg], [data-background], [data-background-image], [data-original], [data-src], [data-lazy], [data-image], [data-img], [data-thumbnail], [itemprop="image"]').first();
      src = dataImgNode.attr('data-bg')
        || dataImgNode.attr('data-background')
        || dataImgNode.attr('data-background-image')
        || dataImgNode.attr('data-original')
        || dataImgNode.attr('data-src')
        || dataImgNode.attr('data-lazy')
        || dataImgNode.attr('data-image')
        || dataImgNode.attr('data-img')
        || dataImgNode.attr('data-thumbnail')
        || dataImgNode.attr('content')
        || '';
    }
    src = absUrl(src);
    if (!title || cleanupTitle(title).length < 4) title = findNearbyTitle($el, txt, priceText, src) || tFallback || title;

    const tClean = cleanupTitle(title);
    const tKey = normalizeTitleForDedup(tClean);
    const imgK2 = imageKey(src);
    if (tClean && Number.isFinite(price) && price > 0 && src && !(imgK2 && seenImage.has(imgK2))) {
      if (!seenTitle.has(tKey)) {
        seenTitle.add(tKey);
        if (imgK2) seenImage.add(imgK2);
        cards.push({ title: tClean, titleKey: tKey, price, imageUrl: src });
        domPass++;
      } else {
        // duplicate within same run — add stable short suffix to keep uniqueness
        const alt = disambiguateTitle(tClean, src, price);
        if (!seenTitle.has(alt.titleKey)) {
          seenTitle.add(alt.titleKey);
          if (imgK2) seenImage.add(imgK2);
          cards.push({ title: alt.title, titleKey: alt.titleKey, price, imageUrl: src });
          domPass++;
        } else {
          // second attempt with alphabetic suffixes
          const suffixes = ['-a','-b','-c','-d','-e','-f','-g','-h','-i','-j','-k','-l','-m','-n','-o','-p','-q','-r','-s','-t','-u','-v','-w','-x','-y','-z','-1','-2','-3','-4','-5','-6','-7','-8','-9'];
          let found = null;
          for (const suf of suffixes) {
            const candTitle = `${tClean} ${suf}`;
            const candKey = normalizeTitleForDedup(candTitle);
            if (!seenTitle.has(candKey)) { found = { title: candTitle, key: candKey }; break; }
          }
          if (found) {
            seenTitle.add(found.key);
            if (imgK2) seenImage.add(imgK2);
            cards.push({ title: found.title, titleKey: found.key, price, imageUrl: src });
            domPass++;
          } else {
            domSkipDupLocal++;
          }
        }
      }
    } else {
      if (!tClean) domSkipNoTitle++;
      else if (!priceText) domSkipNoPrice++;
      else if (!(Number.isFinite(price) && price > 0)) domSkipZeroPrice++;
      else if (!src) domSkipNoImg++;
    }
  });
  if (verboseDom) console.log(`[PlayerOK][DEBUG] DOM scan summary: total=${domTotal}, pass=${domPass}, skipNoTitle=${domSkipNoTitle}, skipNoPrice=${domSkipNoPrice}, skipZeroPrice=${domSkipZeroPrice}, skipNoImg=${domSkipNoImg}, skipDup=${domSkipDupLocal}`);
}
console.log(`[PlayerOK] merged cards: ${cards.length}`, cards.slice(0, Math.min(5, cards.length)).map(c => ({ t: c.title, price: c.price })));
if (verboseDom) console.log(`[PlayerOK][DEBUG] in-run alt used=${inRunAltUsed}, dup drops=${inRunDupDrops}`);
// Auto-pagination: if we found less than requested and we have a URL (not pasted HTML),
// try to follow "next" links up to a few hops to collect more items.
if (cards.length < max && !pastedHtml && url) {
  function findNextUrlLocal($doc) {
    try {
      const href = $doc('link[rel="next"]').attr('href')
        || $doc('a[rel="next"]').attr('href')
        || $doc('a[aria-label*="след"], a[aria-label*="След"], a[aria-label*="next"], a[title*="След"], a[title*="Next"], a[class*="next"]').first().attr('href')
        || '';
      return href ? absUrl(href) : '';
    } catch { return ''; }
  }
  function scanDomForCards($doc) {
    const currencyRe = /(₽|руб|RUB|\$|USD|€|EUR|грн|₴)/i;
    let total = 0, pass = 0, skipNoTitle = 0, skipNoPrice = 0, skipZeroPrice = 0, skipNoImg = 0, skipDup = 0;
    $doc('a, div, li, article, section, main').each((i, el) => {
      if (cards.length >= max) return false;
      const $el = $doc(el);
      const txt = textTrim($el);
      total++;

      const img = $el.find('img').first();
      const titleCand = (img.attr('alt')
        || $el.attr('aria-label')
        || $el.find('h1,h2,h3,h4,h5,[class*="title"],[class*="name"],[class*="caption"],[class*="card"],[class*="MuiTypography"],a,span,p').first().text());
      let title = (titleCand || '').replace(/\s+/g, ' ').trim();

      let priceText = '';
      const priceNode = $el.find('[class*="price"],[data-qa*="price"],[data-testid*="price"],[data-test*="price"]').first();
      if (priceNode.length) {
        priceText = priceNode.text();
      } else {
        const m = txt.match(/([0-9\s\u00A0\.,]+)\s*(₽|руб|RUB|\$|USD|€|EUR|грн|₴)/i);
        if (m) priceText = m[1];
      }
      if (!title || cleanupTitle(title).length < 4) title = findNearbyTitle($el, txt, priceText, '');
      let price = 0;
      if (priceText) {
        const nstr = (priceText.match(/[0-9\s\u00A0\.,]+/) || ['0'])[0].replace(/[\s\u00A0,]+/g, '').replace(',', '.');
        const n = parseFloat(nstr);
        if (Number.isFinite(n)) price = Math.round(n);
      } else {
        const mNum = txt.match(/(?:^|[^0-9])([0-9][0-9\s\u00A0\.,]{3,})(?![0-9])/);
        if (mNum) {
          const nstr = mNum[1].replace(/[\s\u00A0,]+/g, '').replace(',', '.');
          const n = parseFloat(nstr);
          if (Number.isFinite(n)) price = Math.round(n);
        }
      }

      let src = '';
      if (img && img.length) {
        src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy') || '';
        if (!src) {
          const ss = img.attr('srcset') || img.attr('data-srcset') || '';
          if (ss) src = ss.split(',')[0].trim().split(' ')[0];
        }
      }
      if (!src) {
        const source = $el.find('source[srcset], source[data-srcset]').first();
        const sset = source.attr('srcset') || source.attr('data-srcset') || '';
        if (sset) src = sset.split(',')[0].trim().split(' ')[0];
      }
      if (!src) {
        let styleAttr = '';
        const bgNode = $el.find('[style*=background]').first();
        if (bgNode && bgNode.length) styleAttr = bgNode.attr('style') || '';
        if (!styleAttr) {
          const selfStyle = $el.attr('style') || '';
          if (/background/i.test(selfStyle)) styleAttr = selfStyle;
        }
        if (styleAttr) {
          const m = styleAttr.match(/url\((['\"]?)([^)\"']+)\1\)/i);
          if (m && m[2]) src = m[2].trim();
        }
      }
      if (!src) {
        const dataImgNode = $el.find('[data-bg], [data-background], [data-background-image], [data-original], [data-src], [data-lazy]').first();
        src = dataImgNode.attr('data-bg')
          || dataImgNode.attr('data-background')
          || dataImgNode.attr('data-background-image')
          || dataImgNode.attr('data-original')
          || dataImgNode.attr('data-src')
          || dataImgNode.attr('data-lazy')
          || '';
      }
      src = absUrl(src);

      const tClean = cleanupTitle(title);
      const tKey = normalizeTitleForDedup(tClean);
      const imgK = imageKey(src);
      if (tClean && Number.isFinite(price) && price > 0 && src && !(imgK && seenImage.has(imgK))) {
        if (!seenTitle.has(tKey)) {
          seenTitle.add(tKey);
          if (imgK) seenImage.add(imgK);
          cards.push({ title: tClean, titleKey: tKey, price, imageUrl: src });
          pass++;
        } else {
          const alt = disambiguateTitle(tClean, src, price);
          if (!seenTitle.has(alt.titleKey)) {
            seenTitle.add(alt.titleKey);
            if (imgK) seenImage.add(imgK);
            cards.push({ title: alt.title, titleKey: alt.titleKey, price, imageUrl: src });
            pass++;
          } else {
            const suffixes = ['-a','-b','-c','-d','-e','-f','-g','-h','-i','-j','-k','-l','-m','-n','-o','-p','-q','-r','-s','-t','-u','-v','-w','-x','-y','-z','-1','-2','-3','-4','-5','-6','-7','-8','-9'];
            let found = null;
            for (const suf of suffixes) {
              const candTitle = `${tClean} ${suf}`;
              const candKey = normalizeTitleForDedup(candTitle);
              if (!seenTitle.has(candKey)) { found = { title: candTitle, key: candKey }; break; }
            }
            if (found) {
              seenTitle.add(found.key);
              if (imgK) seenImage.add(imgK);
              cards.push({ title: found.title, titleKey: found.key, price, imageUrl: src });
              pass++;
            } else {
              skipDup++;
            }
          }
        }
      } else {
        if (!tClean) skipNoTitle++;
        else if (!priceText) skipNoPrice++;
        else if (!(Number.isFinite(price) && price > 0)) skipZeroPrice++;
        else if (!src) skipNoImg++;
      }
    });
    if (verboseDom) console.log(`[PlayerOK][DEBUG] DOM next-page scan: total=${total}, pass=${pass}, skipNoTitle=${skipNoTitle}, skipNoPrice=${skipNoPrice}, skipZeroPrice=${skipZeroPrice}, skipNoImg=${skipNoImg}, skipDup=${skipDup}`);
  }

  let nextUrl = '';
  try { nextUrl = findNextUrlLocal($); } catch {}
  const visited = new Set();
  let hops = 0;
  while (cards.length < max && nextUrl && hops < 5) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    console.log('[PlayerOK] fetching next page:', nextUrl);
    let nh;
    try {
      const r = await fetch(nextUrl, { headers: { ...headers, Referer: url }, redirect: 'follow' });
      if (!r.ok) break;
      nh = await r.text();
    } catch (e) {
      console.warn('Next page fetch failed:', e?.message || e);
      break;
    }
    const $n = cheerio.load(nh);
    try {
      const jsonBatch = [];
      $n('script[type="application/ld+json"]').each((i, el) => {
        const txt = $n(el).contents().text().trim();
        if (!txt) return;
        try {
          const data = JSON.parse(txt);
          const arr = toArray(data);
          for (const node of arr) extractFromJsonLdNode(node, jsonBatch);
        } catch (_) { /* ignore */ }
      });
      if (jsonBatch.length) pushBatch(jsonBatch);
    } catch (_) { /* ignore */ }
    if (cards.length < max) {
      try {
        const arr = [];
        const sc = $n('script#__NEXT_DATA__').first();
        if (sc.length) {
          const txt = sc.contents().text().trim();
          if (txt) {
            const data = JSON.parse(txt);
            collectFromAny(data, arr);
          }
        }
        if (arr.length) pushBatch(arr);
      } catch (_) { /* ignore */ }
    }
    if (cards.length < max) scanDomForCards($n);
    console.log(`[PlayerOK] after next page: cards=${cards.length}`);
    nextUrl = findNextUrlLocal($n);
    hops++;
  }
}

// Build set of existing title keys in DB to avoid duplicates across runs
const existingRows = db.prepare('SELECT name FROM items WHERE game_id = ? AND seller_id = ?').all(targetGameId, req.user.id);
const existingTitleKeys = new Set(existingRows.map(r => normalizeTitleForDedup(r.name)));
const sampleExisting = existingRows.slice(0, Math.min(10, existingRows.length)).map(r => ({ name: r.name, key: normalizeTitleForDedup(r.name) }));
console.log(`[PlayerOK] existingTitleKeys: ${existingTitleKeys.size}`, sampleExisting);

  // Debug: optionally ignore existing keys via flag (query or body): accepts 1/true/yes
  const dbgRaw = (req.query?.debug_ignore_existing ?? req.body?.debug_ignore_existing ?? '').toString().trim().toLowerCase();
  const debugIgnoreExisting = dbgRaw === '1' || dbgRaw === 'true' || dbgRaw === 'yes';
  if (debugIgnoreExisting) console.log('[PlayerOK][DEBUG] ignoring existingTitleKeys for uniq filtering');

// Debug: show first cards with keys and whether they exist already
const sampleCards = cards.slice(0, Math.min(10, cards.length)).map(c => ({ t: c.title, key: c.titleKey || normalizeTitleForDedup(c.title), inExisting: existingTitleKeys.has(c.titleKey || normalizeTitleForDedup(c.title)) }));
console.log('[PlayerOK] cards sample with keys:', sampleCards);

  // Deduplicate by normalized title only (ignore discounts and random suffixes)
  const uniq = [];
  const seen = new Set(existingTitleKeys);
  let skipExistingCount = 0;
  let skipInRunCount = 0;
  let usedAltCount = 0;
  for (const c of cards) {
    let key = c.titleKey || normalizeTitleForDedup(c.title);
    let item = c;
    if (seen.has(key)) {
      // Try to disambiguate not only in-run duplicates, but also against DB-existing keys
      const alt = disambiguateTitle(c.title, c.imageUrl, c.price);
      if (!seen.has(alt.titleKey)) {
        item = { ...c, title: alt.title, titleKey: alt.titleKey };
        key = alt.titleKey;
        usedAltCount++;
      } else {
        // Second attempt: try additional stable suffixes to avoid DB/in-run collisions
        const suffixes = ['-a','-b','-c','-d','-e','-f','-g','-h','-i','-j','-k','-l','-m','-n','-o','-p','-q','-r','-s','-t','-u','-v','-w','-x','-y','-z','-1','-2','-3','-4','-5','-6','-7','-8','-9'];
        let found = null;
        for (const suf of suffixes) {
          const candTitle = `${alt.title}${suf}`;
          const candKey = normalizeTitleForDedup(candTitle);
          if (!seen.has(candKey)) { found = { title: candTitle, titleKey: candKey }; break; }
        }
        if (found) {
          item = { ...c, title: found.title, titleKey: found.titleKey };
          key = found.titleKey;
          usedAltCount++;
        } else {
          // If debugIgnoreExisting is ON, do not skip here; keep the original item.
          if (!debugIgnoreExisting) {
            if (existingTitleKeys.has(key) || existingTitleKeys.has(alt.titleKey)) skipExistingCount++; else skipInRunCount++;
            continue;
          }
        }
      }
    }
    seen.add(key);
    uniq.push(item);
    if (uniq.length >= max) break;
  }
console.log(`[PlayerOK] uniq to process: ${uniq.length} (usedAlt=${usedAltCount}, skipExisting=${skipExistingCount}, skipInRun=${skipInRunCount})`, uniq.slice(0, Math.min(5, uniq.length)).map(u => `${u.title} [${u.titleKey || normalizeTitleForDedup(u.title)}]`));
const created = [];
const errors = [];
let dbDupCount = 0;
for (const it of uniq) {
    try {
        // Build DB-level dedup key per item by title (discounts/suffix stripped)
        const titleKey = it.titleKey || normalizeTitleForDedup(it.title);
        const dedupKey = `item|${targetGameId}|${req.user.id}|${titleKey}`;
        // Fast skip if already exists (check legacy prefixes too)
        const legacyManual = `manual|${targetGameId}|${req.user.id}|${titleKey}`;
        const legacyPlayerOk = `playerok|${targetGameId}|${req.user.id}|${titleKey}`;
        const existed = db.prepare('SELECT id FROM items WHERE dedup_key IN (?, ?, ?)').get(dedupKey, legacyManual, legacyPlayerOk);
        if (existed) continue;
    // download image with retries for transient statuses
    const { buf, contentType } = await attemptWithRetry(async () => {
      const resp = await fetch(it.imageUrl, {
        headers: {
          ...headers,
          Referer: url,
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
        }
      });
      const st = resp.status;
      if (!resp.ok) {
        const isTransient = st >= 500 || st === 429 || st === 408 || st === 425 || st === 423;
        const err = new Error(`image status ${st}`);
        if (isTransient) throw err; // retry
        // non-transient
        throw err;
      }
      const arr = await resp.arrayBuffer();
      return { buf: Buffer.from(arr), contentType: resp.headers.get('content-type') || '' };
    }, 2, 700);

        // extension
        const ct = contentType || '';
        let ext = '.jpg';
        if (ct.includes('png')) ext = '.png';
        else if (ct.includes('webp')) ext = '.webp';
        else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
        else if (ct.includes('gif')) ext = '.gif';

        // filename
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const filename = `item-${unique}${ext}`;
        const absPath = path.join(itemPhotosDir, filename);

        // optional watermark removal (bottom-right "Playerok")
        let finalBuf = buf;
        try { finalBuf = await removePlayerOkWatermark(buf); } catch (_) { /* keep original */ }

        // write file (retry if occasional fs error)
        await attemptWithRetry(async () => { fs.writeFileSync(absPath, finalBuf); }, 1, 300);
        const photoUrl = path.join('uploads', 'items', filename).replace(/\\/g, '/');

        // insert item with DB-level deduplication
        const stmt = db.prepare(`INSERT OR IGNORE INTO items (game_id, seller_id, name, desc, price, photo_url, status, dedup_key) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`);
        const info = stmt.run(targetGameId, req.user.id, it.title, '', it.price, photoUrl, dedupKey);
        if (info.changes === 0) {
          // Duplicate detected (DB dedup via dedup_key). Remove orphan file and skip
          try { fs.unlinkSync(absPath); } catch (_) {}
          dbDupCount++;
          console.log(`[PlayerOK] DB dedup skip: key=${dedupKey} title="${it.title}"`);
          continue;
        }
        created.push({ id: info.lastInsertRowid, title: it.title, price: it.price, photo_url: photoUrl });
        existingTitleKeys.add(titleKey);
      } catch (e) {
        errors.push({ title: it.title, imageUrl: it.imageUrl, error: String(e?.message || e) });
      }
    }

    res.json({ 
      totalFound: cards.length, 
      processed: uniq.length, 
      createdCount: created.length, 
      created, 
      errors,
      stats: { usedAlt: usedAltCount, skipExisting: skipExistingCount, skipInRun: skipInRunCount, dbDup: dbDupCount }
    });
  } catch (e) {
    console.error('PlayerOK import error:', e);
    res.status(500).json({ error: 'Ошибка импорта с PlayerOK' });
  }
});

// --- Finance Wizard API Endpoints ---
app.get('/api/finance/countries', auth, (req, res) => {
    res.json([
        { code: 'RU', name: 'Россия' },
        { code: 'KZ', name: 'Казахстан' },
        { code: 'UA', name: 'Украина' },
    ]);
});

app.get('/api/finance/banks', auth, (req, res) => {
    const { country } = req.query;
    const banks = {
        'RU': [{ id: 'sber', name: 'Сбербанк' }, { id: 'tinkoff', name: 'Тинькофф' }, { id: 'alfa', name: 'Альфа-Банк' }],
        'KZ': [{ id: 'kaspi', name: 'Kaspi Bank' }, { id: 'halyk', name: 'Halyk Bank' }],
        'UA': [{ id: 'privat', name: 'ПриватБанк' }, { id: 'mono', name: 'Monobank' }]
    };
    res.json(banks[country] || []);
});

app.post('/api/finance/topup', auth, (req, res) => {
    const { amount, bank } = req.body;
    if (!amount || !bank) return res.status(400).json({ error: 'Amount and bank are required' });
    const comment = Math.floor(100000 + Math.random() * 900000);
    // In a real app, you would save this request to the DB
    db.prepare('INSERT INTO operations (user_id, type, amount, status) VALUES (?, ?, ?, ?)')
      .run(req.user.id, 'topup', amount, 'pending');

    res.json({
        success: true,
        paymentDetails: '1234 5678 9101 1121', // Mock details
        amount: parseFloat(amount).toFixed(2),
        comment: comment.toString()
    });
});

// Create a withdrawal request
app.post('/api/finance/withdraw', auth, (req, res) => {
    const { amount, bank, country, cardNumber } = req.body;
    if (!amount || !bank || !country || !cardNumber) {
        return res.status(400).json({ error: 'Все поля обязательны для вывода' });
    }
    if (!/^\d{16}$/.test(cardNumber)) {
        return res.status(400).json({ error: 'Неверный формат номера карты' });
    }

    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Неверная сумма' });
    }

    const withdraw = db.transaction(() => {
        const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
        if (user.balance < parsedAmount) {
            return res.status(400).json({ error: 'Недостаточно средств на балансе' });
        }

        const newBalance = user.balance - parsedAmount;
        db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, req.user.id);
        db.prepare('INSERT INTO operations (user_id, type, amount, status) VALUES (?, ?, ?, ?)')
          .run(req.user.id, 'withdraw', parsedAmount, 'pending');
        
        res.json({ success: true, message: 'Заявка на вывод успешно создана' });
    });

    try {
        withdraw();
    } catch (err) {
        if (!res.headersSent) { // Avoid error if transaction already sent a response
             console.error('Withdrawal error:', err);
             res.status(500).json({ error: 'Ошибка сервера при создании заявки на вывод' });
        }
    }
});

// --- Public Catalog API ---
app.get('/api/games', (req, res) => {
  const games = db.prepare('SELECT * FROM games ORDER BY name').all();
  const mapped = games.map(g => {
    let b = (g.banner_url || '').toString().trim();
    if (b) {
      if (/^https?:\/\//i.test(b) || b.startsWith('data:')) {
        // keep as is
      } else {
        // ensure leading slash and strip optional /public prefix
        b = b.replace(/^\.?\/+/, '/');
        b = b.replace(/^\/public\//, '/');
        if (!b.startsWith('/')) b = '/' + b;
      }
    }
    return { ...g, banner_url: b };
  });
  res.json(mapped);
});

// Upload/update game banner
app.post('/api/games/:id/banner', auth, (req, res) => {
  const upload = uploadBanner.single('banner');
  upload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Файл слишком большой. Максимальный размер 15 МБ' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Файл баннера не получен' });
    }
    const gameId = req.params.id;
    const bannerUrl = `/banners/${req.file.filename}`;
    try {
      const upd = db.prepare('UPDATE games SET banner_url = ? WHERE id = ?');
      upd.run(bannerUrl, gameId);
      return res.json({ bannerUrl });
    } catch (e) {
      console.error('Banner save error:', e);
      return res.status(500).json({ error: 'Ошибка сохранения баннера' });
    }
  });
});

// Create a new game (admin/auth required)
app.post('/api/games', auth, (req, res) => {
  try {
    const { name, category } = req.body || {};
    if (!name || !category) {
      return res.status(400).json({ error: 'name and category are required' });
    }
    const insert = db.prepare('INSERT INTO games (name, category) VALUES (?, ?)');
    const info = insert.run(name, category);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(game);
  } catch (err) {
    console.error('Create game error:', err);
    res.status(500).json({ error: 'Server error while creating game' });
  }
});

// Delete a game (admin/auth required)
app.delete('/api/games/:id', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Некорректный id' });

  try {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    if (!game) return res.status(404).json({ error: 'Игра не найдена' });

    const itemsCount = db.prepare('SELECT COUNT(*) AS c FROM items WHERE game_id = ?').get(id).c;
    if (itemsCount > 0) {
      return res.status(400).json({ error: 'Нельзя удалить игру с товарами. Сначала удалите или перенесите товары.' });
    }

    // Try to remove banner file if it exists
    if (game.banner_url) {
      try {
        const rel = game.banner_url.replace(/^\/+/, ''); // remove leading slashes
        const bannerAbs = path.join(__dirname, 'public', rel);
        if (fs.existsSync(bannerAbs)) {
          fs.unlinkSync(bannerAbs);
        }
      } catch (e) {
        console.warn('Banner delete warning:', e.message);
      }
    }

    db.prepare('DELETE FROM games WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete game error:', e);
    res.status(500).json({ error: 'Ошибка сервера при удалении игры' });
  }
});

app.get('/api/items/hot', (req, res) => {
  const items = db.prepare("SELECT * FROM items WHERE status = 'active' ORDER BY RANDOM() LIMIT 5").all();
  const mapped = items.map(i => ({ ...i, image_url: normalizeMediaUrl(i.photo_url), title: i.name }));
  res.json(mapped);
});

app.get('/api/items/all', (req, res) => {
  const items = db.prepare("SELECT * FROM items WHERE status = 'active' ORDER BY RANDOM()").all();
  const mapped = items.map(i => ({ ...i, image_url: normalizeMediaUrl(i.photo_url), title: i.name }));
  res.json(mapped);
});

app.get('/api/items/game/:game_id', (req, res) => {
    const { game_id } = req.params;
    const items = db.prepare("SELECT * FROM items WHERE game_id = ? AND status = 'active'").all(game_id);
    const mapped = items.map(i => ({ ...i, image_url: normalizeMediaUrl(i.photo_url), title: i.name }));
    res.json(mapped);
});

// --- Admin maintenance: sanitize existing item titles (remove price tokens) ---
app.post('/api/admin/items/sanitize-titles', auth, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name FROM items').all();
    let updated = 0;
    const upd = db.prepare('UPDATE items SET name = ? WHERE id = ?');
    const trx = db.transaction((arr) => {
      for (const r of arr) {
        const cleaned = cleanupTitle(r.name);
        if (cleaned && cleaned !== r.name) { upd.run(cleaned, r.id); updated++; }
      }
    });
    trx(rows);
    res.json({ success: true, updated });
  } catch (e) {
    console.error('Sanitize titles error:', e);
    res.status(500).json({ error: 'Ошибка очистки названий' });
  }
});

// --- Admin: users & balances ---
// Search users by nickname
app.get('/api/admin/users', auth, requireAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);
  try {
    let rows;
    if (q) {
      rows = db.prepare(`SELECT id, nickname, balance, frozen AS frozen_balance, avatar_url FROM users WHERE nickname LIKE ? ORDER BY id LIMIT ?`).all(`%${q}%`, limit);
    } else {
      rows = db.prepare(`SELECT id, nickname, balance, frozen AS frozen_balance, avatar_url FROM users ORDER BY id DESC LIMIT ?`).all(limit);
    }
    res.json(rows);
  } catch (e) {
    console.error('Admin users search error:', e);
    res.status(500).json({ error: 'Ошибка поиска пользователей' });
  }
});

// Get single user
app.get('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const u = db.prepare('SELECT id, nickname, balance, frozen AS frozen_balance, avatar_url FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(u);
});

// Credit balance to user (positive to credit, negative to debit)
app.post('/api/admin/users/:id/credit', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  let { amount, reason } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  amount = parseInt(amount, 10);
  if (isNaN(amount) || amount === 0) return res.status(400).json({ error: 'Некорректная сумма' });
  // Не позволяем уводить баланс в минус списанием
  if (amount < 0 && user.balance + amount < 0) return res.status(400).json({ error: 'Недостаточно средств для списания' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, id);
    db.prepare('INSERT INTO operations (user_id, type, amount, status) VALUES (?, ?, ?, ?)')
      .run(id, amount > 0 ? 'admin_credit' : 'admin_debit', Math.abs(amount), 'completed');
    return db.prepare('SELECT id, nickname, balance, frozen AS frozen_balance FROM users WHERE id = ?').get(id);
  });
  try {
    const updated = tx();
    res.json({ success: true, user: updated });
  } catch (e) {
    console.error('Admin credit error:', e);
    res.status(500).json({ error: 'Ошибка изменения баланса' });
  }
});

// --- Admin: items management ---
// List items with filters for admin
app.get('/api/admin/items', auth, requireAdmin, (req, res) => {
  try {
    const { game_id, q, status, limit, offset } = req.query || {};
    const clauses = ['1=1'];
    const params = [];
    const lim = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset || '0', 10) || 0, 0);

    if (game_id) {
      const gid = parseInt(game_id, 10);
      if (Number.isFinite(gid)) { clauses.push('i.game_id = ?'); params.push(gid); }
    }
    const qs = (q || '').toString().trim().toLowerCase();
    if (qs) { clauses.push('LOWER(i.name) LIKE ?'); params.push(`%${qs}%`); }
    const st = (status || '').toString().trim();
    if (st && st !== 'all') { clauses.push('i.status = ?'); params.push(st); }

    const sql = `
      SELECT i.*, u.nickname as seller_nickname
      FROM items i
      LEFT JOIN users u ON u.id = i.seller_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY i.id DESC
      LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, lim, off);
    const mapped = rows.map(r => ({
      ...r,
      image_url: normalizeMediaUrl(r.photo_url),
      title: r.name,
    }));
    res.json(mapped);
  } catch (e) {
    console.error('Admin list items error:', e);
    res.status(500).json({ error: 'Ошибка загрузки товаров' });
  }
});

// Admin diagnostic: check existence of item photo files
app.get('/api/admin/items/check-photos', auth, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, photo_url FROM items').all();
    const missing = [];
    let ok = 0;
    for (const r of rows) {
      const p = (r.photo_url || '').toString().trim();
      if (!p) { missing.push({ id: r.id, reason: 'empty_photo_url' }); continue; }
      // normalize: ensure without leading slash to join with __dirname
      const rel = p.replace(/^\/+/, '');
      const abs = path.join(__dirname, rel);
      if (fs.existsSync(abs)) ok++; else missing.push({ id: r.id, photo_url: p, abs });
    }
    res.json({ total: rows.length, ok, missing_count: missing.length, missing });
  } catch (e) {
    console.error('Admin check-photos error:', e);
    res.status(500).json({ error: 'Ошибка проверки фотографий товаров' });
  }
});

// Delete a single item by id (admin)
app.delete('/api/admin/items/:id', auth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный id' });
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: 'Товар не найден' });
    const dealsCount = db.prepare('SELECT COUNT(*) AS c FROM deals WHERE item_id = ?').get(id).c;
    if (dealsCount > 0) return res.status(400).json({ error: 'Нельзя удалить товар: существуют сделки по этому товару' });

    // Try remove photo file
    try {
      if (item.photo_url) {
        const rel = String(item.photo_url).replace(/^\/+/, '');
        const abs = path.join(__dirname, rel);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      }
    } catch (e) {
      console.warn('Item photo delete warning:', e?.message || e);
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (e) {
    console.error('Admin delete item error:', e);
    res.status(500).json({ error: 'Ошибка удаления товара' });
  }
});

// Bulk delete items (admin)
app.post('/api/admin/items/bulk-delete', auth, requireAdmin, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Не переданы ids' });
    const ok = [];
    const skipped = [];
    for (const rawId of ids) {
      const id = parseInt(rawId, 10);
      if (!Number.isFinite(id)) { skipped.push({ id: rawId, reason: 'bad_id' }); continue; }
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!item) { skipped.push({ id, reason: 'not_found' }); continue; }
      const dealsCount = db.prepare('SELECT COUNT(*) AS c FROM deals WHERE item_id = ?').get(id).c;
      if (dealsCount > 0) { skipped.push({ id, reason: 'has_deals' }); continue; }
      try {
        if (item.photo_url) {
          const rel = String(item.photo_url).replace(/^\/+/, '');
          const abs = path.join(__dirname, rel);
          if (fs.existsSync(abs)) fs.unlinkSync(abs);
        }
      } catch (e) {
        console.warn('Bulk delete photo warning:', e?.message || e);
      }
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      ok.push(id);
    }
    res.json({ success: true, deleted: ok.length, ids: ok, skipped });
  } catch (e) {
    console.error('Admin bulk delete items error:', e);
    res.status(500).json({ error: 'Ошибка пакетного удаления товаров' });
  }
});

// --- Deals: Core marketplace flow ---
// Helpers
function getItemById(id) {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
}

function getDealById(id) {
  return db.prepare('SELECT * FROM deals WHERE id = ?').get(id);
}

function getOrCreateChatForDeal(dealId) {
  let chat = db.prepare('SELECT * FROM chats WHERE deal_id = ?').get(dealId);
  if (chat) return chat;
  const deal = getDealById(dealId);
  if (!deal) return null;
  const item = getItemById(deal.item_id);
  if (!item) return null;
  const info = db.prepare('INSERT OR IGNORE INTO chats (deal_id, buyer_id, seller_id) VALUES (?, ?, ?)')
    .run(dealId, deal.buyer_id, item.seller_id);
  chat = db.prepare('SELECT * FROM chats WHERE deal_id = ?').get(dealId);
  return chat;
}

function addSystemMessage(chatId, text) {
  db.prepare('INSERT INTO chat_messages (chat_id, sender_id, type, text) VALUES (?, NULL, ? , ?)')
    .run(chatId, 'system', text);
}

// Create a deal (buy item) - freeze buyer funds
app.post('/api/items/:id/buy', auth, (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const item = getItemById(itemId);
  if (!item) return res.status(404).json({ error: 'Товар не найден' });
  if (item.status !== 'active') return res.status(400).json({ error: 'Товар недоступен' });
  if (item.seller_id === req.user.id) return res.status(400).json({ error: 'Нельзя купить собственный товар' });

  const price = parseInt(item.price, 10) || 0;
  const user = db.prepare('SELECT id, balance, frozen FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.balance < price) return res.status(400).json({ error: 'Недостаточно средств' });

  const buyTx = db.transaction(() => {
    // Freeze funds on buyer
    db.prepare('UPDATE users SET balance = balance - ?, frozen = frozen + ? WHERE id = ?').run(price, price, req.user.id);
    // Create deal
    const info = db.prepare('INSERT INTO deals (item_id, buyer_id, price, status) VALUES (?, ?, ?, ?)')
      .run(itemId, req.user.id, price, 'pending');
    // Reserve item
    db.prepare("UPDATE items SET status = 'reserved' WHERE id = ?").run(itemId);
    return info.lastInsertRowid;
  });

  try {
    const dealId = buyTx();
    const deal = getDealById(dealId);
    // Ensure chat exists for this deal and greet participants
    const chat = getOrCreateChatForDeal(dealId);
    if (chat) {
      addSystemMessage(chat.id, 'Создан чат сделки. Общайтесь и передавайте товар здесь.');
    }
    res.status(201).json(deal);
  } catch (e) {
    console.error('Buy item error:', e);
    res.status(500).json({ error: 'Ошибка при создании сделки' });
  }
});

// Seller confirms delivery of goods
app.post('/api/deals/:id/seller-confirm', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deal = getDealById(id);
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  const item = getItemById(deal.item_id);
  if (!item) return res.status(404).json({ error: 'Товар сделки не найден' });
  if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Нет прав на подтверждение' });
  if (deal.status !== 'pending') return res.status(400).json({ error: 'Неверный статус сделки' });

  try {
    db.prepare("UPDATE deals SET status = 'seller_confirmed' WHERE id = ?").run(id);
    const chat = getOrCreateChatForDeal(id);
    if (chat) addSystemMessage(chat.id, 'Продавец подтвердил передачу товара.');
    res.json({ success: true });
  } catch (e) {
    console.error('Seller confirm error:', e);
    res.status(500).json({ error: 'Ошибка подтверждения' });
  }
});

// Buyer completes the deal: release funds to seller
app.post('/api/deals/:id/buyer-complete', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deal = getDealById(id);
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав завершить сделку' });
  if (!(deal.status === 'seller_confirmed' || deal.status === 'pending')) {
    return res.status(400).json({ error: 'Сделку нельзя завершить в текущем статусе' });
  }
  const item = getItemById(deal.item_id);
  if (!item) return res.status(404).json({ error: 'Товар сделки не найден' });

  const completeTx = db.transaction(() => {
    // Unfreeze from buyer, pay to seller
    db.prepare('UPDATE users SET frozen = frozen - ? WHERE id = ?').run(deal.price, deal.buyer_id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(deal.price, item.seller_id);
    // Close deal and item
    db.prepare("UPDATE deals SET status = 'completed' WHERE id = ?").run(id);
    db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(item.id);
  });

  try {
    completeTx();
    const chat = getOrCreateChatForDeal(id);
    if (chat) addSystemMessage(chat.id, 'Сделка завершена. Средства зачислены продавцу.');
    res.json({ success: true });
  } catch (e) {
    console.error('Buyer complete error:', e);
    res.status(500).json({ error: 'Ошибка завершения сделки' });
  }
});

// Either party can open a dispute
app.post('/api/deals/:id/dispute', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const deal = getDealById(id);
  if (!deal) return res.status(404).json({ error: 'Сделка не найдена' });
  const item = getItemById(deal.item_id);
  const isSeller = item && item.seller_id === req.user.id;
  const isBuyer = deal.buyer_id === req.user.id;
  if (!isSeller && !isBuyer) return res.status(403).json({ error: 'Нет прав' });
  if (deal.status === 'completed') return res.status(400).json({ error: 'Сделка уже завершена' });

  try {
    db.prepare("UPDATE deals SET status = 'dispute' WHERE id = ?").run(id);
    const chat = getOrCreateChatForDeal(id);
    if (chat) addSystemMessage(chat.id, 'Открыт спор по сделке. Дождитесь решения модератора.');
    res.json({ success: true });
  } catch (e) {
    console.error('Open dispute error:', e);
    res.status(500).json({ error: 'Ошибка при открытии спора' });
  }
});

// List my deals (as buyer or as seller)
app.get('/api/deals', auth, (req, res) => {
  try {
    const sql = `
      SELECT 
        d.*, 
        i.name as item_name, i.photo_url as item_photo, i.seller_id,
        seller.nickname as seller_nickname,
        buyer.nickname as buyer_nickname,
        CASE 
          WHEN d.buyer_id = ? THEN 'buyer'
          WHEN i.seller_id = ? THEN 'seller'
          ELSE 'none'
        END as role
      FROM deals d
      JOIN items i ON d.item_id = i.id
      JOIN users seller ON i.seller_id = seller.id
      JOIN users buyer ON d.buyer_id = buyer.id
      WHERE d.buyer_id = ? OR i.seller_id = ?
      ORDER BY d.created_at DESC`;
    const deals = db.prepare(sql).all(req.user.id, req.user.id, req.user.id, req.user.id);
    // Normalize item photo URL for consistent frontend rendering
    const mappedDeals = deals.map(d => ({
      ...d,
      item_photo: normalizeMediaUrl(d.item_photo)
    }));
    res.json(mappedDeals);
  } catch (e) {
    console.error('Get deals error:', e);
    res.status(500).json({ error: 'Ошибка загрузки сделок' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
