const { contextBridge } = require('electron');
const db = require('./database');

contextBridge.exposeInMainWorld('api', {
  login: (login, password) => db.login(login, password),
  getUserById: (id) => db.getUserById(id),
  
  getAllUsers: () => db.getAllUsers(),
  createUser: (login, password, role) => db.createUser(login, password, role),
  updateUserRole: (userId, role) => db.updateUserRole(userId, role),
  deleteUser: (userId) => db.deleteUser(userId),
  
  getEmployees: () => db.getEmployees(),
  getEmployeeByUserId: (userId) => db.getEmployeeByUserId(userId),
  addEmployee: (name, position, rate, userId) => db.addEmployee(name, position, rate, userId),
  updateEmployee: (id, name, positionId, rate) => db.updateEmployee(id, name, positionId, rate),
  deleteEmployee: (id) => db.deleteEmployee(id),
  
  getPositions: () => db.getPositions(),
  addPosition: (name) => db.addPosition(name),
  deletePosition: (id) => db.deletePosition(id),
  
  calculateSalary: (employeeId, days, bonus) => db.calculateSalary(employeeId, days, bonus),
  getPayroll: (employeeId, startDate, endDate) => db.getPayroll(employeeId, startDate, endDate),
  getMyPayroll: (userId) => db.getMyPayroll(userId),
  
  exportExcel: (employeeId, startDate, endDate) => db.exportExcel(employeeId, startDate, endDate)
});

// Для совместимости с существующим кодом
exports.getEmployees = () => db.getEmployees();
exports.calculateSalary = (id, days, bonus) => db.calculateSalary(id, days, bonus);
exports.getPayroll = () => db.getPayroll();
exports.exportExcel = () => db.exportExcel();