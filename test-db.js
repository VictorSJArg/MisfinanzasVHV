const { Client } = require('pg');

async function testConnection(connectionString, name) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query('SELECT 1 as result');
    console.log(`✅ [${name}] Success! Result:`, res.rows[0].result);
    await client.end();
  } catch (err) {
    console.error(`❌ [${name}] Error:`, err.message);
  }
}

async function runTests() {
  await testConnection('postgresql://postgres.xgmyzpuexwalaiizsngf:ChLtVTRrltuCAlOL@aws-1-us-east-1.pooler.supabase.com:6543/postgres', 'Pooler 6543');
  await testConnection('postgresql://postgres.xgmyzpuexwalaiizsngf:ChLtVTRrltuCAlOL@aws-1-us-east-1.pooler.supabase.com:5432/postgres', 'Pooler 5432');
  await testConnection('postgresql://postgres:ChLtVTRrltuCAlOL@db.xgmyzpuexwalaiizsngf.supabase.co:5432/postgres', 'Direct 5432');
}

runTests();
