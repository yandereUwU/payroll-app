const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data.db');
const ExcelJS = require('exceljs');
const { dialog } = require('electron');

// --- СОЗДАНИЕ ТАБЛИЦ (расширенная структура) ---
db.serialize(() => {
  // 1. Роли (справочник)
  db.run(`CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
  )`);

  // Заполняем роли по умолчанию
  db.run(`INSERT OR IGNORE INTO roles (name, description) VALUES
    ('admin', 'Полный доступ'),
    ('accountant', 'Бухгалтер'),
    ('manager', 'Руководитель'),
    ('employee', 'Сотрудник')`);

  // 2. Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(role_id) REFERENCES roles(id)
  )`);

  // 3. Системные настройки
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT
  )`);

  db.run(`INSERT OR IGNORE INTO settings (key, value, description) VALUES
    ('tax_rate', '0.13', 'Ставка налога (13%)'),
    ('work_days_per_month', '22', 'Количество рабочих дней в месяце')`);

  // 4. Периоды начисления зарплаты
  db.run(`CREATE TABLE IF NOT EXISTS payroll_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT 0,
    closed_at DATETIME,
    UNIQUE(year, month)
  )`);

  // 5. Сотрудники
  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT UNIQUE NOT NULL,
    position_id INTEGER,
    rate REAL NOT NULL,
    user_id INTEGER UNIQUE,
    is_active BOOLEAN DEFAULT 1,
    hire_date DATE DEFAULT CURRENT_DATE,
    FOREIGN KEY(position_id) REFERENCES positions(id) ON DELETE RESTRICT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  // 6. Начисления зарплаты
  db.run(`CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    period_id INTEGER NOT NULL,
    days REAL NOT NULL,
    bonus REAL DEFAULT 0,
    tax REAL NOT NULL,
    total REAL NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY(period_id) REFERENCES payroll_periods(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  // 7. Журнал аудита
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    old_data TEXT,
    new_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // 8. Должности
  db.run(`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  // --- ИНДЕКСЫ ---
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(period_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_date ON payroll(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id)`);
  
  // --- СОЗДАНИЕ ПОЛЬЗОВАТЕЛЕЙ ПО УМОЛЧАНИЮ ---
  db.get(`SELECT id FROM roles WHERE name = 'admin'`, (err, adminRole) => {
    if (!err && adminRole) {
      db.run(`INSERT OR IGNORE INTO users (login, password, role_id) VALUES (?, ?, ?)`,
        ['admin', 'admin123', adminRole.id]);
    }
  });
  
  db.get(`SELECT id FROM roles WHERE name = 'accountant'`, (err, accRole) => {
    if (!err && accRole) {
      db.run(`INSERT OR IGNORE INTO users (login, password, role_id) VALUES (?, ?, ?)`,
        ['buhgal', 'buhgal123', accRole.id]);
    }
  });
  
  db.get(`SELECT id FROM roles WHERE name = 'manager'`, (err, mgrRole) => {
    if (!err && mgrRole) {
      db.run(`INSERT OR IGNORE INTO users (login, password, role_id) VALUES (?, ?, ?)`,
        ['manager', 'manager123', mgrRole.id]);
    }
  });
});
    // Добавление преподавателя Розевитка Артём Сергеевич
db.get(`SELECT id FROM roles WHERE name = 'employee'`, (err, employeeRole) => {
  if (!err && employeeRole) {
    // Создаём учётную запись
    db.run(`INSERT OR IGNORE INTO users (login, password, role_id) VALUES (?, ?, ?)`,
      ['sotrud', 'sotrud123', employeeRole.id], function(err) {
        if (!err && this.lastID) {
          // Привязываем сотрудника к учётной записи
          db.run(`INSERT OR IGNORE INTO employees (full_name, position_id, rate, user_id) 
                  VALUES (?, (SELECT id FROM positions WHERE name = 'Преподаватель'), ?, ?)`,
            ['Розевитка Артём Сергеевич', 5000, this.lastID]);
        }
      });
  }
});


// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function getTaxRate() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'tax_rate'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? parseFloat(row.value) : 0.13);
    });
  });
}

function getWorkDays() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT value FROM settings WHERE key = 'work_days_per_month'`, (err, row) => {
      if (err) reject(err);
      else resolve(row ? parseInt(row.value) : 22);
    });
  });
}

async function getOrCreatePeriod(year, month) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM payroll_periods WHERE year = ? AND month = ?`,
      [year, month],
      (err, period) => {
        if (err) return reject(err);
        if (period) return resolve(period);

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        db.run(
          `INSERT INTO payroll_periods (year, month, start_date, end_date) VALUES (?, ?, ?, ?)`,
          [year, month, startDate.toISOString().slice(0,10), endDate.toISOString().slice(0,10)],
          function(err) {
            if (err) reject(err);
            else {
              db.get(`SELECT * FROM payroll_periods WHERE id = ?`, [this.lastID], (e, r) => {
                if (e) reject(e);
                else resolve(r);
              });
            }
          }
        );
      }
    );
  });
}

function audit(userId, action, entity, entityId, oldData = null, newData = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, old_data, new_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, action, entity, entityId, oldData ? JSON.stringify(oldData) : null, newData ? JSON.stringify(newData) : null],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

// --- АВТОРИЗАЦИЯ ---
exports.login = (login, password) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT u.id, u.login, r.name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.login = ? AND u.password = ?
    `, [login, password], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

exports.getUserById = (id) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT u.id, u.login, r.name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// --- УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ---
exports.getAllUsers = () => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT u.id, u.login, r.name as role, u.created_at
      FROM users u
      JOIN roles r ON u.role_id = r.id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.createUser = async (login, password, roleName) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM roles WHERE name = ?`, [roleName], (err, role) => {
      if (err || !role) {
        reject(err || new Error('Роль не найдена'));
        return;
      }
      db.run(
        `INSERT INTO users (login, password, role_id) VALUES (?, ?, ?)`,
        [login, password, role.id],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  });
};

exports.updateUserRole = (userId, roleName) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM roles WHERE name = ?`, [roleName], (err, role) => {
      if (err || !role) {
        reject(err || new Error('Роль не найдена'));
        return;
      }
      db.run(`UPDATE users SET role_id = ? WHERE id = ?`, [role.id, userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  });
};

exports.deleteUser = (userId) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE employees SET user_id = NULL WHERE user_id = ?`, [userId], () => {
      db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
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
      SELECT
        e.id, e.full_name, e.rate, e.is_active, e.hire_date,
        p.name as position,
        u.login as user_login
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN users u ON e.user_id = u.id
      ORDER BY e.id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.getEmployeeByUserId = (userId) => {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT e.id, e.full_name, e.rate, p.name as position, e.is_active
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      WHERE e.user_id = ?
    `, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

exports.addEmployee = async (name, positionName, rate, userId = null) => {
  let pos = await new Promise(res => {
    db.get(`SELECT * FROM positions WHERE name = ?`, [positionName], (e, row) => res(row));
  });
  let posId;
  if (!pos) {
    posId = await exports.addPosition(positionName);
  } else {
    posId = pos.id;
  }

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO employees (full_name, position_id, rate, user_id, hire_date)
       VALUES (?, ?, ?, ?, date('now'))`,
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
      `UPDATE employees SET full_name = ?, position_id = ?, rate = ? WHERE id = ?`,
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
exports.calculateSalary = async (employee_id, days, bonus, userId = null) => {
  try {
    const taxRate = await getTaxRate();
    const workDays = await getWorkDays();

    const employee = await new Promise((resolve, reject) => {
      db.get(`SELECT rate FROM employees WHERE id = ?`, [employee_id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    if (!employee) throw new Error('Сотрудник не найден');

    const base = (employee.rate / workDays) * days;
    const totalBeforeTax = base + Number(bonus);
    const tax = totalBeforeTax * taxRate;
    const net = totalBeforeTax - tax;

    const now = new Date();
    const period = await getOrCreatePeriod(now.getFullYear(), now.getMonth() + 1);

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO payroll (employee_id, period_id, days, bonus, tax, total, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employee_id, period.id, days, bonus, tax, net, userId || null],
        function(err) {
          if (err) reject(err);
          else {
            if (userId) {
              audit(userId, 'CREATE', 'payroll', this.lastID, null, {
                employee_id, days, bonus, tax, net, period_id: period.id
              }).catch(console.error);
            }
            resolve({
              base: base.toFixed(2),
              total: totalBeforeTax.toFixed(2),
              tax: tax.toFixed(2),
              result: net.toFixed(2)
            });
          }
        }
      );
    });
  } catch (err) {
    throw err;
  }
};

// --- ОТЧЁТЫ ---
exports.getPayroll = async (employeeId = null, startDate = null, endDate = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT
        e.full_name as name,
        p.name as position,
        pay.days,
        pay.bonus,
        pay.tax,
        pay.total,
        pay.created_at as date,
        per.year,
        per.month,
        u.login as created_by_login
      FROM payroll pay
      JOIN employees e ON pay.employee_id = e.id
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN payroll_periods per ON pay.period_id = per.id
      LEFT JOIN users u ON pay.created_by = u.id
      WHERE 1=1
    `;
    let params = [];

    if (employeeId) {
      query += ` AND e.id = ?`;
      params.push(employeeId);
    }
    if (startDate) {
      query += ` AND pay.created_at >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND pay.created_at <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY pay.created_at DESC`;

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

exports.getMyPayroll = (userId) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        e.full_name as name,
        p.name as position,
        pay.days,
        pay.bonus,
        pay.tax,
        pay.total,
        pay.created_at as date,
        per.year,
        per.month
      FROM payroll pay
      JOIN employees e ON pay.employee_id = e.id
      LEFT JOIN positions p ON e.position_id = p.id
      LEFT JOIN payroll_periods per ON pay.period_id = per.id
      WHERE e.user_id = ?
      ORDER BY pay.created_at DESC
    `, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// --- ЭКСПОРТ В EXCEL ---
exports.exportExcel = async (employeeId = null, startDate = null, endDate = null) => {
  const rows = await exports.getPayroll(employeeId, startDate, endDate);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Отчёт по зарплате');

  sheet.columns = [
    { header: 'ФИО', key: 'name', width: 30 },
    { header: 'Должность', key: 'position', width: 25 },
    { header: 'Период (год, месяц)', key: 'period', width: 15 },
    { header: 'Дни', key: 'days', width: 10 },
    { header: 'Премия (₽)', key: 'bonus', width: 15 },
    { header: 'Налог (13%)', key: 'tax', width: 15 },
    { header: 'Итого к выдаче (₽)', key: 'total', width: 18 },
    { header: 'Дата начисления', key: 'date', width: 20 },
    { header: 'Начислил', key: 'created_by_login', width: 20 }
  ];

  rows.forEach(r => {
    const period = `${r.year}-${String(r.month).padStart(2,'0')}`;
    sheet.addRow({ ...r, period });
  });

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
    db.run(`DELETE FROM payroll`, function(err) {
      if (err) reject(err);
      else resolve(true);
    });
  });
};

// --- ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ---
exports.getSettings = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT key, value, description FROM settings`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.updateSetting = (key, value) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE settings SET value = ? WHERE key = ?`, [value, key], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
};

exports.getPayrollPeriods = () => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM payroll_periods ORDER BY year DESC, month DESC`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

exports.closePeriod = (periodId) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE payroll_periods SET is_closed = 1, closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [periodId],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
};

exports.getAuditLog = (limit = 100) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT a.*, u.login as user_login
      FROM audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};