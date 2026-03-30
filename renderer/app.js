const db = require('../database');

window.onload = () => {
  const btn = document.getElementById('btnLogin');
  if (btn) {
    btn.addEventListener('click', loginUser);
  }
};

async function loginUser() {
  const login = document.getElementById('login').value;
  const password = document.getElementById('password').value;

  if (!login || !password) {
    alert('Введите логин и пароль');
    return;
  }

  try {
    const user = await db.login(login, password);
    
    if (user) {
      // 🔥 теперь localStorage
      localStorage.setItem('userId', user.id);
      localStorage.setItem('userLogin', user.login);
      localStorage.setItem('userRole', user.role);
      
     switch (user.role) {
        case 'admin':
        case 'accountant':
        case 'manager':
        case 'employee':
          location.href = 'dashboard.html';
        break;
      }
    } else {
      alert('Неверный логин или пароль');
    }
  } catch (e) {
    console.error('Ошибка авторизации:', e);
    alert('Ошибка при входе в систему');
  }
}