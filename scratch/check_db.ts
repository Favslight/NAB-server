import { query } from '../src/database/database';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkSettings() {
  try {
    const settings = await query('SELECT * FROM system_settings');
    console.log('System Settings:', JSON.stringify(settings, null, 2));
    
    const users = await query('SELECT id, email, id_no, role, status FROM users LIMIT 5');
    console.log('Sample Users:', JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit();
  }
}

checkSettings();
