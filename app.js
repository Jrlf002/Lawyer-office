const BRAND_LOGO_KEY = 'office_brand_logo_gold_png_v2';
const $ = selector => document.querySelector(selector);
const adminDialog = $('#adminDialog');
const workspace = $('#workspace');
let contactSettings = { whatsapp: '', email: '', extraEmails: [] };
let recoveryPhone = '';
let authView = 'login';
let currentRole = null;
let isEnteringWorkspace = false;
let approvedCollaborators = [];
let lastContactFingerprint = '';
let loadedCases = [];

function createCaseFormChoices() {
  const fields = $('.case-fields');
  const matterLabel = document.createElement('label'); matterLabel.textContent = 'Tipo de trámite';
  const matterType = document.createElement('select'); matterType.id = 'caseMatterType';
  for (const [value, label] of [['general','General'],['sale','Compraventa'],['mancomunada','Mancomunada'],['company','Empresa']]) matterType.add(new Option(label, value));
  matterLabel.append(matterType);
  const bookLabel = document.createElement('label'); bookLabel.textContent = 'Protocolo notarial en trabajo';
  const bookInput = document.createElement('input'); bookInput.id = 'caseProtocolBook'; bookInput.placeholder = 'Seleccione o escriba el protocolo'; bookInput.setAttribute('list','protocolBookOptions');
  const bookOptions = document.createElement('datalist'); bookOptions.id = 'protocolBookOptions'; bookLabel.append(bookInput,bookOptions);
  fields.prepend(bookLabel); fields.prepend(matterLabel);
}
createCaseFormChoices();
$('#caseEmail')?.closest('label').remove();
const intakeNote = document.createElement('p'); intakeNote.className = 'case-intake-note';
intakeNote.textContent = 'Guarde el expediente primero; luego, en su tarjeta, adjunte la escritura, el protocolo y las fotos o documentos requeridos para el trámite.';
$('#caseForm').insertBefore(intakeNote, $('#caseForm').querySelector('button[type="submit"]'));

function addCaseSearch(container, id) {
  const wrap = document.createElement('label'); wrap.className = 'case-search'; wrap.textContent = 'Buscar escritura o protocolo';
  const input = document.createElement('input'); input.id = id; input.type = 'search'; input.placeholder = 'Número, referencia o cliente';
  input.addEventListener('input', () => renderCaseList());
  wrap.append(input); container.before(wrap);
}
addCaseSearch($('.case-list-heading'), 'ownerCaseSearch');
addCaseSearch($('#collaboratorCaseList'), 'collaboratorCaseSearch');
$('.security-note').textContent = 'Los usuarios con cuenta aprobada pueden buscar y consultar expedientes y adjuntos. Solo el administrador o el colaborador asignado pueden cambiar estados y datos principales.';

function showWorkspaceLoader() { $('#workspaceLoader').hidden = false; }
function hideWorkspaceLoader() { $('#workspaceLoader').hidden = true; }

$('#year').textContent = new Date().getFullYear();

document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.passwordToggle);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.classList.toggle('is-visible', show);
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  button.title = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
}));

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}

function buildArchiveWorkspace() {
  const openButton = document.createElement('button'); openButton.id = 'archiveOpen'; openButton.type = 'button'; openButton.className = 'button button-outline'; openButton.textContent = 'Archivo histórico';
  $('#workspaceLogout').before(openButton);
  const panel = document.createElement('section'); panel.id = 'archiveWorkspace'; panel.className = 'archive-workspace'; panel.hidden = true;
  panel.innerHTML = '<div class="archive-heading"><button id="archiveBack" class="button button-outline" type="button">Volver a expedientes</button><span class="eyebrow eyebrow-dark">BIBLIOTECA PRIVADA</span><h1>Archivo de protocolos anteriores</h1><p>Importe carpetas completas; se conservarán los nombres y subcarpetas para buscar las escrituras.</p></div><form id="archiveUploadForm" class="archive-upload-form"><label>Protocolo (opcional si el nombre está en las subcarpetas)<input id="archiveProtocolName" maxlength="180" placeholder="Ej. Protocolo 2022, tomo 1"></label><label class="folder-picker">Seleccionar carpeta de protocolos<input id="archiveFolderInput" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"></label><small>Se aceptan PDF, Word, JPG y PNG de hasta 5 MB por archivo. La importación puede tardar si la carpeta contiene muchos documentos.</small><button id="archiveUploadButton" class="button button-dark" type="submit">Importar carpeta</button><p id="archiveUploadMessage" class="form-message" role="status" aria-live="polite"></p></form><label class="case-search archive-search">Buscar protocolo o escritura<input id="archiveSearch" type="search" placeholder="Protocolo, nombre de escritura o carpeta"></label><div id="archiveFileList" class="archive-file-list"></div>';
  const folderInput = panel.querySelector('#archiveFolderInput'); folderInput.webkitdirectory = true; folderInput.directory = true;
  folderInput.setAttribute('webkitdirectory',''); folderInput.setAttribute('directory','');
  workspace.append(panel);
  openButton.addEventListener('click', () => {
    $('#ownerWorkspace').hidden = true; $('#collaboratorWorkspace').hidden = true; panel.hidden = false; loadArchive();
  });
  panel.querySelector('#archiveBack').addEventListener('click', () => {
    panel.hidden = true; $('#ownerWorkspace').hidden = currentRole !== 'owner'; $('#collaboratorWorkspace').hidden = currentRole !== 'collaborator';
  });
  panel.querySelector('#archiveSearch').addEventListener('input', renderArchiveList);
  $('#archiveUploadForm').addEventListener('submit', importArchiveFolder);
}
buildArchiveWorkspace();

function setContactState(message) { $('#contactNotice').textContent = message; }
function refreshContactLinks(settings) {
  contactSettings = settings;
  const whatsapp = $('#whatsappContact');
  const email = $('#emailContact');
  if (settings.whatsapp) {
    whatsapp.href = `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent('Hola, quisiera información sobre los servicios del Bufete Jurídico Fonseca.')}`;
    whatsapp.setAttribute('aria-disabled', 'false'); whatsapp.classList.remove('contact-disabled');
  } else {
    whatsapp.href = '#contacto'; whatsapp.setAttribute('aria-disabled', 'true'); whatsapp.classList.add('contact-disabled');
  }
  if (settings.email) {
    email.href = `mailto:${encodeURIComponent(settings.email).replace(/%40/gi, '@')}`;
    email.setAttribute('aria-disabled', 'false'); email.classList.remove('contact-disabled');
  } else {
    email.href = '#contacto'; email.setAttribute('aria-disabled', 'true'); email.classList.add('contact-disabled');
  }
  setContactState(settings.whatsapp || settings.email ? 'Complete el formulario y el administrador verá la consulta en el panel.' : 'El administrador debe configurar los canales de contacto.');
}
api('/api/public-settings').then(refreshContactLinks).catch(() => setContactState('Inicie el sitio con npm start para habilitar los canales de contacto.'));

function getContactData() {
  const form = $('#clientContactForm');
  if (!form.reportValidity()) return null;
  const values = Object.fromEntries(new FormData(form));
  values.consent = $('#clientConsent').checked;
  return values;
}
function formatContactMessage(data) {
  return `Consulta para Bufete Jurídico Fonseca\n\nNombre: ${data.name}\nTeléfono: ${data.phone}\nCorreo: ${data.email || 'No indicó'}\nAsunto: ${data.subject}\n\nInformación:\n${data.details}`;
}
async function saveContactRequest(data) {
  const fingerprint = JSON.stringify(data);
  if (fingerprint === lastContactFingerprint) return;
  await api('/api/contact-requests', { method: 'POST', body: JSON.stringify(data) });
  lastContactFingerprint = fingerprint;
}
$('#sendContactWhatsApp').addEventListener('click', async () => {
  const data = getContactData();
  if (!data) return;
  if (!contactSettings.whatsapp) { setContactState('WhatsApp todavía no está configurado.'); return; }
  const popup = window.open('about:blank', '_blank');
  setContactState('Guardando la consulta…');
  try {
    await saveContactRequest(data);
    const link = `https://wa.me/${contactSettings.whatsapp}?text=${encodeURIComponent(formatContactMessage(data))}`;
    if (popup) popup.location = link; else window.location.href = link;
    setContactState('La consulta quedó registrada. Revise WhatsApp y pulse Enviar.');
  } catch (error) { if (popup) popup.close(); setContactState(error.message); }
});
$('#sendContactEmail').addEventListener('click', async () => {
  const data = getContactData();
  if (!data) return;
  if (!contactSettings.email) { setContactState('El correo del bufete todavía no está configurado.'); return; }
  setContactState('Guardando la consulta…');
  try {
    await saveContactRequest(data);
    const query = new URLSearchParams({ subject: `Consulta: ${data.subject} — Bufete Jurídico Fonseca`, body: formatContactMessage(data) });
    if (contactSettings.extraEmails?.length) query.set('cc', contactSettings.extraEmails.join(','));
    window.location.href = `mailto:${encodeURIComponent(contactSettings.email).replace(/%40/gi, '@')}?${query}`;
    setContactState('La consulta quedó registrada. Revise el borrador y pulse Enviar.');
  } catch (error) { setContactState(error.message); }
});

function setAuthView(view) {
  authView = view;
  $('#adminLoginForm').hidden = view !== 'login';
  $('#collaboratorRegisterForm').hidden = view !== 'collaborator';
  $('#recoveryRequestForm').hidden = view !== 'recovery-request';
  $('#recoveryConfirmForm').hidden = view !== 'recovery-confirm';
  document.querySelectorAll('[data-auth-view]').forEach(button => button.classList.toggle('active', button.dataset.authView === view));
  $('#authMessage').textContent = '';
}
async function enterWorkspace(status) {
  if (isEnteringWorkspace) return;
  isEnteringWorkspace = true;
  const loadingStarted = Date.now();
  showWorkspaceLoader();
  currentRole = status.role;
  adminDialog.close();
  workspace.hidden = false;
  $('#archiveWorkspace').hidden = true;
  document.body.classList.add('dashboard-mode');
  $('#workspaceUser').textContent = `${status.name || ''} · ${status.role === 'owner' ? 'Administrador' : 'Colaborador'}`;
  $('#ownerWorkspace').hidden = status.role !== 'owner';
  $('#collaboratorWorkspace').hidden = status.role !== 'collaborator';
  if (status.role === 'collaborator') {
    $('#collaboratorWorkspace .workspace-heading h1').textContent = 'Expedientes compartidos';
    $('#collaboratorWorkspace .workspace-heading p').textContent = 'Puede consultar y adjuntar documentos a los expedientes; solo puede editar estados en los asuntos que tiene asignados.';
  }
  try {
    if (status.role === 'owner') {
      setDashboardTab('cases');
      await loadSettings();
      await loadCollaborators();
      await loadCases();
      await loadClientRequests();
    } else {
      await loadCases();
    }
  } finally {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 550 - (Date.now() - loadingStarted))));
    hideWorkspaceLoader();
    isEnteringWorkspace = false;
  }
}

$('#adminOpen').addEventListener('click', async () => {
  try {
    const status = await api('/api/status');
    if (status.authenticated) { await enterWorkspace(status); return; }
    $('#authMessage').textContent = '';
    adminDialog.showModal();
    $('#adminAuth').hidden = false;
    $('#adminSetupForm').hidden = !status.setupRequired;
    $('.auth-tabs').hidden = status.setupRequired;
    if (status.setupRequired) {
      $('#adminLoginForm').hidden = true;
      $('#collaboratorRegisterForm').hidden = true;
    } else setAuthView(authView);
  } catch { adminDialog.showModal(); $('#authMessage').textContent = 'No se pudo conectar. Inicie el servidor con npm start.'; }
});
api('/api/status').then(status => { if (status.authenticated) enterWorkspace(status); }).catch(() => {});
$('#adminClose').addEventListener('click', () => adminDialog.close());
adminDialog.addEventListener('click', event => { if (event.target === adminDialog) adminDialog.close(); });
document.querySelectorAll('[data-auth-view]').forEach(button => button.addEventListener('click', () => setAuthView(button.dataset.authView)));
$('#forgotPasswordButton').addEventListener('click', () => setAuthView('recovery-request'));
document.querySelectorAll('.back-to-login').forEach(button => button.addEventListener('click', () => setAuthView('login')));

$('#adminSetupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#setupName').value.trim();
  $('#authMessage').textContent = 'Activando la cuenta única del dueño…';
  try {
    await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ setupCode: $('#setupCode').value.trim(), name, email: $('#setupEmail').value.trim(), phone: $('#setupPhone').value.trim(), password: $('#setupPassword').value }) });
    event.currentTarget.reset();
    await enterWorkspace({ role: 'owner', name });
  } catch (error) { $('#authMessage').textContent = error.message; }
});
$('#adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#authMessage').textContent = 'Iniciando sesión…';
  try {
    const status = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: $('#adminEmail').value.trim(), password: $('#adminPassword').value }) });
    event.currentTarget.reset();
    await enterWorkspace(status);
  } catch (error) { $('#authMessage').textContent = error.message; }
});
$('#collaboratorRegisterForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#authMessage').textContent = 'Enviando solicitud de acceso…';
  try {
    const result = await api('/api/collaborators/register', { method: 'POST', body: JSON.stringify({ name: $('#collaboratorName').value.trim(), email: $('#collaboratorEmail').value.trim(), phone: $('#collaboratorPhone').value.trim(), password: $('#collaboratorPassword').value }) });
    event.currentTarget.reset(); setAuthView('login'); $('#authMessage').textContent = result.message;
  } catch (error) { $('#authMessage').textContent = error.message; }
});
$('#recoveryRequestForm').addEventListener('submit', async event => {
  event.preventDefault(); recoveryPhone = $('#recoveryPhone').value.trim(); $('#authMessage').textContent = 'Solicitando código por SMS…';
  try {
    const result = await api('/api/recovery/request', { method: 'POST', body: JSON.stringify({ phone: recoveryPhone }) });
    $('#recoveryRequestForm').hidden = true; $('#recoveryConfirmForm').hidden = false; $('#authMessage').textContent = result.message;
  } catch (error) { $('#authMessage').textContent = error.message; }
});
$('#recoveryConfirmForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#authMessage').textContent = 'Verificando código…';
  try {
    const result = await api('/api/recovery/confirm', { method: 'POST', body: JSON.stringify({ phone: recoveryPhone, code: $('#recoveryCode').value.trim(), password: $('#recoveryPassword').value }) });
    event.currentTarget.reset(); $('#adminEmail').value = result.email; setAuthView('login'); $('#authMessage').textContent = result.message;
  } catch (error) { $('#authMessage').textContent = error.message; }
});

async function logout() {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch {}
  currentRole = null; workspace.hidden = true; $('#archiveWorkspace').hidden = true; document.body.classList.remove('dashboard-mode');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#workspaceLogout').addEventListener('click', logout);

function setDashboardTab(name, animate = false) {
  if (animate) showWorkspaceLoader();
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.classList.toggle('active', button.dataset.dashboardTab === name));
  document.querySelectorAll('.dashboard-pane').forEach(pane => { pane.hidden = pane.id !== `owner${name[0].toUpperCase()}${name.slice(1)}Pane`; });
  if (animate) setTimeout(hideWorkspaceLoader, 480);
}
document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.addEventListener('click', () => setDashboardTab(button.dataset.dashboardTab, true)));

function statusOptions(select, values, current) {
  select.replaceChildren();
  for (const [value, label] of values) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = value === current; select.append(option);
  }
}
const docStatuses = [['pending','Pendiente'],['in_progress','En preparación'],['ready','Listo para entregar'],['delivered','Entregado']];
const signatureStatuses = [['pending','Pendiente'],['scheduled','Programada'],['signed','Firmada'],['delivered','Entregada']];
function updateMetrics(records, prefix = '') {
  const set = (id, value) => { const element = $(id); if (element) element.textContent = value; };
  set(prefix ? '#collabMetricCases' : '#metricCases', records.length);
  set(prefix ? '#collabMetricDeeds' : '#metricDeeds', records.filter(item => item.deedStatus !== 'delivered').length);
  set(prefix ? '#collabMetricProtocols' : '#metricProtocols', records.filter(item => item.protocolStatus !== 'delivered').length);
  set(prefix ? '#collabMetricSignatures' : '#metricSignatures', records.filter(item => item.signatureStatus !== 'delivered').length);
}

function documentCategories(type) {
  const base = [['deed','Escritura'],['protocol','Protocolo'],['other','Otro documento']];
  if (type === 'sale') return [['buyer_id_front','C\u00e9dula comprador \u00b7 frente'],['buyer_id_back','C\u00e9dula comprador \u00b7 reverso'],['seller_id_front','C\u00e9dula vendedor \u00b7 frente'],['seller_id_back','C\u00e9dula vendedor \u00b7 reverso'],['circulation_front','Circulaci\u00f3n \u00b7 frente'],['circulation_back','Circulaci\u00f3n \u00b7 reverso'],...base];
  if (type === 'mancomunada') return [['cedula_front','C\u00e9dula titular \u00b7 frente'],['cedula_back','C\u00e9dula titular \u00b7 reverso'],['coowner_id_front','C\u00e9dula adicional \u00b7 frente'],['coowner_id_back','C\u00e9dula adicional \u00b7 reverso'],...base];
  if (type === 'company') return [['company_ruc','C\u00e9dula RUC de la empresa'],['attorney_id_front','C\u00e9dula apoderado \u00b7 frente'],['attorney_id_back','C\u00e9dula apoderado \u00b7 reverso'],...base];
  return [['cedula_front','C\u00e9dula cliente \u00b7 frente'],['cedula_back','C\u00e9dula cliente \u00b7 reverso'],...base];
}
const imageOnlyKinds = new Set(['cedula_front','cedula_back','buyer_id_front','buyer_id_back','seller_id_front','seller_id_back','circulation_front','circulation_back','coowner_id_front','coowner_id_back','company_ruc','attorney_id_front','attorney_id_back']);
async function prepareUpload(file) {
  const supportedImage = file.type === 'image/jpeg' || file.type === 'image/png';
  if (!file.type.startsWith('image/') || supportedImage && file.size <= 4.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxSide of [1800, 1400, 1100]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (blob && blob.size <= 4.5 * 1024 * 1024) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    }
  } finally { bitmap.close?.(); }
  return file;
}
function renderCaseList() {
  const owner = currentRole === 'owner';
  const list = $(owner ? '#caseList' : '#collaboratorCaseList');
  if (!list) return;
  const bookOptions = $('#protocolBookOptions');
  if (bookOptions) {
    bookOptions.replaceChildren();
    [...new Set(loadedCases.map(record => record.protocolBook).filter(Boolean))].forEach(value => bookOptions.add(new Option(value,value)));
  }
  const search = (owner ? $('#ownerCaseSearch') : $('#collaboratorCaseSearch'))?.value || '';
  const needle = search.trim().toLocaleLowerCase();
  const records = loadedCases.filter(record => !needle || [record.clientName,record.deedReference,record.protocolReference,record.protocolBook].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state';
    empty.textContent = loadedCases.length ? 'No hay resultados para esa b\u00fasqueda.' : 'Todav\u00eda no hay expedientes.';
    list.append(empty); return;
  }
  records.forEach(record => list.append(createCaseCard(record, owner)));
}
function createCaseCard(record, owner) {
  const card = document.createElement('article'); card.className = 'case-card';
  const header = document.createElement('div'); header.className = 'case-card-header';
  const title = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = record.clientName;
  const identity = document.createElement('p'); identity.textContent = 'C\u00e9dula: ' + record.cedula + ' \u00b7 Tel\u00e9fono: ' + record.phone;
  title.append(name, identity); header.append(title);
  const meta = document.createElement('div'); meta.className = 'case-meta';
  const deed = document.createElement('p'); deed.textContent = 'Escritura: ' + (record.deedReference || 'Sin referencia');
  const protocol = document.createElement('p'); protocol.textContent = 'Protocolo: ' + (record.protocolReference || 'Sin referencia');
  const book = document.createElement('p'); book.textContent = 'Protocolo en trabajo: ' + (record.protocolBook || 'Sin seleccionar');
  const types = { general:'General', sale:'Compraventa', mancomunada:'Mancomunada', company:'Empresa' };
  const matter = document.createElement('p'); matter.textContent = 'Tr\u00e1mite: ' + (types[record.matterType] || types.general);
  meta.append(deed, protocol, book, matter);
  const documents = document.createElement('div'); documents.className = 'case-files';
  const documentsTitle = document.createElement('strong'); documentsTitle.textContent = 'Archivos del expediente'; documents.append(documentsTitle);
  const fileList = document.createElement('div'); fileList.className = 'case-file-list';
  const names = Object.fromEntries(documentCategories(record.matterType)); names.cedula = 'C\u00e9dula';
  for (const file of record.files || []) {
    const link = document.createElement('a');
    link.href = '/api/cases/file?' + new URLSearchParams({ caseId: record.id, fileId: file.id });
    link.textContent = (names[file.kind] || 'Documento') + ' \u00b7 ' + file.name;
    fileList.append(link);
  }
  if (!(record.files || []).length) { const empty = document.createElement('small'); empty.textContent = 'A\u00fan no hay documentos adjuntos.'; fileList.append(empty); }
  documents.append(fileList);
  const uploadControls = document.createElement('div'); uploadControls.className = 'case-upload-controls';
  const kindSelect = document.createElement('select'); kindSelect.setAttribute('aria-label', 'Categor\u00eda del documento');
  for (const [value,label] of documentCategories(record.matterType)) kindSelect.add(new Option(label,value));
  const acceptedFiles = ['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.pdf,.doc,.docx,image/jpeg,image/png'; fileInput.setAttribute('aria-label','Seleccionar archivo o tomar fotograf\u00eda');
  const updateCaptureMode = () => {
    const isPhoto = imageOnlyKinds.has(kindSelect.value);
    fileInput.accept = isPhoto ? 'image/*' : '.pdf,.doc,.docx,image/jpeg,image/png';
    if (isPhoto) fileInput.setAttribute('capture','environment'); else fileInput.removeAttribute('capture');
  };
  kindSelect.addEventListener('change', updateCaptureMode); updateCaptureMode();
  const uploadButton = document.createElement('button'); uploadButton.type = 'button'; uploadButton.className = 'button button-outline'; uploadButton.textContent = 'Tomar foto o elegir archivo';
  fileInput.addEventListener('change', () => { uploadButton.textContent = fileInput.files?.length ? 'Adjuntar archivo' : 'Tomar foto o elegir archivo'; });
  const uploadMessage = document.createElement('small'); uploadMessage.setAttribute('role','status');
  uploadButton.addEventListener('click', async () => {
    let file = fileInput.files?.[0];
    if (!file) { fileInput.click(); return; }
    const photoOnly = imageOnlyKinds.has(kindSelect.value);
    if (photoOnly && !file.type.startsWith('image/')) { uploadMessage.textContent = 'Para esta categor\u00eda, adjunte una fotograf\u00eda JPG o PNG.'; return; }
    if (file.type.startsWith('image/') && (file.size > 4.5 * 1024 * 1024 || !['image/jpeg','image/png'].includes(file.type))) {
      uploadButton.disabled = true; uploadMessage.textContent = 'Optimizando fotografía…';
      try { file = await prepareUpload(file); } catch { uploadButton.disabled = false; uploadMessage.textContent = 'No se pudo procesar la fotografía.'; return; }
    }
    if (!acceptedFiles.includes(file.type) || file.size > 5 * 1024 * 1024) { uploadButton.disabled = false; uploadMessage.textContent = 'Use Word, PDF, JPG o PNG de hasta 5 MB.'; return; }
    uploadButton.disabled = true; uploadMessage.textContent = 'Subiendo documento\u2026';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await api('/api/cases/files', { method: 'POST', body: JSON.stringify({ caseId: record.id, kind: kindSelect.value, name: file.name, contentType: file.type, data: btoa(binary) }) });
      await loadCases();
    } catch (error) { uploadMessage.textContent = error.message; uploadButton.disabled = false; }
  });
  const cameraHint = document.createElement('small'); cameraHint.className = 'upload-hint'; cameraHint.textContent = 'En celular, elija una categor\u00eda de foto y se abrir\u00e1 la c\u00e1mara o galer\u00eda.';
  uploadControls.append(kindSelect,fileInput,uploadButton,uploadMessage,cameraHint); documents.append(uploadControls);
  const canEdit = owner || record.canEdit;
  let statuses = document.createElement('div'); statuses.className = 'case-status-grid';
  const controls = {};
  const addSelect = (key,label,values,value) => {
    const wrap = document.createElement('label'); wrap.textContent = label;
    const select = document.createElement('select'); statusOptions(select,values,value); wrap.append(select); statuses.append(wrap); controls[key] = select;
  };
  addSelect('deedStatus','Estado de escritura',docStatuses,record.deedStatus);
  addSelect('protocolStatus','Estado de protocolo',docStatuses,record.protocolStatus);
  addSelect('signatureStatus','Firma',signatureStatuses,record.signatureStatus);
  const notesWrap = document.createElement('label'); notesWrap.className = 'case-notes'; notesWrap.textContent = 'Notas de seguimiento';
  const notes = document.createElement('textarea'); notes.rows = 2; notes.value = record.notes || ''; notesWrap.append(notes);
  const footer = document.createElement('div'); footer.className = 'case-card-footer';
  const updated = document.createElement('small'); updated.textContent = 'Actualizado ' + new Date(record.updatedAt).toLocaleString('es');
  if (owner) {
    const assignWrap = document.createElement('label'); assignWrap.className = 'case-assignee'; assignWrap.textContent = 'Colaborador';
    const assign = document.createElement('select');
    const unassigned = document.createElement('option'); unassigned.value = ''; unassigned.textContent = 'Sin asignar'; assign.append(unassigned);
    for (const person of approvedCollaborators) { const option = document.createElement('option'); option.value = person.email; option.textContent = person.name; option.selected = record.assignedTo === person.email; assign.append(option); }
    assignWrap.append(assign); controls.assignedTo = assign; footer.append(assignWrap);
  }
  if (canEdit) {
    const saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'button button-dark'; saveButton.textContent = 'Guardar actualizaci\u00f3n'; saveButton.style.padding = '9px 12px';
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true; saveButton.textContent = 'Guardando\u2026';
      const payload = { id: record.id, deedStatus: controls.deedStatus.value, protocolStatus: controls.protocolStatus.value, signatureStatus: controls.signatureStatus.value, notes: notes.value };
      if (owner) Object.assign(payload, { clientName: record.clientName, cedula: record.cedula, phone: record.phone, deedReference: record.deedReference, protocolReference: record.protocolReference, protocolBook: record.protocolBook || '', matterType: record.matterType || 'general', assignedTo: controls.assignedTo.value });
      try { await api('/api/cases/update', { method: 'POST', body: JSON.stringify(payload) }); await loadCases(); }
      catch (error) { saveButton.disabled = false; saveButton.textContent = error.message; }
    });
    footer.append(updated, saveButton);
    card.append(header, meta, documents, statuses, notesWrap, footer);
  } else {
    const readOnly = document.createElement('small'); readOnly.textContent = 'Solo el administrador o colaborador asignado puede editar este expediente.';
    footer.append(updated, readOnly); card.append(header, meta, documents, footer);
  }
  return card;
}
async function loadCases() {
  const owner = currentRole === 'owner';
  try {
    loadedCases = await api('/api/cases');
    updateMetrics(loadedCases, owner ? '' : 'collab');
    if (owner && $('#caseListCount')) $('#caseListCount').textContent = loadedCases.length;
    renderCaseList();
  } catch (error) { setContactState(error.message); }
}
function readCaseForm() {
  return {
    clientName: $('#caseClientName').value.trim(), cedula: $('#caseCedula').value.trim(), phone: $('#casePhone').value.trim(),
    deedReference: $('#caseDeedReference').value.trim(), protocolReference: $('#caseProtocolReference').value.trim(), protocolBook: $('#caseProtocolBook').value.trim(), matterType: $('#caseMatterType').value, assignedTo: $('#caseAssignedTo').value,
    deedStatus: $('#caseDeedStatus').value, protocolStatus: $('#caseProtocolStatus').value, signatureStatus: $('#caseSignatureStatus').value, notes: $('#caseNotes').value.trim()
  };
}
$('#caseForm').addEventListener('submit', async event => {
  event.preventDefault(); const message = $('#caseFormMessage'); message.textContent = 'Guardando expediente\u2026';
  try { await api('/api/cases', { method: 'POST', body: JSON.stringify(readCaseForm()) }); event.currentTarget.reset(); message.textContent = 'Expediente guardado.'; await loadCases(); }
  catch (error) { message.textContent = error.message; }
});

let loadedArchive = [];
function renderArchiveList() {
  const list = $('#archiveFileList');
  const needle = $('#archiveSearch').value.trim().toLocaleLowerCase();
  const entries = loadedArchive.filter(item => !needle || [item.protocolName,item.deedName,item.name,item.relativePath].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'empty-state';
    empty.textContent = loadedArchive.length ? 'No hay resultados para esa b\u00fasqueda.' : 'Todav\u00eda no se han importado escrituras hist\u00f3ricas.';
    list.append(empty); return;
  }
  for (const item of entries) {
    const row = document.createElement('article'); row.className = 'archive-file-row';
    const details = document.createElement('div');
    const protocol = document.createElement('strong'); protocol.textContent = item.protocolName;
    const deed = document.createElement('p'); deed.textContent = item.deedName || item.name;
    const pathLabel = document.createElement('small'); pathLabel.textContent = item.relativePath || 'Carpeta principal';
    details.append(protocol,deed,pathLabel);
    const link = document.createElement('a'); link.className = 'button button-outline'; link.href = '/api/archive/file?' + new URLSearchParams({ id: item.id }); link.textContent = 'Descargar ' + item.name;
    row.append(details,link); list.append(row);
  }
}
async function loadArchive() {
  try { loadedArchive = await api('/api/archive'); renderArchiveList(); }
  catch (error) { $('#archiveFileList').textContent = error.message; }
}
async function importArchiveFolder(event) {
  event.preventDefault();
  const files = Array.from($('#archiveFolderInput').files || []);
  const message = $('#archiveUploadMessage'); const button = $('#archiveUploadButton');
  if (!files.length) { message.textContent = 'Seleccione una carpeta con sus escrituras.'; return; }
  button.disabled = true; let uploaded = 0; let skipped = 0; const failures = [];
  const types = { pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png' };
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const parts = (file.webkitRelativePath || file.name).replace(/\\/g,'/').split('/').filter(Boolean);
    const folders = parts.slice(0,-1);
    const protocolName = $('#archiveProtocolName').value.trim() || folders[1] || folders[0] || 'Protocolo sin nombre';
    const extension = file.name.split('.').pop().toLowerCase();
    const contentType = types[extension] || file.type;
    if (!types[extension] || !contentType || file.size > 5 * 1024 * 1024) { skipped++; continue; }
    message.textContent = 'Importando ' + (index + 1) + ' de ' + files.length + ': ' + file.name;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      await api('/api/archive/files', { method: 'POST', body: JSON.stringify({ protocolName, deedName: file.name.replace(/\.[^.]+$/, ''), relativePath: folders.slice(1).join('/'), name: file.name, contentType, data: btoa(binary) }) });
      uploaded++;
    } catch (error) { failures.push(file.name + ': ' + error.message); }
  }
  $('#archiveFolderInput').value = ''; button.disabled = false;
  message.textContent = 'Importados ' + uploaded + ' de ' + files.length + (skipped ? '; omitidos por tipo o tama\u00f1o: ' + skipped : '') + (failures.length ? '; errores: ' + failures.length + ' (' + failures.slice(0,2).join(' \u00b7 ') + ')' : '');
  await loadArchive();
}
function splitList(value) { return value.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean).slice(0, 3); }
async function loadSettings() {
  try {
    const settings = await api('/api/admin/settings');
    $('#officeWhatsapp').value = settings.whatsapp || ''; $('#officeEmail').value = settings.email || '';
    $('#extraWhatsapp').value = (settings.extraWhatsapp || []).join(', '); $('#extraEmails').value = (settings.extraEmails || []).join(', ');
    $('#ownerRecoveryPhone').value = settings.ownerRecoveryPhone || '';
  } catch (error) { $('#contactSaveMessage').textContent = error.message; }
}
$('#officeContactForm').addEventListener('submit', async event => {
  event.preventDefault(); const message = $('#contactSaveMessage'); message.textContent = 'Guardando…';
  const settings = { whatsapp: $('#officeWhatsapp').value, email: $('#officeEmail').value, extraWhatsapp: splitList($('#extraWhatsapp').value), extraEmails: splitList($('#extraEmails').value), ownerRecoveryPhone: $('#ownerRecoveryPhone').value };
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(settings) }); refreshContactLinks(await api('/api/public-settings')); message.textContent = 'Contactos guardados.'; }
  catch (error) { message.textContent = error.message; }
});

async function loadCollaborators() {
  const list = $('#workspaceCollaborators');
  try {
    const people = await api('/api/admin/collaborators'); approvedCollaborators = people.filter(person => person.status === 'approved');
    $('#pendingCount').textContent = people.filter(person => person.status === 'pending').length;
    const assignee = $('#caseAssignedTo');
    const selected = assignee.value;
    assignee.replaceChildren(new Option('Sin asignar', ''));
    approvedCollaborators.forEach(person => assignee.add(new Option(person.name, person.email)));
    if (approvedCollaborators.some(person => person.email === selected)) assignee.value = selected;
    list.replaceChildren();
    if (!people.length) { list.innerHTML = '<p class="empty-state">Todavía no hay cuentas de colaboradores.</p>'; return; }
    for (const person of people) {
      const row = document.createElement('article'); row.className = 'collaborator-row';
      const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = person.name;
      const detail = document.createElement('p'); detail.textContent = `${person.email} · ${person.phone} · ${({pending:'Pendiente',approved:'Aprobado',rejected:'Sin acceso'})[person.status]}`;
      const date = document.createElement('small'); date.textContent = 'Solicitud: ' + new Date(person.createdAt).toLocaleString('es');
      const lastLogin = document.createElement('small'); lastLogin.className = 'collaborator-last-login'; lastLogin.textContent = person.lastLoginAt ? 'Última conexión: ' + new Date(person.lastLoginAt).toLocaleString('es') : 'Última conexión: Sin registros';
      info.append(name, detail, date, lastLogin);
      const actions = document.createElement('div'); actions.className = 'collaborator-actions';
      const options = person.status === 'pending' ? [['approved','Aprobar'],['rejected','Rechazar']] : person.status === 'approved' ? [['rejected','Quitar acceso']] : [['pending','Revisar de nuevo']];
      for (const [status,label] of options) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', async () => { button.disabled = true; try { await api('/api/admin/collaborators/review',{method:'POST',body:JSON.stringify({id:person.id,status})}); await loadCollaborators(); await loadCases(); } catch (error) { button.disabled=false; $('#contactSaveMessage').textContent=error.message; } }); actions.append(button); }
      row.append(info,actions); list.append(row);
    }
  } catch (error) { list.textContent = error.message; }
}

async function loadClientRequests() {
  const list = $('#ownerRequestList');
  try {
    const requests = await api('/api/requests'); list.replaceChildren();
    if (!requests.length) { list.innerHTML = '<p class="empty-state">Todavía no hay consultas recibidas.</p>'; return; }
    for (const request of requests) {
      const card = document.createElement('article'); card.className = 'owner-request-card';
      const name = document.createElement('strong'); name.textContent = request.name;
      const details = document.createElement('p'); details.textContent = `${request.subject} · ${request.phone} · ${request.email || 'Sin correo'}`;
      const description = document.createElement('p'); description.textContent = request.details;
      const date = document.createElement('small'); date.textContent = `${new Date(request.createdAt).toLocaleString('es')} · Estado: ${({new:'Nueva',contacted:'Contactado',in_progress:'En seguimiento',closed:'Cerrada'})[request.status]}`;
      const select = document.createElement('select'); select.setAttribute('aria-label','Estado de consulta');
      for (const [value,label] of [['new','Nueva'],['contacted','Contactado'],['in_progress','En seguimiento'],['closed','Cerrada']]) select.add(new Option(label,value));
      select.value = request.status;
      select.addEventListener('change', async () => { try { await api('/api/requests/status',{method:'POST',body:JSON.stringify({id:request.id,status:select.value})}); await loadClientRequests(); } catch (error) { setContactState(error.message); } });
      card.append(name,details,description,date,select); list.append(card);
    }
  } catch (error) { list.textContent = error.message; }
}

const savedBrandLogo = localStorage.getItem(BRAND_LOGO_KEY);
if (savedBrandLogo) document.querySelectorAll('[data-brand-symbol]').forEach(img => { img.src = savedBrandLogo; img.style.display = 'block'; });
if (savedBrandLogo) { $('#downloadBrandLogo').href = savedBrandLogo; $('#downloadBrandLogo').hidden = false; }
function paintBrandLogo(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0);
      const pixels = context.getImageData(0,0,canvas.width,canvas.height);
      const stops = [[0,153,115,52],[.22,212,180,93],[.38,255,240,179],[.56,167,125,50],[.73,247,226,154],[.88,135,101,43],[1,229,201,118]];
      for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4; const alpha=Math.max(0,Math.min(255,(255-Math.min(pixels.data[i],pixels.data[i+1],pixels.data[i+2])-12)*1.5))*(pixels.data[i+3]/255); const position=x/Math.max(1,canvas.width-1);
        let left=stops[0],right=stops[stops.length-1]; for(let j=0;j<stops.length-1;j++) if(position>=stops[j][0]&&position<=stops[j+1][0]){left=stops[j];right=stops[j+1];break;}
        const amount=(position-left[0])/(right[0]-left[0]); for(let channel=0;channel<3;channel++) pixels.data[i+channel]=Math.round(left[channel+1]+(right[channel+1]-left[channel+1])*amount); pixels.data[i+3]=Math.round(alpha);
      }
      context.putImageData(pixels,0,0); resolve(canvas.toDataURL('image/png'));
    };
    image.onerror=reject; image.src=source;
  });
}
$('#brandLogoInput').addEventListener('change',async event=>{
  const file=event.target.files?.[0]; const status=$('#brandLogoStatus'); if(!file)return;
  if(file.type!=='image/png'){status.textContent='Seleccione un archivo PNG.';return;} status.textContent='Procesando imagen…';
  try{const url=URL.createObjectURL(file);let result;try{result=await paintBrandLogo(url);}finally{URL.revokeObjectURL(url);}localStorage.setItem(BRAND_LOGO_KEY,result);document.querySelectorAll('[data-brand-symbol]').forEach(img=>{img.src=result;img.style.display='block';});$('#downloadBrandLogo').href=result;$('#downloadBrandLogo').hidden=false;status.textContent='Símbolo actualizado.';}catch{status.textContent='No se pudo procesar la imagen.';}
});
$('#removeBrandLogo').addEventListener('click',()=>{localStorage.removeItem(BRAND_LOGO_KEY);document.querySelectorAll('[data-brand-symbol]').forEach(img=>{img.src='logo-dorado.png';img.style.display='block';});$('#downloadBrandLogo').removeAttribute('href');$('#downloadBrandLogo').hidden=true;$('#brandLogoStatus').textContent='Se restauró el símbolo del proyecto.';});
