import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'store.db'));

try {
    console.log('Clearing user-related data...');

    // Deleting from tables with foreign key dependencies first
    db.exec('DELETE FROM deals;');
    console.log('All records from "deals" table have been deleted.');

    db.exec('DELETE FROM items;');
    console.log('All records from "items" table have been deleted.');

    // Deleting users
    db.exec('DELETE FROM users;');
    console.log('All records from "users" table have been deleted.');

    // Resetting autoincrement counters for SQLite
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users', 'items', 'deals');");
    console.log('Autoincrement counters have been reset.');

    console.log('All user data has been successfully cleared.');
} catch (err) {
    console.error('Failed to clear user data:', err.message);
} finally {
    db.close();
    console.log('Database connection closed.');
}
