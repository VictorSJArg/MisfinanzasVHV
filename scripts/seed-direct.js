
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../dev.db');
console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

try {
    // Create User
    console.log('Creating user...');
    const userInsert = db.prepare(`
    INSERT INTO User (id, email, name, currency, createdAt) 
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `);
    userInsert.run('user-demo-id', 'user@example.com', 'Usuario Demo', 'ARS', new Date().toISOString());

    // Get User ID (in case it existed)
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get('user@example.com');
    const userId = user.id;
    console.log('User ID:', userId);

    // Create Account
    console.log('Creating account...');
    const accInsert = db.prepare(`
    INSERT INTO Account (id, name, type, balance, userId) 
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);
    accInsert.run('acc-cash-01', 'Efectivo', 'CASH', 0, userId);

    // Categories
    const insertCat = db.prepare(`
    INSERT INTO Category (id, name, type, userId) 
    VALUES (?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);

    const incomeCats = ['Sueldo', 'Freelance', 'Alquileres', 'Inversiones', 'Otros Ingresos'];
    let count = 0;
    incomeCats.forEach((name, idx) => {
        insertCat.run(`cat-in-${idx}`, name, 'INCOME', userId);
        count++;
    });

    const expenseCats = [
        'Supermercado', 'Alimentos', 'Alquiler/Expensas', 'Servicios (Luz/Gas)',
        'Internet/Celular', 'Transporte', 'Salud/Farmacia', 'Restaurantes/Delivery',
        'Esparcimiento', 'Educación', 'Ropa', 'Regalos', 'Varios'
    ];
    expenseCats.forEach((name, idx) => {
        insertCat.run(`cat-ex-${idx}`, name, 'EXPENSE', userId);
        count++;
    });

    console.log(`Seeding complete. Inserted/Checked ${count} categories.`);

} catch (err) {
    console.error('Error seeding:', err);
} finally {
    db.close();
}
