const BRAND_LOGO_KEY = 'office_brand_logo_gold_png_v2';
const $ = selector => document.querySelector(selector);
const adminDialog = $('#adminDialog');
const workspace = $('#workspace');
let contactSettings = { whatsapp: '', email: '', extraEmails: [] };
let recoveryPhone = '';
let authView = 'login';
let currentRole = null;
let approvedCollaborators = [];
let lastContactFingerprint = '';

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
  currentRole = status.role;
  adminDialog.close();
  workspace.hidden = false;
  document.body.classList.add('dashboard-mode');
  $('#workspaceUser').textContent = `${status.name || ''} · ${status.role === 'owner' ? 'Administrador' : 'Colaborador'}`;
  $('#ownerWorkspace').hidden = status.role !== 'owner';
  $('#collaboratorWorkspace').hidden = status.role !== 'collaborator';
  if (status.role === 'owner') {
    setDashboardTab('cases');
    await loadSettings();
    await loadCollaborators();
    await loadCases();
    await loadClientRequests();
  } else {
    await loadCases();
  }
}

$('#adminOpen').addEventListener('click', async () => {
  $('#authMessage').textContent = 'Comprobando acceso…';
  adminDialog.showModal();
  try {
    const status = await api('/api/status');
    if (status.authenticated) { await enterWorkspace(status); return; }
    $('#adminAuth').hidden = false;
    $('#adminSetupForm').hidden = !status.setupRequired;
    $('.auth-tabs').hidden = status.setupRequired;
    if (status.setupRequired) {
      $('#adminLoginForm').hidden = true;
      $('#collaboratorRegisterForm').hidden = true;
    } else setAuthView(authView);
  } catch { $('#authMessage').textContent = 'No se pudo conectar. Inicie el servidor con npm start.'; }
});
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
  currentRole = null; workspace.hidden = true; document.body.classList.remove('dashboard-mode');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#workspaceLogout').addEventListener('click', logout);

function setDashboardTab(name) {
  document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.classList.toggle('active', button.dataset.dashboardTab === name));
  document.querySelectorAll('.dashboard-pane').forEach(pane => { pane.hidden = pane.id !== `owner${name[0].toUpperCase()}${name.slice(1)}Pane`; });
}
document.querySelectorAll('[data-dashboard-tab]').forEach(button => button.addEventListener('click', () => setDashboardTab(button.dataset.dashboardTab)));

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
function createCaseCard(record, owner) {
  const card = document.createElement('article'); card.className = 'case-card';
  const header = document.createElement('div'); header.className = 'case-card-header';
  const title = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = record.clientName;
  const identity = document.createElement('p'); identity.textContent = `Cédula: ${record.cedula} · Teléfono: ${record.phone}`;
  const email = document.createElement('p'); email.textContent = record.email || 'Sin correo del cliente';
  title.append(name, identity, email); header.append(title);
  const meta = document.createElement('div'); meta.className = 'case-meta';
  const deed = document.createElement('p'); deed.textContent = `Escritura: ${record.deedReference || 'Sin referencia'}`;
  const protocol = document.createElement('p'); protocol.textContent = `Protocolo: ${record.protocolReference || 'Sin referencia'}`;
  meta.append(deed, protocol);
  const documents = document.createElement('div'); documents.className = 'case-files';
  const documentsTitle = document.createElement('strong'); documentsTitle.textContent = 'Archivos del expediente'; documents.append(documentsTitle);
  const fileList = document.createElement('div'); fileList.className = 'case-file-list';
  const kindNames = { cedula: 'Cédula', deed: 'Escritura', protocol: 'Protocolo' };
  for (const file of record.files || []) {
    const link = document.createElement('a');
    link.href = `/api/cases/file?${new URLSearchParams({ caseId: record.id, fileId: file.id })}`;
    link.textContent = `${kindNames[file.kind] || 'Documento'} · ${file.name}`;
    fileList.append(link);
  }
  if (!(record.files || []).length) { const empty = document.createElement('small'); empty.textContent = 'Aún no hay documentos adjuntos.'; fileList.append(empty); }
  documents.append(fileList);
  const uploadControls = document.createElement('div'); uploadControls.className = 'case-upload-controls';
  const kindSelect = document.createElement('select'); kindSelect.setAttribute('aria-label', 'Categoría del documento');
  for (const [value, label] of [['cedula','Cédula'],['deed','Escritura'],['protocol','Protocolo']]) kindSelect.add(new Option(label,value));
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'application/pdf,image/jpeg,image/png'; fileInput.setAttribute('aria-label','Seleccionar PDF, JPG o PNG');
  const uploadButton = document.createElement('button'); uploadButton.type = 'button'; uploadButton.className = 'button button-outline'; uploadButton.textContent = 'Adjuntar archivo';
  const uploadMessage = document.createElement('small'); uploadMessage.setAttribute('role','status');
  uploadButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) { uploadMessage.textContent = 'Seleccione un archivo.'; return; }
    if (!['application/pdf','image/jpeg','image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) { uploadMessage.textContent = 'Use un PDF, JPG o PNG de hasta 5 MB.'; return; }
    uploadButton.disabled = true; uploadMessage.textContent = 'Subiendo documento…';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await api('/api/cases/files', { method: 'POST', body: JSON.stringify({ caseId: record.id, kind: kindSelect.value, name: file.name, contentType: file.type, data: btoa(binary) }) });
      await loadCases();
    } catch (error) { uploadMessage.textContent = error.message; uploadButton.disabled = false; }
  });
  uploadControls.append(kindSelect,fileInput,uploadButton,uploadMessage); documents.append(uploadControls);
  const statuses = document.createElement('div'); statuses.className = 'case-status-grid';
  const controls = {};
  const addSelect = (key, label, values, value) => {
    const wrap = document.createElement('label'); wrap.textContent = label;
    const select = document.createElement('select'); statusOptions(select, values, value); wrap.append(select); statuses.append(wrap); controls[key] = select;
  };
  addSelect('deedStatus','Escritura',docStatuses,record.deedStatus);
  addSelect('protocolStatus','Protocolo',docStatuses,record.protocolStatus);
  addSelect('signatureStatus','Firma',signatureStatuses,record.signatureStatus);
  const notesWrap = document.createElement('label'); notesWrap.className = 'case-notes'; notesWrap.textContent = 'Notas de seguimiento';
  const notes = document.createElement('textarea'); notes.rows = 2; notes.value = record.notes || ''; notesWrap.append(notes);
  const footer = document.createElement('div'); footer.className = 'case-card-footer';
  const updated = document.createElement('small'); updated.textContent = `Actualizado ${new Date(record.updatedAt).toLocaleString('es')}`;
  const saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'button button-dark'; saveButton.textContent = 'Guardar actualización'; saveButton.style.padding = '9px 12px';
  if (owner) {
    const assignWrap = document.createElement('label'); assignWrap.className = 'case-assignee'; assignWrap.textContent = 'Colaborador';
    const assign = document.createElement('select');
    const unassigned = document.createElement('option'); unassigned.value = ''; unassigned.textContent = 'Sin asignar'; assign.append(unassigned);
    for (const person of approvedCollaborators) { const option = document.createElement('option'); option.value = person.email; option.textContent = person.name; option.selected = record.assignedTo === person.email; assign.append(option); }
    assignWrap.append(assign); controls.assignedTo = assign; footer.append(assignWrap);
  }
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true; saveButton.textContent = 'Guardando…';
    const payload = { id: record.id, deedStatus: controls.deedStatus.value, protocolStatus: controls.protocolStatus.value, signatureStatus: controls.signatureStatus.value, notes: notes.value };
    if (owner) Object.assign(payload, { clientName: record.clientName, cedula: record.cedula, phone: record.phone, email: record.email, deedReference: record.deedReference, protocolReference: record.protocolReference, assignedTo: controls.assignedTo.value });
    try { await api('/api/cases/update', { method: 'POST', body: JSON.stringify(payload) }); await loadCases(); }
    catch (error) { saveButton.disabled = false; saveButton.textContent = error.message; }
  });
  footer.append(updated, saveButton);
  card.append(header, meta, documents, statuses, notesWrap, footer);
  return card;
}
async function loadCases() {
  const owner = currentRole === 'owner';
  try {
    const records = await api('/api/cases');
    updateMetrics(records, owner ? '' : 'collab');
    const list = $(owner ? '#caseList' : '#collaboratorCaseList');
    list.replaceChildren();
    $('#caseListCount') && ($('#caseListCount').textContent = records.length);
    if (!records.length) { list.innerHTML = '<p class="empty-state">Todavía no hay expedientes asignados.</p>'; return; }
    records.forEach(record => list.append(createCaseCard(record, owner)));
  } catch (error) { setContactState(error.message); }
}

function readCaseForm() {
  return {
    clientName: $('#caseClientName').value.trim(), cedula: $('#caseCedula').value.trim(), phone: $('#casePhone').value.trim(), email: $('#caseEmail').value.trim(),
    deedReference: $('#caseDeedReference').value.trim(), protocolReference: $('#caseProtocolReference').value.trim(), assignedTo: $('#caseAssignedTo').value,
    deedStatus: $('#caseDeedStatus').value, protocolStatus: $('#caseProtocolStatus').value, signatureStatus: $('#caseSignatureStatus').value, notes: $('#caseNotes').value.trim()
  };
}
$('#caseForm').addEventListener('submit', async event => {
  event.preventDefault(); const message = $('#caseFormMessage'); message.textContent = 'Guardando expediente…';
  try { await api('/api/cases', { method: 'POST', body: JSON.stringify(readCaseForm()) }); event.currentTarget.reset(); message.textContent = 'Expediente guardado.'; await loadCases(); }
  catch (error) { message.textContent = error.message; }
});

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
      const date = document.createElement('small'); date.textContent = new Date(person.createdAt).toLocaleString('es'); info.append(name, detail, date);
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
