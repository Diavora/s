import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'store.db');
const db = new Database(dbPath);

async function main() {
  const [, , nicknameArg, newPassArg] = process.argv;
  if (!nicknameArg || !newPassArg) {
    console.log('Usage: node reset_password.js <nickname> <new_password>');
    process.exit(1);
  }
  const nickname = String(nicknameArg);
  const newPassword = String(newPassArg);
  if (newPassword.length < 6) {
    console.error('Ошибка: Пароль должен быть не менее 6 символов');
    process.exit(1);
  }
  try {
    const user = db.prepare('SELECT id, nickname FROM users WHERE nickname = ?').get(nickname);
    if (!user) {
      console.error(`Пользователь с ником "${nickname}" не найден`);
      process.exit(1);
    }
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    console.log(`Пароль для пользователя "${nickname}" успешно обновлён.`);
  } catch (e) {
    console.error('Не удалось сбросить пароль:', e.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
