const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data.db');
const ExcelJS = require('exceljs');
const { dialog } = require('electron');

// --- СОЗДАНИЕ ТАБЛИЦ ---
db.serialize(() => {

  // Таблица пользователей с полем role
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'employee'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT UNIQUE,
    position_id INTEGER,
    rate REAL,
    user_id INTEGER UNIQUE,
    FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE RESTRICT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER,
    days REAL,
    bonus REAL,
    tax REAL,
    total REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
  )`);

  // Создание пользователей по умолчанию
  db.run(`INSERT OR IGNORE INTO users (login, password, role) VALUES ('admin', 'admin123', 'admin')`);
  db.run(`INSERT OR IGNORE INTO users (login, password, role) VALUES ('accountant', 'acc123', 'accountant')`);
  db.run(`INSERT OR IGNORE INTO users (login, password, role) VALUES ('manager', 'mgr123', 'manager')`);

  // Индексы для оптимизации
  db.run(`CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_date ON payroll(created_at)`);
});

// --- АВТОРИЗАЦИЯ С ВОЗВРАТОМ РОЛИ ---
exports.login = (login, password) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id, login, role FROM users WHERE login=? AND password=?`,
      [login, password],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
};

// --- ПОЛУЧЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ (для сессии) ---
exports.getUserById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id, login, role FROM users WHERE id=?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// --- УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (только для администратора) ---
exports.getAllUsers = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, login, role FROM users`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.createUser = (login, password, role) => {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO users (login, password, role) VALUES (?, ?, ?)`,
      [login, password, role],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

exports.updateUserRole = (userId, role) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE users SET role=? WHERE id=?`, [role, userId], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

exports.deleteUser = (userId) => {
  return new Promise((resolve, reject) => {
    // Сначала обнуляем связь с сотрудником
    db.run(`UPDATE employees SET user_id=NULL WHERE user_id=?`, [userId], () => {
      db.run(`DELETE FROM users WHERE id=?`, [userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  });
};

// --- ДОЛЖНОСТИ ---
exports.getPositions = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM positions`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.addPosition = (name) => {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO positions (name) VALUES (?)`, [name], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

exports.deletePosition = (id) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM positions WHERE id=?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

// --- СОТРУДНИКИ ---
exports.getEmployees = () => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT employees.id, full_name, rate, positions.name as position, users.login as user_login
      FROM employees
      LEFT JOIN positions ON employees.position_id = positions.id
      LEFT JOIN users ON employees.user_id = users.id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Получить сотрудника по ID пользователя (для личного кабинета)
exports.getEmployeeByUserId = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT employees.id, full_name, rate, positions.name as position
      FROM employees
      LEFT JOIN positions ON employees.position_id = positions.id
      WHERE employees.user_id=?
    `, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

exports.addEmployee = async (name, positionName, rate, userId = null) => {
  return new Promise(async (resolve, reject) => {
    let pos = await new Promise(res => {
      db.get(`SELECT * FROM positions WHERE name=?`, [positionName], (e, row) => res(row));
    });

    let posId;
    if (!pos) {
      let result = await exports.addPosition(positionName);
      posId = result;
    } else {
      posId = pos.id;
    }

    db.run(
      `INSERT INTO employees (full_name, position_id, rate, user_id) VALUES (?, ?, ?, ?)`,
      [name, posId, rate, userId],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
};

exports.updateEmployee = (id, full_name, position_id, rate) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE employees SET user_id = 2 WHERE id = 1;`,
      [full_name, position_id, rate, id],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

exports.deleteEmployee = (id) => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM employees WHERE id=?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

// --- РАСЧЁТ ЗАРПЛАТЫ ---
exports.calculateSalary = (employee_id, days, bonus) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT rate FROM employees WHERE id=?`, [employee_id], (err, row) => {
      if (err || !row) {
        reject(err || new Error('Сотрудник не найден'));
        return;
      }

      let base = (row.rate / 22) * days;
      let total = base + Number(bonus);
      let tax = total * 0.13;
      let result = total - tax;

      db.run(
        `INSERT INTO payroll (employee_id, days, bonus, tax, total) VALUES (?, ?, ?, ?, ?)`,
        [employee_id, days, bonus, tax, result],
        function(err) {
          if (err) reject(err);
          else resolve({
            base: base.toFixed(2),
            total: total.toFixed(2),
            tax: tax.toFixed(2),
            result: result.toFixed(2)
          });
        }
      );
    });
  });
};

// --- ОТЧЁТЫ ---
exports.getPayroll = (employeeId = null, startDate = null, endDate = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        employees.full_name as name,
        positions.name as position,
        payroll.days,
        payroll.bonus,
        payroll.tax,
        payroll.total,
        payroll.created_at as date
      FROM payroll
      JOIN employees ON payroll.employee_id = employees.id
      LEFT JOIN positions ON employees.position_id = positions.id
      WHERE 1=1
    `;
    let params = [];

    if (employeeId) {
      query += ` AND employees.id = ?`;
      params.push(employeeId);
    }
    if (startDate) {
      query += ` AND payroll.created_at >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND payroll.created_at <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY payroll.created_at DESC`;

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// Получить начисления конкретного сотрудника по его ID пользователя
exports.getMyPayroll = (userId) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        employees.full_name as name,
        positions.name as position,
        payroll.days,
        payroll.bonus,
        payroll.tax,
        payroll.total,
        payroll.created_at as date
      FROM payroll
      JOIN employees ON payroll.employee_id = employees.id
      LEFT JOIN positions ON employees.position_id = positions.id
      WHERE employees.user_id = ?
      ORDER BY payroll.created_at DESC
    `, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// --- ЭКСПОРТ В EXCEL ---
exports.exportExcel = async (employeeId = null, startDate = null, endDate = null) => {
  let rows = await exports.getPayroll(employeeId, startDate, endDate);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Отчёт по зарплате');

  sheet.columns = [
    { header: 'ФИО', key: 'name', width: 30 },
    { header: 'Должность', key: 'position', width: 25 },
    { header: 'Дни', key: 'days', width: 10 },
    { header: 'Премия', key: 'bonus', width: 15 },
    { header: 'Налог (13%)', key: 'tax', width: 15 },
    { header: 'Итого к выдаче', key: 'total', width: 18 },
    { header: 'Дата начисления', key: 'date', width: 20 }
  ];

  rows.forEach(r => sheet.addRow(r));

  const result = await dialog.showSaveDialog({
    title: 'Сохранить отчёт Excel',
    defaultPath: `salary_report_${new Date().toISOString().slice(0,10)}.xlsx`,
    filters: [{ name: 'Excel файлы', extensions: ['xlsx'] }]
  });

  if (!result.canceled) {
    await workbook.xlsx.writeFile(result.filePath);
    return true;
  }
  return false;
};

exports.clearPayroll = () => {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM payroll`, function(err){
      if(err) reject(err);
      else resolve(true);
    });
  });
};