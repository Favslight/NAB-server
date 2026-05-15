import { query } from '../src/database/database';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkUsers() {
  try {
    const users = await query('SELECT id, email, id_no, password_hash, role, status FROM users LIMIT 10');
    console.log('Users:', JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit();
  }
}

checkUsers();
