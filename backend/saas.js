// SnapFree SaaS: usuarios, planes, cuotas + PayPal y MercadoPago.
// Planes: FREE (5 descargas/día) / PRO mensual o anual (ilimitadas + máxima calidad).
// Configura en variables de entorno (ver .env.example):
//  JWT_SECRET, BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE(sandbox|live),
//  MP_ACCESS_TOKEN, PRO_MONTHLY_USD, PRO_YEARLY_USD
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const DBFILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'snapfree-dev-secret-cambia-en-produccion';
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const FREE_DAILY = parseInt(process.env.FREE_DAILY || '5', 10);
const PRICES = {
  monthly: parseFloat(process.env.PRO_MONTHLY_USD || '2.99'),
  yearly: parseFloat(process.env.PRO_YEARLY_USD || '19.99'),
};

// Google API Setup
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_KEY || process.env.GOOGLE_API_KEY;

// PG Setup
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
let dbInit = Promise.resolve();

async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password TEXT,
        salt TEXT,
        plan TEXT DEFAULT 'free',
        planUntil TIMESTAMP,
        downloads JSONB DEFAULT '{}',
        created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        googleId TEXT
      );
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        cycle TEXT NOT NULL,
        externalId TEXT,
        at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT
      );
      CREATE TABLE IF NOT EXISTS ip_downloads (
        day TEXT NOT NULL,
        ip TEXT NOT NULL,
        downloads INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, ip)
      );
      CREATE TABLE IF NOT EXISTS app_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await migrateLegacyJson();
    console.log('🐘 PostgreSQL tables initialized');
  } catch (e) {
    console.error('🐘 DB Init Error:', e.message);
    throw e;
  }
}
if (pool) dbInit = initDb();

async function migrateLegacyJson() {
  const migrationName = 'legacy-data-json-v1';
  const done = await pool.query('SELECT 1 FROM app_migrations WHERE name = $1', [migrationName]);
  if (done.rowCount) return;

  let legacy = { users: {}, payments: [], ipdl: {} };
  if (fs.existsSync(DBFILE)) legacy = JSON.parse(fs.readFileSync(DBFILE, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [rawEmail, user] of Object.entries(legacy.users || {})) {
      const email = rawEmail.toLowerCase();
      await client.query(
        `INSERT INTO users (email, password, salt, plan, planUntil, downloads, created, googleId)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (email) DO NOTHING`,
        [email, user.pass || user.password || null, user.salt || null, user.plan || 'free', user.planUntil || null,
          JSON.stringify(user.downloads || {}), user.created || new Date().toISOString(), user.googleId || null],
      );
    }
    for (const payment of legacy.payments || []) {
      if (!payment.email) continue;
      await client.query(
        'INSERT INTO payments (email, cycle, externalId, at, status) VALUES ($1, $2, $3, $4, $5)',
        [payment.email.toLowerCase(), payment.cycle || 'monthly', payment.externalId || payment.paypalOrder || null,
          payment.at || new Date().toISOString(), payment.status || null],
      );
    }
    for (const [day, ips] of Object.entries(legacy.ipdl || {})) {
      for (const [ip, downloads] of Object.entries(ips || {})) {
        await client.query(
          'INSERT INTO ip_downloads (day, ip, downloads) VALUES ($1, $2, $3) ON CONFLICT (day, ip) DO NOTHING',
          [day, ip, Number(downloads) || 0],
        );
      }
    }
    await client.query('INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [migrationName]);
    await client.query('COMMIT');
    console.log('[db] legacy JSON migrated to PostgreSQL');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function load() {
  try { return JSON.parse(fs.readFileSync(DBFILE, 'utf8')); }
  catch { return { users: {}, payments: [] }; }
}
function save(db) {
  if (!pool) fs.writeFileSync(DBFILE, JSON.stringify(db, null, 1));
}
function today() { return new Date().toISOString().slice(0, 10); }
function hash(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

async function getUser(email) {
  if (!pool) {
    const db = load();
    return db.users[email.toLowerCase()];
  }
  await dbInit;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!rows[0]) return null;
  // PostgreSQL folds unquoted identifiers to lowercase; normalize for the shared API.
  return { ...rows[0], pass: rows[0].password, planUntil: rows[0].planuntil, googleId: rows[0].googleid };
}
function isPro(u) {
  return u && (u.plan === 'pro' || u.plan === 'pro_yearly') && u.planUntil && Date.parse(u.planUntil) > Date.now();
}
async function leftToday(u) {
  if (isPro(u)) return Infinity;
  const t = today();
  const used = (u && u.downloads && u.downloads[t]) || 0;
  return Math.max(0, FREE_DAILY - used);
}
async function consume(emailOrIp, isIp) {
  const t = today();
  if (isIp) {
    if (pool) {
      await dbInit;
      await pool.query(
        'INSERT INTO ip_downloads (day, ip, downloads) VALUES ($1, $2, 1) ON CONFLICT (day, ip) DO UPDATE SET downloads = ip_downloads.downloads + 1',
        [t, emailOrIp],
      );
      return true;
    }
    const db = load();
    db.ipdl = db.ipdl || {}; db.ipdl[t] = db.ipdl[t] || {};
    db.ipdl[t][emailOrIp] = (db.ipdl[t][emailOrIp] || 0) + 1;
    save(db);
    return true;
  } else {
    if (!pool) {
      const db = load();
      const u = db.users[emailOrIp.toLowerCase()];
      if (!u) return false;
      if (isPro(u)) return true;
      u.downloads = u.downloads || {};
      u.downloads[t] = (u.downloads[t] || 0) + 1;
      save(db);
      return true;
    }
    const u = await getUser(emailOrIp);
    if (!u) return false;
    if (isPro(u)) return true;

    const downloads = u.downloads || {};
    downloads[t] = (downloads[t] || 0) + 1;
    await pool.query('UPDATE users SET downloads = $1 WHERE email = $2', [JSON.stringify(downloads), emailOrIp.toLowerCase()]);
    return true;
  }
}
async function activatePro(email, cycle, externalId) {
  email = email.toLowerCase();
  const months = cycle === 'yearly' ? 12 : 1;

  if (!pool) {
    const db = load();
    const u = db.users[email] || { downloads: {} };
    const base = Math.max(Date.now(), Date.parse(u.planUntil || 0) || 0);
    const until = new Date(base); until.setMonth(until.getMonth() + months);
    u.plan = cycle === 'yearly' ? 'pro_yearly' : 'pro';
    u.planUntil = until.toISOString();
    db.users[email] = u;
    db.payments.push({ email, cycle, externalId, at: new Date().toISOString() });
    save(db);
    return u;
  }

  const u = await getUser(email) || { downloads: {} };
  const base = Math.max(Date.now(), Date.parse(u.planUntil || 0) || 0);
  const until = new Date(base); until.setMonth(until.getMonth() + months);
  const plan = cycle === 'yearly' ? 'pro_yearly' : 'pro';

  await pool.query('INSERT INTO users (email, plan, planUntil, downloads) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET plan = $2, planUntil = $3',
    [email, plan, until.toISOString(), JSON.stringify(u.downloads || {})]);
  await pool.query('INSERT INTO payments (email, cycle, externalId) VALUES ($1, $2, $3)', [email, cycle, externalId]);

  return { email, plan, planUntil: until.toISOString() };
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
async function quota(req, res, next) {
  if (req.user) {
    const u = await getUser(req.user.email);
    if (!u) return res.status(401).json({ error: 'LOGIN_REQUIRED', message: 'Cuenta no existe.' });
    const left = await leftToday(u);
    if (left <= 0) return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: `Llegaste a tus ${FREE_DAILY} descargas gratis de hoy. Pásate a PRO para ilimitadas.`, pro: false });
    await consume(req.user.email, false);
    req.quotaLeft = await leftToday(await getUser(req.user.email));
  } else {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon').toString().slice(0, 45);
    let used;
    if (pool) {
      await dbInit;
      const { rows } = await pool.query('SELECT downloads FROM ip_downloads WHERE day = $1 AND ip = $2', [today(), ip]);
      used = rows[0]?.downloads || 0;
    } else {
      const db = load();
      db.ipdl = db.ipdl || {}; db.ipdl[today()] = db.ipdl[today()] || {};
      used = db.ipdl[today()][ip] || 0;
    }
    if (used >= FREE_DAILY) return res.status(402).json({ error: 'QUOTA_EXCEEDED', message: `Llegaste a tus ${FREE_DAILY} descargas gratis de hoy. Crea cuenta PRO para ilimitadas.`, pro: false });
    await consume(ip, true);
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
  app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'EMAIL_INVALIDO', message: 'Escribe un correo válido.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'CLAVE_CORTA', message: 'La clave debe tener 6+ caracteres.' });
    const k = email.toLowerCase();

    if (pool) {
      await dbInit;
      const { rows } = await pool.query('SELECT email FROM users WHERE email = $1', [k]);
      if (rows.length > 0) return res.status(409).json({ error: 'YA_EXISTE', message: 'Ese correo ya tiene cuenta, inicia sesión.' });
    } else {
      const db = load();
      if (db.users[k]) return res.status(409).json({ error: 'YA_EXISTE', message: 'Ese correo ya tiene cuenta, inicia sesión.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const pwHash = hash(password, salt);

    if (pool) {
      await dbInit;
      await pool.query('INSERT INTO users (email, password, salt, plan, created) VALUES ($1, $2, $3, $4, NOW())', [k, pwHash, salt, 'free']);
    } else {
      const db = load();
      db.users[k] = { pass: pwHash, salt, plan: 'free', planUntil: null, downloads: {}, created: new Date().toISOString() };
      save(db);
    }

    const token = jwt.sign({ email: k }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, email: k, plan: 'free', left: FREE_DAILY, limit: FREE_DAILY });
  });
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    const k = (email || '').toLowerCase();
    const u = await getUser(k);

    if (!u || u.pass !== hash(password || '', u.salt)) return res.status(401).json({ error: 'CREDENCIALES', message: 'Correo o clave incorrectos.' });

    const token = jwt.sign({ email: k }, JWT_SECRET, { expiresIn: '30d' });
    const pro = isPro(u);
    res.json({ token, email: k, plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: (await leftToday(u)) === Infinity ? -1 : await leftToday(u), limit: FREE_DAILY });
  });

  app.get('/api/auth/google/config', (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED' });
    res.json({ clientId: GOOGLE_CLIENT_ID });
  });

  app.post('/api/auth/google/token', async (req, res) => {
    try {
      const credential = req.body && req.body.credential;
      if (!credential) return res.status(400).json({ error: 'GOOGLE_CREDENTIAL_MISSING', message: 'Google no devolvió una credencial.' });
      const verify = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      const profile = await verify.json();
      if (!verify.ok || profile.aud !== GOOGLE_CLIENT_ID || profile.email_verified !== 'true' || !profile.email || !profile.sub) {
        return res.status(401).json({ error: 'GOOGLE_CREDENTIAL_INVALID', message: 'No pudimos verificar tu cuenta de Google.' });
      }

      const email = profile.email.toLowerCase();
      let user = await getUser(email);
      if (!user) {
        if (pool) {
          await pool.query('INSERT INTO users (email, plan, created, googleId) VALUES ($1, $2, NOW(), $3) ON CONFLICT (email) DO NOTHING', [email, 'free', profile.sub]);
          user = await getUser(email);
        } else {
          const db = load();
          db.users[email] = { pass: '', salt: '', plan: 'free', planUntil: null, downloads: {}, created: new Date().toISOString(), googleId: profile.sub };
          save(db);
          user = db.users[email];
        }
      }

      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, email, plan: user.plan || 'free' });
    } catch (error) {
      console.error('[google auth]', error.message);
      return res.status(500).json({ error: 'GOOGLE_AUTH_FAILED', message: 'No se pudo completar el acceso con Google.' });
    }
  });

  // Google Auth: Redirect to Google
  app.get('/api/auth/google', (req, res) => {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: GOOGLE_REDIRECT_URI,
      client_id: GOOGLE_CLIENT_ID,
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      scope: [ 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile' ].join(' ')
    };
    const qs = new URLSearchParams(options).toString();
    res.redirect(`${rootUrl}?${qs}`);
  });

  // Google Auth: Callback from Google
  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) throw new Error('NO_CODE');

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code'
        })
      });
      const tokens = await tokenResp.json();
      if (!tokens.access_token) throw new Error('GOOGLE_AUTH_FAILED');

      const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await userResp.json();
      const email = profile.email.toLowerCase();

      let u = await getUser(email);
      if (!u) {
        if (pool) {
          await pool.query('INSERT INTO users (email, plan, created, googleId) VALUES ($1, $2, NOW(), $3)', [email, 'free', profile.sub]);
          u = await getUser(email);
        } else {
          const db = load();
          db.users[email] = { pass: '', salt: '', plan: 'free', planUntil: null, downloads: {}, created: new Date().toISOString(), googleId: profile.sub };
          save(db);
          u = db.users[email];
        }
      }

      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30d' });
      res.redirect(`${BASE_URL}/index.html?token=${token}`);
    } catch (e) {
      console.error('Google Auth Error:', e);
      res.redirect(`${BASE_URL}/index.html?error=google_auth_failed`);
    }
  });
  // Cuota actual (pública: con o sin login)
  app.get('/api/quota', authOptional, async (req, res) => {
    if (req.user) {
      const u = await getUser(req.user.email);
      if (!u) return res.json({ login: false, left: FREE_DAILY, limit: FREE_DAILY, pro: false });
      const pro = isPro(u);
      return res.json({ login: true, email: req.user.email, plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: pro ? -1 : await leftToday(u), limit: FREE_DAILY, pro });
    }
    res.json({ login: false, left: FREE_DAILY, limit: FREE_DAILY, pro: false });
  });
  app.get('/api/me', authRequired, async (req, res) => {    const u = await getUser(req.user.email);
    if (!u) return res.status(404).json({ error: 'NO_USER' });
    const pro = isPro(u);
    res.json({ email: req.user.email, plan: pro ? u.plan : 'free', planUntil: u.planUntil, left: pro ? -1 : await leftToday(u), limit: FREE_DAILY });
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
      if (pool) {
        await dbInit;
        await pool.query('INSERT INTO payments (email, cycle, externalId, status) VALUES ($1, $2, $3, $4)', [req.user.email, cycle, j.id, 'created']);
      } else {
        const db = load();
        db.payments.push({ email: req.user.email, cycle, paypalOrder: j.id, at: new Date().toISOString(), status: 'created' });
        save(db);
      }
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
      let cycle = 'monthly';
      if (pool) {
        await dbInit;
        const { rows } = await pool.query('SELECT cycle FROM payments WHERE email = $1 AND externalId = $2 ORDER BY id DESC LIMIT 1', [req.user.email, req.body.orderID]);
        if (rows[0]) cycle = rows[0].cycle;
      } else {
        const db = load();
        const payment = db.payments.find(x => x.paypalOrder === req.body.orderID);
        if (payment) cycle = payment.cycle;
      }
      const u = await activatePro(req.user.email, cycle, req.body.orderID);
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
        await activatePro(pay.metadata.email, pay.metadata.cycle || 'monthly', 'mp-' + payId);
      }
    } catch (e) { console.warn('[mp webhook]', e.message); }
  });

  app.get('/api/tts', async (req, res) => {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'FALTO_TEXTO' });
    try {
      const ttsUrl = `https://texttospeech.googleapis.com/v1beta: synthesizeText?key=${GOOGLE_TTS_KEY}`;
      const body = {
        input: { text },
        voice: { languageCode: 'es-ES', name: 'es-ES-Standard-A' },
        audioConfig: { audioEncoding: 'MP3' }
      };
      const r = await fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!j.audioContent) throw new Error(JSON.stringify(j));
      res.contentType('audio/mpeg');
      res.send(Buffer.from(j.audioContent, 'base64'));
    } catch (e) {
      console.error('TTS Error:', e);
      res.status(500).json({ error: 'TTS_FAILED', detail: e.message });
    }
  });
  return { authOptional, authRequired, quota, FREE_DAILY, PRICES, isPro, leftToday, getUser, load, ready: () => dbInit };
}

module.exports = { mount };
