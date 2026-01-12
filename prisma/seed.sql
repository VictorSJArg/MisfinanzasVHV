
-- Create User
INSERT INTO User (id, email, name, currency, createdAt) 
VALUES ('user-demo-id', 'user@example.com', 'Usuario Demo', 'ARS', CURRENT_TIMESTAMP)
ON CONFLICT(email) DO NOTHING;

-- Create Account
INSERT INTO Account (id, name, type, balance, userId) 
VALUES ('acc-cash-01', 'Efectivo', 'CASH', 0, 'user-demo-id')
ON CONFLICT DO NOTHING;

-- Income Categories
INSERT INTO Category (id, name, type, userId) VALUES 
('cat-in-01', 'Sueldo', 'INCOME', 'user-demo-id'),
('cat-in-02', 'Freelance', 'INCOME', 'user-demo-id'),
('cat-in-03', 'Alquileres', 'INCOME', 'user-demo-id'),
('cat-in-04', 'Inversiones', 'INCOME', 'user-demo-id'),
('cat-in-05', 'Otros Ingresos', 'INCOME', 'user-demo-id')
ON CONFLICT DO NOTHING;

-- Expense Categories
INSERT INTO Category (id, name, type, userId) VALUES 
('cat-ex-01', 'Supermercado', 'EXPENSE', 'user-demo-id'),
('cat-ex-02', 'Alimentos', 'EXPENSE', 'user-demo-id'),
('cat-ex-03', 'Alquiler/Expensas', 'EXPENSE', 'user-demo-id'),
('cat-ex-04', 'Servicios (Luz/Gas)', 'EXPENSE', 'user-demo-id'),
('cat-ex-05', 'Internet/Celular', 'EXPENSE', 'user-demo-id'),
('cat-ex-06', 'Transporte', 'EXPENSE', 'user-demo-id'),
('cat-ex-07', 'Salud/Farmacia', 'EXPENSE', 'user-demo-id'),
('cat-ex-08', 'Restaurantes/Delivery', 'EXPENSE', 'user-demo-id'),
('cat-ex-09', 'Esparcimiento', 'EXPENSE', 'user-demo-id'),
('cat-ex-10', 'Educación', 'EXPENSE', 'user-demo-id'),
('cat-ex-11', 'Ropa', 'EXPENSE', 'user-demo-id'),
('cat-ex-12', 'Regalos', 'EXPENSE', 'user-demo-id'),
('cat-ex-13', 'Varios', 'EXPENSE', 'user-demo-id')
ON CONFLICT DO NOTHING;
