// Server sin dependencias externas: sesión y configuración del dueño fuera del navegador.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, '.bufete-data.json');
const PORT = Number(process.env.PORT || 3000);
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || 'natalialasteniafonsecagonzalez@gmail.com').trim().toLowerCase();
const COOKIE_NAME = 'bufete_session';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginFailures = new Map();
const recoveryCodes = new Map();
const recoveryLimits = new Map();
const contactLimits = new Map();
const collaboratorRegistrationLimits = new Map();
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/logo-dorado.png', ['logo-dorado.png', 'image/png']]
]);

function loadData() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  return {
    admin: saved.admin || null,
    collaborators: Array.isArray(saved.collaborators) ? saved.collaborators : [],
    requests: Array.isArray(saved.requests) ? saved.requests : [],
    cases: Array.isArray(saved.cases) ? saved.cases : [],
    archives: Array.isArray(saved.archives) ? saved.archives : [],
    settings: { whatsapp: '', email: '', extraWhatsapp: [], extraEmails: [], ...(saved.settings || {}) }
  };
}
let data = loadData();
let setupCode = data.admin ? null : crypto.randomBytes(18).toString('hex');
if (setupCode) {
  console.log('\nCódigo de activación inicial del dueño (no se publica en la web):');
  console.log(setupCode + '\n');
}

function persist() {
  const tempPath = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, DATA_FILE);
}
function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}
function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  if (session.role === 'collaborator' && !data.collaborators.some(item => item.email === session.email && item.status === 'approved')) { sessions.delete(token); return null; }
  session.expires = Date.now() + SESSION_TTL;
  return session;
}
function makeSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + SESSION_TTL, role: user.role, email: user.email, name: user.name });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
}
function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
function requireOwner(req, res) {
  const session = getSession(req);
  if (session?.role === 'owner') return true;
  json(res, session ? 403 : 401, { error: 'Esta función es exclusiva del administrador.' });
  return false;
}
function requireMember(req, res) {
  if (getSession(req)) return true;
  json(res, 401, { error: 'Inicie sesión con una cuenta aprobada.' });
  return false;
}
function findAccount(email) {
  if (data.admin?.email === email) return { ...data.admin, role: 'owner' };
  const collaborator = data.collaborators.find(item => item.email === email);
  return collaborator ? { ...collaborator, role: 'collaborator' } : null;
}
function publicCollaborator(account) {
  return { id: account.id, name: account.name, email: account.email, phone: account.phone, status: account.status, createdAt: account.createdAt, lastLoginAt: account.lastLoginAt || null };
}
function publicCase(record) {
  const { files = [], email, ...details } = record;
  return { ...details, files: files.map(file => ({ id: file.id, kind: file.kind, name: file.name, createdAt: file.createdAt })) };
}
function publicArchive(file) {
  const { diskPath, ...details } = file;
  return details;
}
async function readJson(req, maxBytes = 256_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error('payload_too_large');
  }
  return JSON.parse(raw || '{}');
}
function normalizeSettings(input) {
  const whatsapp = String(input.whatsapp || '').replace(/\D/g, '');
  const email = String(input.email || '').trim().toLowerCase();
  const extraWhatsapp = (Array.isArray(input.extraWhatsapp) ? input.extraWhatsapp : []).slice(0, 3).map(value => String(value).replace(/\D/g, '')).filter(Boolean);
  const extraEmails = (Array.isArray(input.extraEmails) ? input.extraEmails : []).slice(0, 3).map(value => String(value).trim().toLowerCase()).filter(Boolean);
  const ownerRecoveryPhone = String(input.ownerRecoveryPhone || '').replace(/\s/g, '');
  if (whatsapp && !/^\d{8,15}$/.test(whatsapp)) throw new Error('El WhatsApp principal debe tener de 8 a 15 dígitos con código de país.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo público no es válido.');
  if (extraWhatsapp.some(value => !/^\d{8,15}$/.test(value))) throw new Error('Cada WhatsApp adicional debe tener de 8 a 15 dígitos.');
  if (extraEmails.some(value => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new Error('Revise los correos adicionales.');
  if (ownerRecoveryPhone && !/^\+[0-9]{8,15}$/.test(ownerRecoveryPhone)) throw new Error('El teléfono privado debe llevar + y código de país.');
  return { whatsapp, email, extraWhatsapp, extraEmails, ownerRecoveryPhone };
}
function normalizeCase(input) {
  const record = {
    clientName: String(input.clientName || '').trim().slice(0, 160),
    cedula: String(input.cedula || '').trim().slice(0, 80),
    phone: String(input.phone || '').trim().slice(0, 40),
    email: String(input.email || '').trim().toLowerCase().slice(0, 160),
    deedReference: String(input.deedReference || '').trim().slice(0, 180),
    protocolReference: String(input.protocolReference || '').trim().slice(0, 180),
    protocolBook: String(input.protocolBook || '').trim().slice(0, 120),
    matterType: ['general', 'sale', 'mancomunada', 'company'].includes(input.matterType) ? input.matterType : 'general',
    deedStatus: String(input.deedStatus || 'pending'),
    protocolStatus: String(input.protocolStatus || 'pending'),
    signatureStatus: String(input.signatureStatus || 'pending'),
    assignedTo: String(input.assignedTo || '').trim().toLowerCase(),
    notes: String(input.notes || '').trim().slice(0, 3000)
  };
  const documentStatuses = ['pending', 'in_progress', 'ready', 'delivered'];
  const signatureStatuses = ['pending', 'scheduled', 'signed', 'delivered'];
  if (!record.clientName || !record.cedula || !record.phone) throw new Error('Nombre, cédula y teléfono del cliente son obligatorios.');
  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) throw new Error('El correo del cliente no es válido.');
  if (!documentStatuses.includes(record.deedStatus) || !documentStatuses.includes(record.protocolStatus) || !signatureStatuses.includes(record.signatureStatus)) throw new Error('Revise los estados del expediente.');
  return record;
}

async function sendRecoverySms(phone, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error('sms_not_configured');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: from, Body: `Código temporal del Bufete Jurídico Fonseca: ${code}. Vence en 10 minutos.` })
  });
  if (!response.ok) throw new Error('sms_send_failed');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { json(res, 400, { error: 'Dirección no válida.' }); return; }

  if (url.pathname.startsWith('/api/') && req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) { json(res, 403, { error: 'Origen no permitido.' }); return; }
  }

  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const session = getSession(req);
      json(res, 200, { setupRequired: !data.admin, authenticated: Boolean(session), role: session?.role || null, name: session?.name || null });
      return;
    }
    if (url.pathname === '/api/public-settings' && req.method === 'GET') {
      json(res, 200, { whatsapp: data.settings.whatsapp, email: data.settings.email, extraEmails: data.settings.extraEmails });
      return;
    }
    if (url.pathname === '/api/contact-requests' && req.method === 'POST') {
      const address = req.socket.remoteAddress || 'unknown';
      const limit = contactLimits.get(address);
      if (limit && limit.until > Date.now() && limit.count >= 10) { json(res, 429, { error: 'Se alcanzó el límite de envíos. Intente más tarde.' }); return; }
      const body = await readJson(req);
      const name = String(body.name || '').trim().slice(0, 120);
      const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15);
      const email = String(body.email || '').trim().slice(0, 160);
      const subject = String(body.subject || '').trim().slice(0, 160);
      const details = String(body.details || '').trim().slice(0, 3000);
      if (body.consent !== true || name.length < 2 || phone.length < 8 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || details.length < 2) { json(res, 400, { error: 'Revise los datos y confirme que desea compartirlos con el bufete.' }); return; }
      contactLimits.set(address, { count: limit && limit.until > Date.now() ? limit.count + 1 : 1, until: Date.now() + 60_000 });
      const request = { id: crypto.randomUUID(), name, phone, email, subject, details, status: 'new', createdAt: new Date().toISOString() };
      data.requests.push(request);
      persist();
      json(res, 201, { ok: true, id: request.id });
      return;
    }
    if (url.pathname === '/api/admin/setup' && req.method === 'POST') {
      if (data.admin || !setupCode) { json(res, 409, { error: 'La cuenta del dueño ya está activada.' }); return; }
      const body = await readJson(req);
      if (body.setupCode !== setupCode) { json(res, 403, { error: 'El código de activación no coincide.' }); return; }
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').replace(/\s/g, '');
      const password = String(body.password || '');
      if (!name || email !== OWNER_EMAIL || !/^\+[0-9]{8,15}$/.test(phone) || password.length < 10) { json(res, 400, { error: 'Use el correo designado para el dueño, teléfono internacional y contraseña de al menos 10 caracteres.' }); return; }
      const salt = crypto.randomBytes(16);
      data.admin = { id: crypto.randomUUID(), name, email, phone, salt: salt.toString('hex'), passwordHash: crypto.scryptSync(password, salt, 64).toString('hex') };
      persist();
      setupCode = null;
      makeSession(res, { role: 'owner', email, name });
      json(res, 201, { ok: true });
      return;
    }
    if (url.pathname === '/api/collaborators/register' && req.method === 'POST') {
      const address = req.socket.remoteAddress || 'unknown';
      const limit = collaboratorRegistrationLimits.get(address);
      if (limit && limit.until > Date.now() && limit.count >= 5) { json(res, 429, { error: 'Se alcanzó el límite de solicitudes. Intente más tarde.' }); return; }
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').replace(/\s/g, '');
      const password = String(body.password || '');
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+[0-9]{8,15}$/.test(phone) || password.length < 10) { json(res, 400, { error: 'Complete nombre, correo, teléfono internacional y una contraseña de al menos 10 caracteres.' }); return; }
      if (findAccount(email)) { json(res, 409, { error: 'Ya existe una cuenta con ese correo.' }); return; }
      const salt = crypto.randomBytes(16);
      const collaborator = { id: crypto.randomUUID(), name, email, phone, salt: salt.toString('hex'), passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'), status: 'pending', createdAt: new Date().toISOString() };
      collaboratorRegistrationLimits.set(address, { count: limit && limit.until > Date.now() ? limit.count + 1 : 1, until: Date.now() + 60 * 60_000 });
      data.collaborators.push(collaborator);
      persist();
      json(res, 201, { ok: true, message: 'Solicitud recibida. El administrador debe aprobarla antes de que pueda iniciar sesión.' });
      return;
    }
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const address = req.socket.remoteAddress || 'unknown';
      const failures = loginFailures.get(address);
      if (failures && failures.until > Date.now() && failures.count >= 5) { json(res, 429, { error: 'Demasiados intentos. Espere unos minutos e inténtelo de nuevo.' }); return; }
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const account = findAccount(email);
      let valid = false;
      if (account) {
        const candidate = crypto.scryptSync(password, Buffer.from(account.salt, 'hex'), 64);
        const expected = Buffer.from(account.passwordHash, 'hex');
        valid = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
      }
      if (!valid) {
        const count = failures && failures.until > Date.now() ? failures.count + 1 : 1;
        loginFailures.set(address, { count, until: Date.now() + 5 * 60 * 1000 });
        json(res, 401, { error: 'Correo o contraseña incorrectos.' });
        return;
      }
      if (account.role === 'collaborator' && account.status !== 'approved') {
        json(res, 403, { error: account.status === 'rejected' ? 'El administrador no aprobó esta solicitud.' : 'Su cuenta sigue pendiente de aprobación del administrador.' });
        return;
      }
      if (account.role === 'collaborator') {
        const collaborator = data.collaborators.find(item => item.email === account.email);
        if (collaborator) { collaborator.lastLoginAt = new Date().toISOString(); persist(); }
      }
      loginFailures.delete(address);
      makeSession(res, account);
      json(res, 200, { ok: true, role: account.role, name: account.name });
      return;
    }
    if (url.pathname === '/api/recovery/request' && req.method === 'POST') {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) { json(res, 503, { error: 'La recuperación por SMS todavía no está configurada por el administrador del servidor.' }); return; }
      const address = req.socket.remoteAddress || 'unknown';
      const nextAllowed = recoveryLimits.get(address) || 0;
      if (nextAllowed > Date.now()) { json(res, 429, { error: 'Espere un minuto antes de solicitar otro código.' }); return; }
      recoveryLimits.set(address, Date.now() + 60_000);
      const body = await readJson(req);
      const phone = String(body.phone || '').replace(/\s/g, '');
      if (!/^\+[0-9]{8,15}$/.test(phone)) { json(res, 400, { error: 'Ingrese el número con + y código de país.' }); return; }
      const account = data.admin?.phone === phone ? { ...data.admin, role: 'owner' } : data.collaborators.find(item => item.phone === phone);
      if (account) {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const salt = crypto.randomBytes(16);
        recoveryCodes.set(phone, { email: account.email, role: account.role || 'collaborator', salt: salt.toString('hex'), codeHash: crypto.scryptSync(code, salt, 32).toString('hex'), expires: Date.now() + 10 * 60_000, attempts: 0 });
        try { await sendRecoverySms(phone, code); }
        catch (error) { recoveryCodes.delete(phone); json(res, 502, { error: error.message === 'sms_not_configured' ? 'La recuperación por SMS todavía no está configurada.' : 'No se pudo enviar el SMS. Verifique la configuración del servidor.' }); return; }
      }
      json(res, 200, { ok: true, message: 'Si el número está registrado, recibirá un código temporal por SMS.' });
      return;
    }
    if (url.pathname === '/api/recovery/confirm' && req.method === 'POST') {
      const body = await readJson(req);
      const phone = String(body.phone || '').replace(/\s/g, '');
      const code = String(body.code || '');
      const password = String(body.password || '');
      const recovery = recoveryCodes.get(phone);
      if (!recovery || recovery.expires < Date.now() || recovery.attempts >= 5) { recoveryCodes.delete(phone); json(res, 400, { error: 'El código venció o ya no es válido. Solicite otro.' }); return; }
      const candidate = crypto.scryptSync(code, Buffer.from(recovery.salt, 'hex'), 32);
      const expected = Buffer.from(recovery.codeHash, 'hex');
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
        recovery.attempts++;
        json(res, 400, { error: 'El código no coincide.' });
        return;
      }
      if (password.length < 10) { json(res, 400, { error: 'La nueva contraseña debe tener al menos 10 caracteres.' }); return; }
      const salt = crypto.randomBytes(16);
      const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
      if (recovery.role === 'owner' && data.admin.email === recovery.email) {
        data.admin.salt = salt.toString('hex');
        data.admin.passwordHash = passwordHash;
      } else {
        const user = data.collaborators.find(item => item.email === recovery.email);
        if (!user) { recoveryCodes.delete(phone); json(res, 400, { error: 'No se encontró la cuenta para este número.' }); return; }
        user.salt = salt.toString('hex');
        user.passwordHash = passwordHash;
      }
      persist();
      for (const [token, session] of sessions) if (session.email === recovery.email) sessions.delete(token);
      recoveryCodes.delete(phone);
      json(res, 200, { ok: true, email: recovery.email, message: `Contraseña actualizada. Su usuario de acceso es ${recovery.email}.` });
      return;
    }
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      clearSession(req, res);
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/admin/settings' && req.method === 'GET') {
      if (!requireOwner(req, res)) return;
      json(res, 200, { ...data.settings, ownerRecoveryPhone: data.admin.phone || '' });
      return;
    }
    if (url.pathname === '/api/admin/settings' && req.method === 'POST') {
      if (!requireOwner(req, res)) return;
      const body = await readJson(req);
      try {
        const normalized = normalizeSettings(body);
        data.admin.phone = normalized.ownerRecoveryPhone || data.admin.phone || '';
        delete normalized.ownerRecoveryPhone;
        data.settings = normalized;
      }
      catch (error) { json(res, 400, { error: error.message }); return; }
      persist();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/admin/collaborators' && req.method === 'GET') {
      if (!requireOwner(req, res)) return;
      json(res, 200, data.collaborators.map(publicCollaborator));
      return;
    }
    if (url.pathname === '/api/admin/collaborators/review' && req.method === 'POST') {
      if (!requireOwner(req, res)) return;
      const body = await readJson(req);
      const collaborator = data.collaborators.find(item => item.id === body.id);
      if (!collaborator || !['approved', 'rejected'].includes(body.status)) { json(res, 400, { error: 'Solicitud o decisión no válida.' }); return; }
      collaborator.status = body.status;
      collaborator.reviewedAt = new Date().toISOString();
      persist();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/requests' && req.method === 'GET') {
      if (!requireOwner(req, res)) return;
      json(res, 200, data.requests.slice().reverse());
      return;
    }
    if (url.pathname === '/api/requests/status' && req.method === 'POST') {
      if (!requireOwner(req, res)) return;
      const body = await readJson(req);
      const request = data.requests.find(item => item.id === body.id);
      const allowed = ['new', 'contacted', 'in_progress', 'closed'];
      if (!request || !allowed.includes(body.status)) { json(res, 400, { error: 'Solicitud o estado no válido.' }); return; }
      request.status = body.status;
      request.updatedAt = new Date().toISOString();
      persist();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/cases' && req.method === 'GET') {
      if (!requireMember(req, res)) return;
      const session = getSession(req);
      json(res, 200, data.cases.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => ({ ...publicCase(item), canEdit: session.role === 'owner' || item.assignedTo === session.email })));
      return;
    }
    if (url.pathname === '/api/cases' && req.method === 'POST') {
      if (!requireOwner(req, res)) return;
      const session = getSession(req);
      const body = await readJson(req);
      const record = normalizeCase(body);
      if (record.assignedTo && !data.collaborators.some(item => item.email === record.assignedTo && item.status === 'approved')) { json(res, 400, { error: 'Asigne el expediente a un colaborador aprobado.' }); return; }
      record.id = crypto.randomUUID();
      record.createdAt = new Date().toISOString();
      record.updatedAt = record.createdAt;
      record.createdBy = session.email;
      record.updatedBy = session.email;
      record.files = [];
      data.cases.push(record);
      persist();
      json(res, 201, { ok: true, id: record.id });
      return;
    }
    if (url.pathname === '/api/cases/update' && req.method === 'POST') {
      if (!requireMember(req, res)) return;
      const session = getSession(req);
      const body = await readJson(req);
      const record = data.cases.find(item => item.id === body.id);
      if (!record) { json(res, 404, { error: 'No se encontró el expediente.' }); return; }
      if (session.role !== 'owner' && record.assignedTo !== session.email) { json(res, 403, { error: 'Este expediente no está asignado a su cuenta.' }); return; }
      const statusValues = ['pending', 'in_progress', 'ready', 'delivered'];
      const signatureValues = ['pending', 'scheduled', 'signed', 'delivered'];
      if (session.role === 'owner') {
        const normalized = normalizeCase(body);
        if (normalized.assignedTo && !data.collaborators.some(item => item.email === normalized.assignedTo && item.status === 'approved')) { json(res, 400, { error: 'Solo puede asignar expedientes a colaboradores aprobados.' }); return; }
        Object.assign(record, normalized);
      } else {
        if (!statusValues.includes(body.deedStatus) || !statusValues.includes(body.protocolStatus) || !signatureValues.includes(body.signatureStatus)) { json(res, 400, { error: 'Revise los estados del expediente.' }); return; }
        record.deedStatus = body.deedStatus;
        record.protocolStatus = body.protocolStatus;
        record.signatureStatus = body.signatureStatus;
        record.notes = String(body.notes || '').trim().slice(0, 3000);
      }
      record.updatedAt = new Date().toISOString();
      record.updatedBy = session.email;
      persist();
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname === '/api/cases/files' && req.method === 'POST') {
      if (!requireMember(req, res)) return;
      const session = getSession(req);
      const body = await readJson(req, 8_000_000);
      const record = data.cases.find(item => item.id === body.caseId);
      if (!record) { json(res, 404, { error: 'No se encontró el expediente.' }); return; }
      const extensions = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
      const extension = extensions[body.contentType];
      const fileKinds = ['cedula', 'cedula_front', 'cedula_back', 'deed', 'protocol', 'buyer_id_front', 'buyer_id_back', 'seller_id_front', 'seller_id_back', 'circulation_front', 'circulation_back', 'coowner_id_front', 'coowner_id_back', 'company_ruc', 'attorney_id_front', 'attorney_id_back', 'other'];
      if (!extension || !fileKinds.includes(body.kind)) { json(res, 400, { error: 'Adjunte Word, PDF, JPG o PNG y seleccione una categoría válida.' }); return; }
      const encoded = String(body.data || '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) { json(res, 400, { error: 'El archivo no tiene un formato válido.' }); return; }
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) { json(res, 413, { error: 'Cada archivo debe pesar menos de 5 MB.' }); return; }
      record.files ||= [];
      if (record.files.length >= 20) { json(res, 400, { error: 'Este expediente alcanzó el máximo de 20 archivos.' }); return; }
      const fileId = crypto.randomUUID();
      const safeName = path.basename(String(body.name || 'documento')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'documento';
      const folder = path.join(ROOT, 'private-files', record.id);
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, `${fileId}${extension}`);
      fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
      record.files.push({ id: fileId, kind: body.kind, name: safeName, contentType: body.contentType, diskPath: path.relative(ROOT, filePath), createdAt: new Date().toISOString(), uploadedBy: session.email });
      record.updatedAt = new Date().toISOString();
      record.updatedBy = session.email;
      persist();
      json(res, 201, { ok: true, file: { id: fileId, kind: body.kind, name: safeName, createdAt: new Date().toISOString() } });
      return;
    }
    if (url.pathname === '/api/cases/file' && req.method === 'GET') {
      if (!requireMember(req, res)) return;
      const session = getSession(req);
      const record = data.cases.find(item => item.id === url.searchParams.get('caseId'));
      const file = record?.files?.find(item => item.id === url.searchParams.get('fileId'));
      if (!record || !file) { json(res, 404, { error: 'No se encontró el archivo.' }); return; }
      const privateRoot = path.resolve(ROOT, 'private-files') + path.sep;
      const filePath = path.resolve(ROOT, file.diskPath);
      if (!filePath.startsWith(privateRoot) || !fs.existsSync(filePath)) { json(res, 404, { error: 'No se encontró el archivo.' }); return; }
      const safeName = file.name.replace(/["\\\r\n]/g, '_');
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${safeName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (url.pathname === '/api/archive' && req.method === 'GET') {
      if (!requireMember(req, res)) return;
      json(res, 200, (data.archives || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicArchive));
      return;
    }
    if (url.pathname === '/api/archive/files' && req.method === 'POST') {
      if (!requireMember(req, res)) return;
      const session = getSession(req);
      const body = await readJson(req, 8_000_000);
      const protocolName = String(body.protocolName || '').trim().slice(0, 180);
      const deedName = String(body.deedName || '').trim().slice(0, 180);
      const relativePath = String(body.relativePath || '').replace(/[\\]/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/').slice(0, 500);
      const extensions = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
      const extension = extensions[body.contentType];
      if (!protocolName || !deedName || !extension) { json(res, 400, { error: 'Indique el protocolo y un archivo PDF, Word, JPG o PNG.' }); return; }
      const encoded = String(body.data || '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) { json(res, 400, { error: 'El archivo no tiene un formato válido.' }); return; }
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) { json(res, 413, { error: 'Cada archivo debe pesar menos de 5 MB.' }); return; }
      data.archives ||= [];
      const id = crypto.randomUUID();
      const safeName = path.basename(String(body.name || deedName)).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'documento';
      const folder = path.join(ROOT, 'private-files', 'archive');
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, `${id}${extension}`);
      fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
      const entry = { id, protocolName, deedName, relativePath, name: safeName, contentType: body.contentType, diskPath: path.relative(ROOT, filePath), createdAt: new Date().toISOString(), uploadedBy: session.email };
      data.archives.push(entry);
      persist();
      json(res, 201, { ok: true, file: publicArchive(entry) });
      return;
    }
    if (url.pathname === '/api/archive/file' && req.method === 'GET') {
      if (!requireMember(req, res)) return;
      const file = (data.archives || []).find(item => item.id === url.searchParams.get('id'));
      if (!file) { json(res, 404, { error: 'No se encontró el archivo.' }); return; }
      const privateRoot = path.resolve(ROOT, 'private-files') + path.sep;
      const filePath = path.resolve(ROOT, file.diskPath);
      if (!filePath.startsWith(privateRoot) || !fs.existsSync(filePath)) { json(res, 404, { error: 'No se encontró el archivo.' }); return; }
      const safeName = file.name.replace(/["\\\r\n]/g, '_');
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${safeName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'No se encontró este servicio.' }); return; }

    const asset = publicFiles.get(url.pathname);
    if (!asset || req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(404); res.end('No encontrado'); return; }
    const filePath = path.join(ROOT, asset[0]);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('No se encontró el archivo.'); return; }
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': asset[0].endsWith('.png') ? 'public, max-age=3600' : 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = error.message === 'payload_too_large' ? 413 : 400;
    if (!res.headersSent) json(res, status, { error: status === 413 ? 'La solicitud es demasiado grande.' : 'No se pudo procesar la solicitud.' });
    else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Bufete Jurídico Fonseca disponible en http://localhost:${PORT}`));
