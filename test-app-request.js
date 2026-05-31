const fetch = require('node-fetch-native'); // using standard node behavior or dynamic import

async function run() {
  const url = 'https://misfinanzasvhv.vercel.app/api/assistant';
  const secret = 'Yoli2015';
  const phone = '5492645271951';

  console.log(`Sending ping request to ${url}...`);
  try {
    const resPing = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify({
        action: 'ping',
        sourcePhone: phone
      })
    });
    console.log('Ping status:', resPing.status);
    const textPing = await resPing.text();
    console.log('Ping body:', textPing);

    console.log('\nSending metadata request...');
    const resMeta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`
      },
      body: JSON.stringify({
        action: 'metadata',
        sourcePhone: phone
      })
    });
    console.log('Metadata status:', resMeta.status);
    const textMeta = await resMeta.text();
    console.log('Metadata body:', textMeta);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

run();
