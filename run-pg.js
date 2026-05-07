const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function main() {
  const sql = fs.readFileSync('setup.sql', 'utf8');
  // Use DIRECT_URL or DATABASE_URL
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log('Connected to database via pg.');
    await client.query(sql);
    console.log('SQL executed successfully!');
  } catch(e) {
    console.error('Error executing SQL via pg:', e.message);
  } finally {
    await client.end();
  }
}
main();
