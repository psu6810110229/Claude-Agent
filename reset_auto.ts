import { getDb } from './packages/backend/src/db/connection.js';
getDb().exec("DELETE FROM config WHERE key = 'auto_execute_enabled'");
console.log('Reset auto_execute_enabled');
