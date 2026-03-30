function checkAccess(allowedRoles) {
  const role = localStorage.getItem('userRole');
  const login = localStorage.getItem('userLogin');

  if (!login || !role) {
    location.href = 'index.html';
    return;
  }

  if (!allowedRoles.includes(role)) {
    alert('Нет доступа');
    location.href = 'dashboard.html';
  }
}