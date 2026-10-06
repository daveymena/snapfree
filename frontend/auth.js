// SnapFree authentication helpers shared by the app and account page.
window.SnapAuth = (() => {
  const K = 'snapfree_token';
  const token = () => localStorage.getItem(K) || '';
  const h = () => token() ? { Authorization: 'Bearer ' + token() } : {};

  async function request(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'No se pudo completar la solicitud.');
    if (data.token) localStorage.setItem(K, data.token);
    return data;
  }

  async function quota() {
    try {
      const response = await fetch('/api/quota', { headers: h() });
      return await response.json();
    } catch {
      return { login: !!token(), left: 5, limit: 5, pro: false };
    }
  }

  const register = (email, password) => request('/api/auth/register', { email, password });
  const login = (email, password) => request('/api/auth/login', { email, password });
  const logout = () => localStorage.removeItem(K);
  return { token, h, quota, register, login, logout };
})();

// Google OAuth returns the app JWT on the redirect URL.
(() => {
  const url = new URL(window.location.href);
  const returnedToken = url.searchParams.get('token');
  if (returnedToken) {
    localStorage.setItem('snapfree_token', returnedToken);
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
})();
