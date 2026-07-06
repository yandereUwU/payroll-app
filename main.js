const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');

const db = new sqlite3.Database('./data.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role_id INTEGER NOT NULL,
    FOREIGN KEY(role_id) REFERENCES roles(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT UNIQUE NOT NULL,
    position_id INTEGER,
    rate REAL NOT NULL,
    user_id INTEGER UNIQUE,
    FOREIGN KEY(position_id) REFERENCES positions(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    days REAL NOT NULL,
    bonus REAL DEFAULT 0,
    tax REAL NOT NULL,
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(employee_id) REFERENCES employees(id)
  )`);

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

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
  )`);

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

  db.run(`INSERT OR IGNORE INTO roles (name) VALUES 
    ('admin'), ('accountant'), ('manager'), ('employee')`);

  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('tax_rate', '0.13'), ('work_days_per_month', '22')`);

  db.get(`SELECT id FROM roles WHERE name = 'admin'`, (err, role) => {
    if (role) db.run(`INSERT OR IGNORE INTO users (login, password, role_id) 
      VALUES ('admin', 'admin123', ?)`, [role.id]);
  });
  
  db.get(`SELECT id FROM roles WHERE name = 'accountant'`, (err, role) => {
    if (role) db.run(`INSERT OR IGNORE INTO users (login, password, role_id) 
      VALUES ('buhgal', 'buhgal123', ?)`, [role.id]);
  });
  
  db.get(`SELECT id FROM roles WHERE name = 'manager'`, (err, role) => {
    if (role) db.run(`INSERT OR IGNORE INTO users (login, password, role_id) 
      VALUES ('manager', 'manager123', ?)`, [role.id]);
  });
  
  db.get(`SELECT id FROM roles WHERE name = 'employee'`, (err, role) => {
    if (role) db.run(`INSERT OR IGNORE INTO users (login, password, role_id) 
      VALUES ('sotrud', 'sotrud123', ?)`, [role.id]);
  });
});

function login(login, password) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT u.id, u.login, r.name as role
      FROM users u JOIN roles r ON u.role_id = r.id
      WHERE u.login = ? AND u.password = ?
    `, [login, password], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getEmployees() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT e.id, e.full_name, e.rate, p.name as position
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function addEmployee(name, positionName, rate) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO employees (full_name, position_id, rate)
            VALUES (?, (SELECT id FROM positions WHERE name = ?), ?)`,
      [name, positionName, rate], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
  });
}

function deleteEmployee(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM employees WHERE id = ?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

function getPositions() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM positions`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function addPosition(name) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO positions (name) VALUES (?)`, [name], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

function deletePosition(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM positions WHERE id = ?`, [id], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

function calculateSalary(employee_id, days, bonus) {
  return new Promise(async (resolve, reject) => {
    try {
      const taxRate = 0.13;
      const workDays = 22;
      
      const employee = await new Promise((resolve2) => {
        db.get(`SELECT rate FROM employees WHERE id = ?`, [employee_id], (err, row) => resolve2(row));
      });
      
      if (!employee) {
        reject(new Error('Сотрудник не найден'));
        return;
      }
      
      const base = (employee.rate / workDays) * days;
      const totalBeforeTax = base + Number(bonus);
      const tax = totalBeforeTax * taxRate;
      const net = totalBeforeTax - tax;
      
      db.run(`INSERT INTO payroll (employee_id, days, bonus, tax, total)
              VALUES (?, ?, ?, ?, ?)`,
        [employee_id, days, bonus, tax, net], function(err) {
          if (err) reject(err);
          else resolve({ base, total: totalBeforeTax, tax, result: net });
        });
    } catch(err) {
      reject(err);
    }
  });
}

function getPayroll() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT e.full_name as name, p.name as position,
             pay.days, pay.bonus, pay.tax, pay.total, pay.created_at as date
      FROM payroll pay
      JOIN employees e ON pay.employee_id = e.id
      LEFT JOIN positions p ON e.position_id = p.id
      ORDER BY pay.created_at DESC
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function exportExcel() {
  return new Promise(async (resolve, reject) => {
    try {
      const rows = await getPayroll();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Отчёт по зарплате');
      
      sheet.columns = [
        { header: 'ФИО', key: 'name', width: 30 },
        { header: 'Должность', key: 'position', width: 25 },
        { header: 'Дни', key: 'days', width: 10 },
        { header: 'Премия', key: 'bonus', width: 15 },
        { header: 'Налог', key: 'tax', width: 15 },
        { header: 'Итого', key: 'total', width: 18 }
      ];
      
      rows.forEach(r => sheet.addRow(r));
      
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `salary_report_${new Date().toISOString().slice(0,10)}.xlsx`,
        filters: [{ name: 'Excel файлы', extensions: ['xlsx'] }]
      });
      
      if (!result.canceled) {
        await workbook.xlsx.writeFile(result.filePath);
        resolve(true);
      } else {
        resolve(false);
      }
    } catch(err) {
      reject(err);
    }
  });
}

function clearPayroll() {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM payroll`, function(err) {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

function getEmployeeByUserId(userId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT e.id, e.full_name, e.rate, p.name as position
      FROM employees e
      LEFT JOIN positions p ON e.position_id = p.id
      WHERE e.user_id = ?
    `, [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getMyPayroll(userId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT e.full_name as name, p.name as position,
             pay.days, pay.bonus, pay.tax, pay.total, pay.created_at as date
      FROM payroll pay
      JOIN employees e ON pay.employee_id = e.id
      LEFT JOIN positions p ON e.position_id = p.id
      WHERE e.user_id = ?
      ORDER BY pay.created_at DESC
    `, [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getPayrollPeriods() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM payroll_periods ORDER BY year DESC, month DESC`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function closePeriod(periodId) {
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
}

function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT u.id, u.login, r.name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function createUser(login, password, roleName) {
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
}

function deleteUser(userId) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE employees SET user_id = NULL WHERE user_id = ?`, [userId], () => {
      db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

module.exports = {
  login,
  getEmployees,
  addEmployee,
  deleteEmployee,
  getPositions,
  addPosition,
  deletePosition,
  calculateSalary,
  getPayroll,
  exportExcel,
  clearPayroll,
  getEmployeeByUserId,
  getMyPayroll,
  getPayrollPeriods,
  closePeriod,
  getAllUsers,
  createUser,
  deleteUser
};

console.log('Payroll system started');
console.log('Logins: admin/admin123, buhgal/buhgal123, manager/manager123, sotrud/sotrud123');