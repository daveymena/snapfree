// SnapFree SaaS: usuarios, planes, cuotas + PayPal y MercadoPago.
// Planes: FREE (5 descargas/día) / PRO mensual o anual (ilimitadas + máxima calidad).
// Configura en variables de entorno (ver .env.example):
//  JWT_SECRET, BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE(sandbox|live),
//  MP_ACCESS_TOKEN, PRO_MONTHLY_USD, PRO_YEARLY_USD
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const DBFILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'snapfree-dev-secret-cambia-en-produccion';
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FREE_DAILY = parseInt(process.env.FREE_DAILY || '5', 10);
const PRICES = {
  monthly: parseFloat(process.env.PRO_MONTHLY_USD || '2.99'),
  yearly: parseFloat(process.env.PRO_YEARLY_USD || '19.99'),
};

function load() {
  try { return JSON.parse(fs.readFileSync(DBFILE, 'utf8')); }
  catch { return { users: {}, payments: [] }; }
}
function save(db) { fs.writeFileSync(DBFILE, JSON.stringify(db, null, 1)); }
function today() { return new Date().toISOString().slice(0, 10); }
function hash(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

function getUser(db, email) { return db.users[email.toLowerCase()]; }
function isPro(u) {
  return u && (u.plan === 'pro' || u.plan === 'pro_yearly') && u.planUntil && Date.parse(u.planUntil) > Date.now();
}
function leftToday(u) {
  if (isPro(u)) return Infinity;
  const used = (u && u.downloads && u.downloads[today()]) || 0;
  return Math.max(0, FREE_DAILY - used);
}
function consume(db, emailOrIp, isIp) {
  const t = today();
  if (isIp) {
    db.ipdl = db.ipdl || {}; db.ipdl[t] = db.ipdl[t] || {};
    db.ipdl[t][emailOrIp] = (db.ipdl[t][emailOrIp] || 0) + 1;
  } else {
    const u = getUser(db, emailOrIp);
    if (!u) return false;
    if (isPro(u)) return true; // ilimitado, ni se cuenta
    u.downloads = u.downloads || {};
    u.downloads[t] = (u.downloads[t] || 0) + 1;
  }
  save(db); return true;
}
function activatePro(db, email, cycle, externalId) {
  email = email.toLowerCase();
  const u = db.users[email] || { downloads: {} };
  const months = cycle === 'yearly' ? 12 : 1;
  const base = Math.max(Date.now(), Date.parse(u.planUntil || 0) || 0);
  const until = new Date(base); until.setMonth(until.getMonth() + months);
  u.plan = cycle === 'yearly' ? 'pro_yearly' : 'pro';
  u.planUntil = until.toISOString();
  db.users[email] = u;
  db.payments.push({ email, cycle, externalId, at: new Date().toISOString() });
  save(db);
  return u;
}

// ---------- Auth ----------
function authOptional(req, res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch { /* token inválido = invitado */ }
  }
  next();
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'LOGIN_REQUIRED', message: 'Inicia sesión para continuar.' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'LOGIN_REQUIRED', message: 'Sesión vencida, entra de nuevo.' }); }
}
// Cuota: PRO ilimitado / gratis 5 al día (por cuenta o por IP si no hay login).
function quota(req, res, next) {
  const db = load();
  if (req.user) {
    const u = getUser(db, req.user.email);
    if (!u) return res.status(401).json({ error: 'LOGIN_REQUIRED', message: 'Cuenta no existe.' });
    const left = leftToday(u);
    if (left <= 0) return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: `Llegaste a tus ${FREE_DAILY} descargas gratis de hoy. Pásate a PRO para ilimitadas.`, pro: false });
    consume(db, req.user.email, false);
    req.quotaLeft = leftToday(getUser(load(), req.user.email));
  } else {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon').toString().slice(0, 45);
    db.ipdl = db.ipdl || {}; db.ipdl[today()] = db.ipdl[today()] || {};
    const used = db.ipdl[today()][ip] || 0;
    if (used >= FREE_DAILY) return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: `Llegaste a tus ${FREE_DAILY} descargas gratis de hoy. Crea cuenta PRO para ilimitadas.`, pro: false });
    consume(db, ip, true);
    req.quotaLeft = FREE_DAILY - used - 1;
  }
  if (req.quotaLeft !== undefined && Number.isFinite(req.quotaLeft)) res.setHeader('X-Quota-Left', String(req.quotaLeft));
  next();
}

// ---------- PayPal ----------
async function ppToken() {
  const id = process.env.PAYPAL_CLIENT_ID, sec = process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET;
  if (!id || !sec) throw new Error('PAYPAL_NO_CONFIG');
  const base = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const r = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('PAYPAL_AUTH');
  return { token: j.access_token, base };
}

async function mpGet(url, method, body) {
  const tk = process.env.MP_ACCESS_TOKEN;
  if (!tk) throw new Error('MP_NO_CONFIG');
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error('MP_API: ' + JSON.stringify(j).slice(0, 200));
  return j;
}

function mount(app) {
  // Registro / login
  app.post('/api/auth/register', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'EMAIL_INVALIDO', message: 'Escribe un correo válido.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'CLAVE_CORTA', message: 'La clave debe tener 6+ caracteres.' });
    const db = load(); const k = email.toLowerCase();
    if (db.users[k]) return res.status(409).json({ error: 'YA_EXISTE', message: 'Ese correo ya tiene cuenta, inicia sesión.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[k] = { pass: hash(password, salt), salt, plan: 'free', planUntil: null, downloads: {}, created: new Date().toISOString() };
    save(db);
    const token = jwt.sign({ email: k }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: k, plan: 'free', left: FREE_DAILY, limit: FREE_DAILY });
  });
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const db = load(); const u = getUser(db, (email || ''));
    if (!u || u.pass !== hash(password || '', u.salt)) return res.status(401).json({ error: 'CREDENCIALES', message: 'Correo o clave incorrectos.' });
    const token = jwt.sign({ email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    const pro = isPro(u);
    res.json({ token, email: email.toLowerCase(), plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: leftToday(u) === Infinity ? -1 : leftToday(u), limit: FREE_DAILY });
  });
  // Cuota actual (pública: con o sin login)
  app.get('/api/quota', authOptional, (req, res) => {
    const db = load();
    if (req.user) {
      const u = getUser(db, req.user.email);
      if (!u) return res.json({ login: false, left: FREE_DAILY, limit: FREE_DAILY, pro: false });
      const pro = isPro(u);
      return res.json({ login: true, email: req.user.email, plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: pro ? -1 : leftToday(u), limit: FREE_DAILY, pro });
    }
    res.json({ login: false, left: FREE_DAILY, limit: FREE_DAILY, pro: false });
  });
  app.get('/api/me', authRequired, (req, res) => {    const db = load(); const u = getUser(db, req.user.email);
    if (!u) return res.status(404).json({ error: 'NO_USER' });
    const pro = isPro(u);
    res.json({ email: req.user.email, plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: pro ? -1 : leftToday(u), limit: FREE_DAILY });
  });

  // PayPal: crear orden -> link de aprobación
  app.post('/api/paypal/create', authRequired, async (req, res) => {
    try {
      const cycle = req.body && req.body.cycle === 'yearly' ? 'yearly' : 'monthly';
      const { token, base } = await ppToken();
      const r = await fetch(base + '/v2/checkout/orders', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: PRICES[cycle].toFixed(2) }, description: `SnapFree PRO ${cycle === 'yearly' ? 'Anual' : 'Mensual'} (${req.user.email})` }],
          application_context: { return_url: BASE_URL + '/pago-ok.html?ok=1', cancel_url: BASE_URL + '/pricing.html' },
        }),
      });
      const j = await r.json();
      const link = (j.links || []).find(l => l.rel === 'approve');
      if (!link) throw new Error('PAYPAL_ORDER');
      const db = load(); db.payments.push({ email: req.user.email, cycle, paypalOrder: j.id, at: new Date().toISOString(), status: 'created' }); save(db);
      res.json({ approve: link.href, orderID: j.id });
    } catch (e) { res.status(500).json({ error: 'PAYPAL_ERROR', message: 'Activa tus claves PayPal en el servidor (modo prueba primero).' }); }
  });
  // PayPal: capturar tras aprobación -> activa PRO
  app.post('/api/paypal/capture', authRequired, async (req, res) => {
    try {
      const { token, base } = await ppToken();
      const r = await fetch(`${base}/v2/checkout/orders/${req.body.orderID}/capture`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (j.status !== 'COMPLETED') throw new Error('NOT_COMPLETED');
      const db = load();
      const p = db.payments.find(x => x.paypalOrder === req.body.orderID);
      const u = activatePro(db, req.user.email, (p && p.cycle) || 'monthly', req.body.orderID);
      res.json({ ok: true, plan: u.plan, planUntil: u.planUntil });
    } catch (e) { res.status(500).json({ error: 'PAYPAL_CAPTURE', message: 'No se pudo confirmar el pago.' }); }
  });

  // MercadoPago: crear preferencia -> init_point (tarjeta, OXXO, etc. según país)
  app.post('/api/mp/create', authRequired, async (req, res) => {
    try {
      const cycle = req.body && req.body.cycle === 'yearly' ? 'yearly' : 'monthly';
      const pref = await mpGet('https://api.mercadopago.com/checkout/preferences', 'POST', {
        items: [{ title: `SnapFree PRO ${cycle === 'yearly' ? 'Anual' : 'Mensual'}`, quantity: 1, unit_price: PRICES[cycle], currency_id: 'USD' }],
        payer: { email: req.user.email },
        metadata: { email: req.user.email, cycle },
        back_urls: { success: BASE_URL + '/pago-ok.html?ok=1', failure: BASE_URL + '/pricing.html', pending: BASE_URL + '/pricing.html' },
        notification_url: BASE_URL + '/api/mp/webhook',
      });
      res.json({ init_point: pref.init_point, id: pref.id });
    } catch (e) { res.status(500).json({ error: 'MP_ERROR', message: 'Activa tu Access Token de MercadoPago en el servidor.' }); }
  });
  // MercadoPago webhook: confirma pago aprobado -> activa PRO
  app.post('/api/mp/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
      const payId = (req.query && (req.query['data.id'] || req.query.id)) || (req.body && req.body.data && req.body.data.id);
      if (!payId) return;
      const pay = await mpGet(`https://api.mercadopago.com/v1/payments/${payId}`, 'GET');
      if (pay.status === 'approved' && pay.metadata && pay.metadata.email) {
        const db = load();
        activatePro(db, pay.metadata.email, pay.metadata.cycle || 'monthly', 'mp-' + payId);
      }
    } catch (e) { console.warn('[mp webhook]', e.message); }
  });

  return { authOptional, authRequired, quota, FREE_DAILY, PRICES, isPro, leftToday, getUser, load };
}

module.exports = { mount };
