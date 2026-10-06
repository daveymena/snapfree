(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('accountForm');
  const loginTab = $('loginTab');
  const registerTab = $('registerTab');
  const password = $('password');
  const params = new URLSearchParams(location.search);
  const candidate = new URL(params.get('next') || 'index.html', location.origin);
  const nextPage = candidate.origin === location.origin ? candidate.pathname + candidate.search + candidate.hash : 'index.html';
  let mode = 'login';

  function setMode(next) {
    mode = next;
    const registering = mode === 'register';
    loginTab.classList.toggle('is-active', !registering);
    registerTab.classList.toggle('is-active', registering);
    loginTab.setAttribute('aria-selected', String(!registering));
    registerTab.setAttribute('aria-selected', String(registering));
    $('formTitle').textContent = registering ? 'Crea tu cuenta' : 'Inicia sesión';
    $('formSubtitle').textContent = registering ? 'Empieza gratis en menos de un minuto.' : 'Continúa donde lo dejaste.';
    $('submitButton').querySelector('span:first-child').textContent = registering ? 'Crear cuenta gratis' : 'Iniciar sesión';
    password.autocomplete = registering ? 'new-password' : 'current-password';
    $('forgotPassword').hidden = registering;
    $('formMessage').textContent = '';
    $('formMessage').classList.remove('is-success');
  }

  function showMessage(message, success = false) {
    const el = $('formMessage');
    el.textContent = message;
    el.classList.toggle('is-success', success);
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));
  $('togglePassword').addEventListener('click', (event) => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
    event.currentTarget.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  $('forgotPassword').addEventListener('click', (event) => {
    event.preventDefault();
    showMessage('La recuperación de contraseña aún no está configurada. Escríbenos desde Ayuda.');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('email').value.trim();
    const pass = password.value;
    const button = $('submitButton');
    if (!form.reportValidity()) return;
    button.disabled = true;
    button.querySelector('span:first-child').textContent = mode === 'register' ? 'Creando cuenta…' : 'Validando…';
    showMessage('');
    try {
      if (mode === 'register') await SnapAuth.register(email, pass);
      else await SnapAuth.login(email, pass);
      showMessage(mode === 'register' ? 'Cuenta creada. Te estamos llevando a SnapFree…' : 'Sesión iniciada. Te estamos llevando a SnapFree…', true);
      window.setTimeout(() => window.location.assign(nextPage), 450);
    } catch (error) {
      showMessage(error.message || 'No pudimos completar el acceso. Inténtalo de nuevo.');
      button.disabled = false;
      button.querySelector('span:first-child').textContent = mode === 'register' ? 'Crear cuenta gratis' : 'Iniciar sesión';
    }
  });

  $('logoutButton').addEventListener('click', () => {
    SnapAuth.logout();
    window.location.reload();
  });

  if (params.has('error')) showMessage('No se pudo iniciar sesión. Inténtalo de nuevo con correo y contraseña.');
  params.delete('error');
  if (location.search && !location.search.includes('token=')) {
    history.replaceState({}, document.title, location.pathname + (params.size ? `?${params}` : ''));
  }

  SnapAuth.quota().then((quota) => {
    if (!quota.login) return;
    $('authCard').hidden = true;
    $('signedInCard').hidden = false;
    $('signedInEmail').textContent = quota.email || 'Ya iniciaste sesión en este dispositivo.';
  });
})();
