const { app, BrowserWindow } = require('electron');
const path = require('path');

require('./database'); // гарантированно создаёт БД

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      nodeIntegration: true, // 🔥 ВКЛЮЧАЕМ
      contextIsolation: false // 🔥 ОТКЛЮЧАЕМ
    }
  });

  win.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);