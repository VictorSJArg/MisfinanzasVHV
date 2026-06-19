import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Client } = pg;
const apply = process.argv.includes('--apply');
const sourceUrl = process.env.STRUCTURE_SOURCE_DATABASE_URL?.trim();
const targetUrl = process.env.STRUCTURE_TARGET_DATABASE_URL?.trim();
const sourceEmail = process.env.STRUCTURE_SOURCE_USER_EMAIL?.trim();
const targetEmail = process.env.STRUCTURE_TARGET_USER_EMAIL?.trim();
const targetName = process.env.STRUCTURE_TARGET_USER_NAME?.trim() || 'Usuario';

function fail(message) {
  throw new Error(message);
}

function databaseIdentity(value) {
  const parsed = new URL(value);
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}${parsed.pathname}`;
}

function clientFor(connectionString) {
  const hostname = new URL(connectionString).hostname;
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  return new Client({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false }
  });
}

async function selectSourceUser(client) {
  if (sourceEmail) {
    const result = await client.query('SELECT id, email, name FROM "User" WHERE email = $1 LIMIT 1', [sourceEmail]);
    return result.rows[0];
  }

  const result = await client.query('SELECT id, email, name FROM "User" ORDER BY "createdAt" ASC LIMIT 2');
  if (result.rowCount !== 1) {
    fail('La base origen debe tener un solo usuario o se debe indicar STRUCTURE_SOURCE_USER_EMAIL.');
  }
  return result.rows[0];
}

async function assertTargetIsSafe(client) {
  const checks = await Promise.all([
    client.query('SELECT COUNT(*)::int AS count FROM "Transaction"'),
    client.query('SELECT COUNT(*)::int AS count FROM "Budget"'),
    client.query('SELECT COUNT(*)::int AS count FROM "CreditCard"'),
    client.query('SELECT COUNT(*)::int AS count FROM "Account" WHERE balance <> 0')
  ]);
  const labels = ['movimientos', 'presupuestos', 'tarjetas', 'cuentas con saldo'];
  const populated = checks
    .map((result, index) => ({ label: labels[index], count: result.rows[0].count }))
    .filter((entry) => entry.count > 0);
  if (populated.length) {
    fail(`La base destino ya contiene datos: ${populated.map((entry) => `${entry.label}=${entry.count}`).join(', ')}.`);
  }
}

async function main() {
  if (!sourceUrl || !targetUrl || !targetEmail) {
    fail('Faltan STRUCTURE_SOURCE_DATABASE_URL, STRUCTURE_TARGET_DATABASE_URL o STRUCTURE_TARGET_USER_EMAIL.');
  }
  if (databaseIdentity(sourceUrl) === databaseIdentity(targetUrl)) {
    fail('La base origen y la base destino no pueden ser la misma.');
  }

  const source = clientFor(sourceUrl);
  const target = clientFor(targetUrl);
  await Promise.all([source.connect(), target.connect()]);

  try {
    const sourceUser = await selectSourceUser(source);
    if (!sourceUser) fail('No se encontró el usuario origen.');

    const [accountsResult, categoriesResult] = await Promise.all([
      source.query(
        'SELECT name, type FROM "Account" WHERE "userId" = $1 ORDER BY name ASC',
        [sourceUser.id]
      ),
      source.query(
        'SELECT id, name, type, icon, color, "parentId", "sortOrder" FROM "Category" WHERE "userId" = $1 ORDER BY "sortOrder" ASC, name ASC',
        [sourceUser.id]
      )
    ]);

    console.log(`Origen: ${sourceUser.email}`);
    console.log(`Destino: ${targetEmail}`);
    console.log(`Se prepararon ${accountsResult.rowCount} cuentas en cero y ${categoriesResult.rowCount} categorías.`);

    if (!apply) {
      console.log('Simulación terminada. Para aplicar, repetir agregando --apply.');
      return;
    }

    await target.query('BEGIN');
    await assertTargetIsSafe(target);

    const userResult = await target.query(
      `INSERT INTO "User" (id, email, name, currency)
       VALUES ($1, $2, $3, 'ARS')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [randomUUID(), targetEmail, targetName]
    );
    const targetUserId = userResult.rows[0].id;

    for (const account of accountsResult.rows) {
      const existing = await target.query(
        'SELECT id FROM "Account" WHERE "userId" = $1 AND name = $2 AND type = $3 LIMIT 1',
        [targetUserId, account.name, account.type]
      );
      if (!existing.rowCount) {
        await target.query(
          'INSERT INTO "Account" (id, name, type, balance, "userId") VALUES ($1, $2, $3, 0, $4)',
          [randomUUID(), account.name, account.type, targetUserId]
        );
      }
    }

    const idMap = new Map();
    const pending = [...categoriesResult.rows];
    while (pending.length) {
      const index = pending.findIndex(
        (category) => !category.parentId || category.parentId === category.id || idMap.has(category.parentId)
      );
      if (index === -1) fail('La jerarquía de categorías origen contiene una referencia circular o inválida.');
      const [category] = pending.splice(index, 1);
      const parentId = category.parentId && category.parentId !== category.id
        ? idMap.get(category.parentId)
        : null;
      if (category.parentId === category.id) {
        console.warn(`Aviso: ${category.name} se copiará como categoría raíz porque se referenciaba a sí misma.`);
      }
      const inserted = await target.query(
        `INSERT INTO "Category" (id, name, type, icon, color, "parentId", "sortOrder", "userId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("userId", name, type) DO UPDATE
         SET icon = EXCLUDED.icon, color = EXCLUDED.color, "parentId" = EXCLUDED."parentId", "sortOrder" = EXCLUDED."sortOrder"
         RETURNING id`,
        [randomUUID(), category.name, category.type, category.icon, category.color, parentId, category.sortOrder, targetUserId]
      );
      idMap.set(category.id, inserted.rows[0].id);
    }

    await target.query('COMMIT');
    console.log('Estructura creada correctamente. No se copiaron saldos ni datos personales.');
  } catch (error) {
    if (apply) await target.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await Promise.allSettled([source.end(), target.end()]);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
