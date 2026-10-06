(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('accountForm');
  const loginTab = $('loginTab');
  const registerTab = $('registerTab');
  const password = $('password');
  let mode = 'login';
  const params = new URLSearchParams(location.search);
  const candidate = new URL(params.get('next') || 'index.html', location.origin);
  const nextPage = candidate.origin === location.origin ? candidate.pathname + candidate.search + candidate.hash : 'index.html';

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
  function showGoogleError(message) {
    const el = $('googleMessage');
    el.textContent = message;
  }

  async function handleGoogleCredential(response) {
    const button = $('googleButton');
    button.setAttribute('aria-busy', 'true');
    showGoogleError('Verificando tu cuenta…');
    try {
      const result = await fetch('/api/auth/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(data.message || 'No se pudo verificar tu cuenta de Google.');
      localStorage.setItem('snapfree_token', data.token);
      showGoogleError('Acceso correcto. Te estamos llevando a SnapFree.');
      $('googleMessage').classList.add('is-success');
      window.location.assign(nextPage);
    } catch (error) {
      button.removeAttribute('aria-busy');
      showGoogleError(error.message || 'No se pudo completar el acceso con Google.');
    }
  }

  async function setupGoogle() {
    const message = $('googleMessage');
    try {
      const configResponse = await fetch('/api/auth/google/config');
      const config = await configResponse.json();
      if (!configResponse.ok || !config.clientId) throw new Error('El acceso con Google todavía no está configurado.');
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (!window.google?.accounts?.id) return showGoogleError('No se pudo cargar el acceso de Google.');
        window.google.accounts.id.initialize({ client_id: config.clientId, callback: handleGoogleCredential, ux_mode: 'popup' });
        window.google.accounts.id.renderButton($('googleButton'), {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(430, $('googleButton').clientWidth || 430),
          logo_alignment: 'left'
        });
      };
      script.onerror = () => showGoogleError('No se pudo cargar el acceso de Google.');
      document.head.appendChild(script);
    } catch (error) {
      message.textContent = error.message;
    }
  }
  setupGoogle();
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

  if (params.has('error')) showMessage('No se pudo iniciar sesión con Google. Inténtalo de nuevo.');
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
