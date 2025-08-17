import Database from 'better-sqlite3';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'store.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
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
  item_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(item_id) REFERENCES items(id),
  FOREIGN KEY(buyer_id) REFERENCES users(id)
);
`);

// seed games if empty
const count = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
if (!count) {
  const games = JSON.parse(readFileSync(path.join(__dirname, '..', 'games_seed.json'), 'utf8'));
  const insert = db.prepare('INSERT INTO games (id,name,category) VALUES (?,?,?)');
  const tran = db.transaction((arr)=>{arr.forEach(g=>insert.run(g.id,g.name,g.cat))});
  tran(games);
  console.log('Seeded games:', games.length);
}
// ensure legacy DB has name column
try{db.prepare('SELECT name FROM items LIMIT 1').get();}catch(e){db.exec('ALTER TABLE items ADD COLUMN name TEXT');}
console.log('DB ready');
