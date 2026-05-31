/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
const { Client } = require('pg');

async function testConnection(connectionString, name) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query('SELECT 1 as result');
    console.log(`OK [${name}] Result:`, res.rows[0].result);
  } catch (err) {
    console.error(`ERROR [${name}]:`, err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function runTests() {
  const targets = [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['DIRECT_URL', process.env.DIRECT_URL],
    ['SUPABASE_POOLER_URL', process.env.SUPABASE_POOLER_URL],
  ].filter(([, value]) => Boolean(value));

  if (targets.length === 0) {
    console.error('No database URLs configured. Set DATABASE_URL, DIRECT_URL, or SUPABASE_POOLER_URL.');
    process.exit(1);
  }

  for (const [name, connectionString] of targets) {
    await testConnection(connectionString, name);
  }
}

runTests();
