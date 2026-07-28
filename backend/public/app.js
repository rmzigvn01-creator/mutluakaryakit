// ===== API =====
const API = '/api';
let token = localStorage.getItem('token');
let currentUser = null;

async function api(method, path, body, isForm = false) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const opts = { method, headers };
  if (body && !isForm) opts.body = JSON.stringify(body);
  if (body && isForm) opts.body = body;

  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu');
  return data;
}

// ===== OFFLINE QUEUE =====
function getQueue() {
  return JSON.parse(localStorage.getItem('offlineQueue') || '[]');
}
function saveQueue(q) {
  localStorage.setItem('offlineQueue', JSON.stringify(q));
  updatePendingBadge();
}
function updatePendingBadge() {
  const q = getQueue();
  const badge = document.getElementById('pendingBadge');
  if (q.length > 0) {
    badge.textContent = `${q.length} bekliyor`;
    badge.classList.remove('hidden');
    document.getElementById('syncBanner').textContent =
      `⚠ ${q.length} kayıt internet gelince gönderilecek`;
    document.getElementById('syncBanner').classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    document.getElementById('syncBanner').classList.add('hidden');
  }
}

async function syncOfflineQueue() {
  const queue = getQueue();
  if (!queue.length || !navigator.onLine) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const form = new FormData();
      form.append('type', item.type);
      form.append('enteredAmount', item.enteredAmount);
      if (item.description) form.append('description', item.description);
      form.append('clientId', item.clientId);
      form.append('createdAt', item.createdAt);
      form.append('isCredit', item.isCredit ? 'true' : 'false');
      if (item.isCredit && item.customerId) form.append('customerId', item.customerId);
      form.append('isCompanyVehicle', item.isCompanyVehicle ? 'true' : 'false');
      if (item.isCompanyVehicle && item.vehicleId) form.append('vehicleId', item.vehicleId);
      // Receipt stored as base64
      const blob = await (await fetch(item.receiptBase64)).blob();
      form.append('receipt', blob, 'receipt.jpg');
      await api('POST', '/transactions', form, true);
    } catch {
      remaining.push(item);
    }
  }
  saveQueue(remaining);
  if (queue.length > remaining.length) {
    toast(`${queue.length - remaining.length} kayıt gönderildi`);
  }
}

window.addEventListener('online', syncOfflineQueue);

// ===== HELPERS =====
const fmt = (n) => '₺' + Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
const fmtDate = (d) => new Date(d).toLocaleString('tr-TR');
const OCR_TIME_TOLERANCE_MIN = 30;

function istanbulDateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(d));
}

function istanbulDateParts(d) {
  const dt = new Date(d);
  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(dt);
  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit',
  }).format(dt);
  return { date, time, label: `${date} ${time}` };
}

function formatDurationMinutes(minutes) {
  const abs = Math.round(Math.abs(minutes));
  if (abs < 60) return `${abs} dk`;
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins ? `${hours} saat ${mins} dk` : `${hours} saat`;
}

function getDateTimeMismatch(createdAt, receiptDateTime) {
  if (!receiptDateTime) return null;
  const created = new Date(createdAt);
  const receipt = new Date(receiptDateTime);
  const sameDay = istanbulDateKey(created) === istanbulDateKey(receipt);
  const diffMin = (created.getTime() - receipt.getTime()) / 60000;
  if (sameDay && Math.abs(diffMin) <= OCR_TIME_TOLERANCE_MIN) return null;

  const createdParts = istanbulDateParts(createdAt);
  const receiptParts = istanbulDateParts(receiptDateTime);
  const dayDiff = Math.round(
    (Date.parse(istanbulDateKey(created) + 'T00:00:00Z') -
      Date.parse(istanbulDateKey(receipt) + 'T00:00:00Z')) / 86400000
  );
  let reason;
  if (sameDay) {
    const ahead = diffMin > 0;
    reason = ahead
      ? `Aynı gün · kayıt fişten ${formatDurationMinutes(diffMin)} sonra`
      : `Aynı gün · kayıt fişten ${formatDurationMinutes(diffMin)} önce`;
  } else {
    const absDays = Math.abs(dayDiff);
    const dayWord = absDays === 1 ? '1 gün' : `${absDays} gün`;
    reason = dayDiff > 0
      ? `Farklı gün · kayıt fişten ${dayWord} sonra`
      : `Farklı gün · kayıt fişten ${dayWord} önce`;
  }

  return {
    createdLabel: createdParts.label,
    receiptLabel: receiptParts.label,
    createdDate: createdParts.date,
    createdTime: createdParts.time,
    receiptDate: receiptParts.date,
    receiptTime: receiptParts.time,
    reason,
  };
}

function renderDateTimeMismatchBox(mismatch) {
  return `<div class="tx-mismatch-section tx-mismatch-section--time">
    <div class="tx-mismatch-title">Tarih / saat</div>
    <div class="tx-mismatch-inline">
      <span><em>Kayıt</em> ${mismatch.createdDate} ${mismatch.createdTime}</span>
      <span class="tx-mismatch-vs">≠</span>
      <span><em>Fiş</em> ${mismatch.receiptDate} ${mismatch.receiptTime}</span>
    </div>
    <div class="tx-mismatch-diff">${mismatch.reason}</div>
  </div>`;
}

function renderAmountMismatchSection(t) {
  const entered = Number(t.enteredAmount);
  const receipt = Number(t.receiptAmount);
  const diff = Number(t.amountDiff != null ? t.amountDiff : (entered - receipt));
  const absDiff = Math.abs(diff);
  const direction = diff > 0 ? 'fazla girilmiş' : 'eksik girilmiş';
  return `<div class="tx-mismatch-section tx-mismatch-section--amount">
    <div class="tx-mismatch-title">Fiyat tutarsızlığı</div>
    <div class="tx-mismatch-amounts">
      <div class="tx-mismatch-amt">
        <span class="tx-mismatch-lbl">Girilen</span>
        <strong>${fmt(entered)}</strong>
      </div>
      <div class="tx-mismatch-vs" aria-hidden="true">≠</div>
      <div class="tx-mismatch-amt">
        <span class="tx-mismatch-lbl">Fiş</span>
        <strong>${fmt(receipt)}</strong>
      </div>
      <div class="tx-mismatch-amt tx-mismatch-amt--diff">
        <span class="tx-mismatch-lbl">Fark</span>
        <strong>${fmt(absDiff)}</strong>
      </div>
    </div>
    <div class="tx-mismatch-diff">Girilen tutar fişten ${fmt(absDiff)} ${direction}</div>
  </div>`;
}

function renderSuspicionAlertBox(t) {
  const hasAmount = t.receiptAmount != null && Math.abs(Number(t.amountDiff != null ? t.amountDiff : (t.enteredAmount - t.receiptAmount))) > 2;
  const dtMismatch = t.receiptDateTime ? getDateTimeMismatch(t.createdAt, t.receiptDateTime) : null;
  const isUnreadable = t.suspicionStatus === 'SUSPICIOUS_UNREADABLE';
  const isPending = t.suspicionStatus === 'PENDING_OCR';

  if (!hasAmount && !dtMismatch && !isUnreadable && !isPending && t.suspicionStatus !== 'SUSPICIOUS_MISMATCH') {
    return '';
  }

  let body = '';
  if (hasAmount) body += renderAmountMismatchSection(t);
  else if (t.suspicionStatus === 'SUSPICIOUS_MISMATCH') {
    body += `<div class="tx-mismatch-section"><div class="tx-mismatch-title">Fiyat tutarsızlığı</div><div class="tx-mismatch-diff">Girilen tutar ile fiş tutarı uyuşmuyor</div></div>`;
  }
  if (dtMismatch) body += renderDateTimeMismatchBox(dtMismatch);
  if (!body && isUnreadable) {
    body = `<div class="tx-mismatch-section"><div class="tx-mismatch-title">Fiş okunamadı</div><div class="tx-mismatch-diff">OCR fişi okuyamadı — fotoğrafı kontrol edin</div></div>`;
  }
  if (!body && isPending) {
    body = `<div class="tx-mismatch-section"><div class="tx-mismatch-title">OCR bekliyor</div><div class="tx-mismatch-diff">Fiş arka planda okunuyor</div></div>`;
  }
  if (!body) return '';
  return `<div class="tx-mismatch-box" role="alert">${body}</div>`;
}

function renderDateTimeMismatchHtml(createdAt, receiptDateTime) {
  const mismatch = getDateTimeMismatch(createdAt, receiptDateTime);
  if (!mismatch) {
    return `<div class="tx-datetime-ok-line">Fiş saati: ${fmtDate(receiptDateTime)}</div>`;
  }
  return `<div class="tx-mismatch-box" role="alert">${renderDateTimeMismatchBox(mismatch)}</div>`;
}

function renderDetailDateTimeRow(t) {
  if (!isAdmin() || !t.receiptDateTime) return '';
  const mm = getDateTimeMismatch(t.createdAt, t.receiptDateTime);
  if (mm) {
    return `<div class="detail-datetime-wrap"><div class="tx-mismatch-box" role="alert">${renderDateTimeMismatchBox(mm)}</div></div>`;
  }
  return `<div class="detail-row"><span>Fiş tarih/saat</span><strong>${fmtDate(t.receiptDateTime)}</strong></div>`;
}
const TYPE_LABELS = {
  FUEL_BENZIN: 'Benzin', FUEL_MOTORIN: 'Motorin',
  CARD_POS: 'Kart (POS)', CASH: 'Nakit', OTHER: 'Diğer'
};
const SUSPICION_LABELS = {
  NORMAL: 'Normal', SUSPICIOUS_MISMATCH: '⚠ Tutarsızlık',
  SUSPICIOUS_DATETIME_MISMATCH: '⚠ Tarih/saat uyuşmuyor',
  SUSPICIOUS_UNREADABLE: '⚠ Fiş okunamadı', PENDING_OCR: 'OCR bekliyor', REVIEWED: 'İncelendi'
};

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function setHeaderTitle(title) {
  document.getElementById('headerTitle').textContent = title;
}

function openModal(title, bodyHtml, footerHtml = '') {
  document.getElementById('modalBox').innerHTML = `
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}`;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalBox').innerHTML = '';
  document.getElementById('modalBox').classList.remove('modal-wide');
}

async function loadReceiptUrl(txId) {
  if (!canViewReceipt()) {
    throw new Error('Fiş görüntüleme yalnızca yönetici içindir');
  }
  const res = await fetch(`${API}/transactions/${txId}/receipt`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Fiş yüklenemedi');
  }
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Fiş dosyası geçersiz');
  return URL.createObjectURL(blob);
}

async function loadReceiptInto(elementId, txId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  try {
    const url = await loadReceiptUrl(txId);
    el.innerHTML = `
      <img class="receipt-full receipt-zoom" src="${url}" alt="Fiş fotoğrafı"
        onclick="window.open('${url}','_blank')">
      <p style="text-align:center;font-size:12px;color:var(--po-gray-light);margin-top:6px">
        Büyütmek için fotoğrafa tıklayın
      </p>`;
  } catch (e) {
    el.innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function showReceiptViewer(txId, title = 'Fiş Fotoğrafı') {
  if (!canViewReceipt()) {
    toast('Fiş görüntüleme yalnızca yönetici içindir');
    return;
  }
  openModal(title, '<p class="empty">Fiş yükleniyor...</p>');
  document.getElementById('modalBox').classList.add('modal-wide');
  try {
    const url = await loadReceiptUrl(txId);
    document.querySelector('#modalBox .modal-body').innerHTML = `
      <img class="receipt-full receipt-zoom" src="${url}" alt="Fiş fotoğrafı"
        onclick="window.open('${url}','_blank')">
      <p style="text-align:center;font-size:12px;color:var(--po-gray-light);margin-top:6px">
        Büyütmek için fotoğrafa tıklayın
      </p>`;
  } catch (e) {
    document.querySelector('#modalBox .modal-body').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

const ROLE_LABELS = {
  ADMIN: 'Yönetici',
  STAFF: 'Pompacı',
  ACCOUNTANT: 'Muhasebeci'
};

function isAdmin() {
  return currentUser?.role === 'ADMIN';
}

function canViewReceipt() {
  return currentUser?.role === 'ADMIN';
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userName').textContent =
    `${currentUser.name} · ${ROLE_LABELS[currentUser.role] || currentUser.role}`;
  updatePendingBadge();
  showHome();
}

// ===== AUTH =====
async function doLogin() {
  const username = (document.getElementById('loginUsername') || document.getElementById('loginEmail'))?.value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  document.getElementById('loginBtn').disabled = true;

  try {
    const data = await api('POST', '/auth/login', { username, password });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    showApp();
    syncOfflineQueue();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    document.getElementById('loginBtn').disabled = false;
  }
}

function doLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  showLogin();
}

document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('loginUsername')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ===== NAVIGATION =====
// ===== SHIFTS =====
let currentShift = null;

async function loadCurrentShift() {
  try {
    const data = await api('GET', '/shifts/current');
    currentShift = data.shift;
    return data;
  } catch {
    currentShift = null;
    return { shift: null };
  }
}

function renderShiftBanner(shiftData) {
  const { shift, summary } = shiftData;
  if (!shift && (currentUser.role === 'STAFF' || currentUser.role === 'ADMIN')) {
    return `
      <div class="shift-banner closed-style">
        <div class="shift-banner-header">
          <h3>⏱ Vardiya</h3>
          <span class="shift-status" style="background:#FFF3E0;color:#F57C00">Kapalı</span>
        </div>
        <p style="font-size:13px;color:var(--po-gray);margin-bottom:12px">
          İşlem girmeden önce vardiyanızı başlatın.
        </p>
        <button class="btn btn-primary" onclick="startShift()">Vardiya Başlat</button>
      </div>`;
  }
  if (!shift) return '';

  const started = fmtDate(shift.startedAt);
  return `
    <div class="shift-banner">
      <div class="shift-banner-header">
        <h3>⏱ Aktif Vardiya</h3>
        <span class="shift-status">Açık</span>
      </div>
      <p style="font-size:12px;color:var(--po-gray)">Başlangıç: ${started}</p>
      <div class="shift-stats">
        <div class="shift-stat"><div class="val">${summary?.transactionCount || 0}</div><div class="lbl">İşlem</div></div>
        <div class="shift-stat"><div class="val">${fmt(summary?.totalAmount || 0)}</div><div class="lbl">Toplam</div></div>
        ${isAdmin() ? `<div class="shift-stat"><div class="val">${summary?.suspiciousCount || 0}</div><div class="lbl">Şüpheli</div></div>` : ''}
      </div>
      <div class="shift-actions">
        <button class="btn btn-secondary" onclick="showShiftDetail('${shift.id}')">Detay</button>
        <button class="btn btn-primary" onclick="openEndShiftModal('${shift.id}')">Vardiya Bitir</button>
      </div>
    </div>`;
}

async function startShift() {
  try {
    await api('POST', '/shifts/start', {});
    toast('Vardiya başlatıldı');
    showHome();
  } catch (e) { toast(e.message); }
}

function openEndShiftModal(shiftId) {
  openModal('Vardiya Bitir', `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Vardiyayı kapatmak istediğinize emin misiniz?
    </p>
    <div class="form-group">
      <label>Kapanış Notu (isteğe bağlı)</label>
      <textarea id="shiftNote" rows="2" placeholder="Vardiya notu..."></textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="endShift('${shiftId}')">Vardiyayı Bitir</button>
  `);
}

async function endShift(shiftId) {
  const note = document.getElementById('shiftNote')?.value?.trim();
  try {
    const data = await api('POST', `/shifts/${shiftId}/end`, { note: note || null });
    closeModal();
    toast(`Vardiya kapatıldı — ${data.summary.transactionCount} işlem, ${fmt(data.summary.totalAmount)}`);
    showHome();
  } catch (e) { toast(e.message); }
}

async function showShifts() {
  setHeaderTitle('Vardiya Raporları');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Vardiya Raporları') + '<div id="shiftList"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', '/shifts');
    const list = document.getElementById('shiftList');
    if (!data.shifts.length) {
      list.innerHTML = '<p class="empty">Henüz vardiya kaydı yok</p>';
      return;
    }
    list.innerHTML = data.shifts.map(s => `
      <div class="tx-item" onclick="showShiftDetail('${s.id}')" style="cursor:pointer">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${s.user.name}</div>
            <div class="tx-type">${fmtDate(s.startedAt)}${s.endedAt ? ' → ' + fmtDate(s.endedAt) : ' · Devam ediyor'}</div>
          </div>
          <span class="tx-badge ${s.status === 'OPEN' ? 'normal' : 'suspicious'}">${s.status === 'OPEN' ? 'Açık' : 'Kapalı'}</span>
        </div>
        <div class="tx-meta">
          ${s.summary.transactionCount} işlem · ${fmt(s.summary.totalAmount)} toplam
          ${isAdmin() && s.summary.suspiciousCount > 0 ? ` · <strong style="color:var(--po-warning)">${s.summary.suspiciousCount} şüpheli</strong>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('shiftList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function showShiftDetail(shiftId) {
  setHeaderTitle('Vardiya Detayı');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Vardiya Detayı', 'showShifts()') + '<div id="shiftDetail"><p class="empty">Yükleniyor...</p></div>';

  try {
    const { shift, summary } = await api('GET', `/shifts/${shiftId}`);
    const typeRows = Object.entries(summary.byType || {}).map(([type, v]) =>
      `<div class="staff-row"><span>${TYPE_LABELS[type] || type}</span><strong>${v.count} · ${fmt(v.total)}</strong></div>`
    ).join('');

    document.getElementById('shiftDetail').innerHTML = `
      <div class="staff-card">
        <div class="staff-header">
          <div class="staff-rank">⏱</div>
          <div>
            <strong>${shift.user.name}</strong>
            <span class="tx-badge ${shift.status === 'OPEN' ? 'normal' : 'suspicious'}">${shift.status === 'OPEN' ? 'Açık' : 'Kapalı'}</span>
          </div>
        </div>
        <div class="staff-row"><span>Başlangıç</span><strong>${fmtDate(shift.startedAt)}</strong></div>
        ${shift.endedAt ? `<div class="staff-row"><span>Bitiş</span><strong>${fmtDate(shift.endedAt)}</strong></div>` : ''}
        <div class="staff-row"><span>İşlem sayısı</span><strong>${summary.transactionCount}</strong></div>
        <div class="staff-row"><span>Toplam ciro</span><strong>${fmt(summary.totalAmount)}</strong></div>
        ${isAdmin() ? `<div class="staff-row"><span>Şüpheli</span><strong>${summary.suspiciousCount}</strong></div>` : ''}
        ${shift.closingNote ? `<div class="staff-row"><span>Not</span><strong>${shift.closingNote}</strong></div>` : ''}
      </div>
      ${typeRows ? `<p class="section-label" style="margin-top:16px">İşlem Dağılımı</p><div class="staff-card">${typeRows}</div>` : ''}
      ${shift.transactions?.length ? `
        <p class="section-label" style="margin-top:16px">İşlemler</p>
        <div class="tx-list">${shift.transactions.map(t => `
          <div class="tx-item">
            <div class="tx-amount">${fmt(t.enteredAmount)} — ${TYPE_LABELS[t.type]}</div>
            <div class="tx-meta">${fmtDate(t.createdAt)}</div>
            ${canViewReceipt() ? `<button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="event.stopPropagation();showReceiptViewer('${t.id}')">Fiş Gör</button>` : ''}
          </div>`).join('')}
        </div>` : ''}`;
  } catch (e) {
    document.getElementById('shiftDetail').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function showHome() {
  setHeaderTitle('Ana Menü');
  const isAdmin = currentUser.role === 'ADMIN';
  const isStaff = currentUser.role === 'STAFF';
  const isAccountant = currentUser.role === 'ACCOUNTANT';

  const shiftPromise = (isStaff || isAdmin) ? loadCurrentShift() : Promise.resolve({ shift: null });
  const [shiftData, announcements] = await Promise.all([
    shiftPromise,
    api('GET', '/announcements').then(d => d.announcements || []).catch(() => []),
  ]);

  let html = `
    <div class="welcome-banner">
      <h2>Hoş geldiniz, ${escHtml(currentUser.name.split(' ')[0])}</h2>
      <p>Petrol Ofisi · Mutlu Akaryakıt · ${ROLE_LABELS[currentUser.role]}</p>
    </div>
    ${renderAnnouncementsHome(announcements)}
    ${renderShiftBanner(shiftData)}
    <div id="fuelPriceCard"><p class="empty" style="padding:12px">Fiyatlar yükleniyor...</p></div>
    <p class="section-label">Menü</p>
    <div class="menu-grid">`;

  if (isStaff || isAdmin) {
    if (isStaff && !shiftData.shift) {
      html += menuCard('⛽', 'Yeni İşlem', 'Önce vardiya başlatın', 'requireShiftThenNewTx()');
    } else {
      html += menuCard('⛽', 'Yeni İşlem', 'Fiş fotoğrafı zorunlu', 'showNewTransaction()');
    }
  }
  html += menuCard('🧾', 'İşlem Listesi', 'Tüm satış ve ödeme kayıtları', 'showTransactions()');
  html += menuCard('⏱', 'Vardiya Raporları', 'Pompacı vardiya geçmişi', 'showShifts()');

  if (isAdmin || isAccountant) {
    html += menuCard('🌙', 'Gün Sonu Raporu', 'Günlük kapanış özeti ve indirme', 'showDayClose()');
  }

  if (isAdmin) {
    html += menuCard('📊', 'Yönetici Paneli', 'Günlük özet ve istatistikler', 'showDashboard()');
    html += menuCard('📢', 'Duyurular', 'Kurallar ve duyuru yayınla', 'showAnnouncementsAdmin()');
    html += menuCard('👤', 'Üyeler', 'Pompacı / muhasebeci ekle', 'showUsers()');
    html += menuCard('📒', 'Veresiye', 'Müşteri borçları ve tahsilat', 'showCreditCustomers()');
    html += menuCard('🚗', 'Şirket Araçları', 'Araç yakıt takibi', 'showVehicles()');
    html += menuCard('🌾', 'Mutlu Tarım Harcamalar', 'Tedarikçi borçları ve ödemeler', 'showExpenseSuppliers()');
    html += menuCard('🧾', 'Fiş Kontrol', 'Tüm fiş fotoğraflarını görüntüle', 'showTransactions()');
    html += menuCard('⚠️', 'Şüpheli İşlemler', 'Tutarsız fiş / tutar uyarıları', 'showSuspicious()', true);
    html += menuCard('👥', 'Pompacı Analizi', 'Ay sonu performans karşılaştırması', 'showStaffPerformance()');
    html += menuCard('✅', 'Onay Bekleyenler', 'Düzeltme ve silme talepleri', 'showCorrections()');
  }
  if (isAccountant) {
    html += menuCard('✅', 'Düzeltme Talepleri', 'Onay bekleyen / açılan talepler', 'showCorrections()');
  }

  html += menuCard('📥', 'Excel Raporu', 'Dönem kayıtlarını indir', 'showExport()');
  html += menuCard('⚙️', 'Ayarlar', 'Şifre değiştir', 'showSettings()');

  html += '</div>';
  document.getElementById('mainContent').innerHTML = html;
  void loadFuelPriceCard();
}

function renderAnnouncementsHome(list) {
  if (!list || !list.length) return '';
  return `<div class="announcement-home" role="region" aria-label="Duyurular">
    <div class="announcement-home-label">Duyurular</div>
    ${list.map(a => `
      <div class="announcement-home-item">
        <div class="announcement-home-title">${escHtml(a.title)}</div>
        <div class="announcement-home-body">${escHtml(a.body).replace(/\n/g, '<br>')}</div>
      </div>
    `).join('')}
  </div>`;
}

async function loadFuelPriceCard() {
  const el = document.getElementById('fuelPriceCard');
  if (!el) return;
  try {
    const data = await api('GET', '/fuel-prices/current');
    const p = data.prices;
    if (!p) {
      el.innerHTML = '<p class="empty" style="padding:12px">Fiyat bilgisi yok</p>';
      return;
    }
    const loc = `${p.cityName || data.location?.city || 'Edirne'} / ${p.districtName || data.location?.district || 'İpsala'}`;
    const refreshed = isAdmin()
      ? `<button class="btn btn-sm btn-secondary" onclick="refreshFuelPrices()">Yenile</button>`
      : '';
    el.innerHTML = `
      <div class="fuel-price-card">
        <div class="fuel-price-head">
          <div>
            <div class="fuel-price-title">Akaryakıt Fiyatları</div>
            <div class="fuel-price-sub">${loc} · KDV dahil · Petrol Ofisi</div>
          </div>
          ${refreshed}
        </div>
        <div class="fuel-price-grid">
          <div class="fuel-price-item">
            <span class="lbl">Benzin 95</span>
            <strong>${Number(p.benzin).toFixed(2)}</strong>
            <span class="unit">TL/LT</span>
          </div>
          <div class="fuel-price-item">
            <span class="lbl">Motorin</span>
            <strong>${Number(p.motorin).toFixed(2)}</strong>
            <span class="unit">TL/LT</span>
          </div>
          <div class="fuel-price-item">
            <span class="lbl">Otogaz</span>
            <strong>${Number(p.lpg).toFixed(2)}</strong>
            <span class="unit">TL/LT</span>
          </div>
        </div>
        <div class="fuel-price-meta">Son güncelleme: ${fmtDate(p.fetchedAt)} · her ${Math.round((data.pollIntervalMs || 300000)/60000)} dk</div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<p class="empty" style="padding:12px">Fiyatlar alınamadı: ${e.message}</p>`;
  }
}

async function refreshFuelPrices() {
  try {
    await api('POST', '/fuel-prices/refresh');
    toast('Fiyatlar güncellendi');
    loadFuelPriceCard();
  } catch (e) { toast(e.message); }
}

function menuCard(icon, title, sub, onclick, warning = false) {
  return `<div class="menu-card${warning ? ' warning' : ''}" onclick="${onclick}">
    <div class="icon-wrap">${icon}</div>
    <div class="info"><h3>${title}</h3><p>${sub}</p></div>
    <span class="arrow">›</span>
  </div>`;
}

function pageHeader(title, back = 'showHome()') {
  return `<div class="page-header">
    <button class="back-btn" onclick="${back}">←</button>
    <h2>${title}</h2>
  </div>`;
}

// ===== NEW TRANSACTION =====
let receiptFile = null;
let creditCustomersCache = [];
let ocrBusy = false;

async function requireShiftThenNewTx() {
  await loadCurrentShift();
  if (currentUser.role === 'STAFF' && !currentShift) {
    toast('Yeni işlem için önce vardiya başlatın');
    showHome();
    return;
  }
  showNewTransaction();
}

async function showNewTransaction() {
  if (currentUser.role === 'STAFF') {
    await loadCurrentShift();
    if (!currentShift) {
      toast('Yeni işlem için önce vardiya başlatın');
      showHome();
      return;
    }
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  setHeaderTitle('Yeni İşlem');
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Yeni İşlem Kaydı')}
    <p class="credit-hint" style="margin-bottom:14px">
      Bilgileri siz girin, fiş fotoğrafını ekleyip kaydedin. Sistem fişi arka planda kontrol eder.
    </p>
    <div class="form-group">
      <label>Yakıt / İşlem Tipi</label>
      <select id="txType" onchange="onTxTypeChanged()">
        <option value="FUEL_MOTORIN">Motorin</option>
        <option value="FUEL_BENZIN">Benzin</option>
        <option value="OTHER">Otogaz</option>
        <option value="CARD_POS">Kart (POS)</option>
        <option value="CASH">Nakit</option>
      </select>
    </div>
    <div class="form-group credit-toggle-wrap" id="creditToggleWrap">
      <label class="credit-check-label" for="txIsCredit">
        <input type="checkbox" id="txIsCredit" onchange="toggleSaleOptions('credit')">
        <span class="credit-switch" aria-hidden="true"></span>
        <span class="credit-copy">
          <strong>Veresiye satış</strong>
          <small>Seçilirse satış müşterinin veresiye defterine yazılır</small>
        </span>
      </label>
    </div>
    <div class="form-group hidden" id="creditCustomerGroup">
      <label>Müşteri *</label>
      <select id="txCustomer">
        <option value="">Müşteri seçin...</option>
      </select>
    </div>
    <div class="form-group credit-toggle-wrap vehicle-toggle" id="vehicleToggleWrap">
      <label class="credit-check-label" for="txIsVehicle">
        <input type="checkbox" id="txIsVehicle" onchange="toggleSaleOptions('vehicle')">
        <span class="credit-switch" aria-hidden="true"></span>
        <span class="credit-copy">
          <strong>Şirket aracı</strong>
          <small>Seçilirse yakıt şirket aracının defterine yazılır</small>
        </span>
      </label>
    </div>
    <div class="form-group hidden" id="vehicleSelectGroup">
      <label>Şirket Aracı *</label>
      <select id="txVehicle">
        <option value="">Araç seçin...</option>
      </select>
    </div>
    <div class="form-row-2">
      <div class="form-group">
        <label>Fiş No</label>
        <input type="text" id="txReceiptNo" placeholder="" inputmode="numeric" autocomplete="off" name="receipt-no">
      </div>
      <div class="form-group">
        <label>Plaka</label>
        <input type="text" id="txPlate" placeholder="" autocomplete="off" name="vehicle-plate" style="text-transform:uppercase">
      </div>
    </div>
    <div class="form-row-2">
      <div class="form-group">
        <label>Litre</label>
        <input type="number" id="txLiters" placeholder="0.000" step="0.001" min="0" oninput="onLitersOrPriceChanged()">
      </div>
      <div class="form-group">
        <label>Birim fiyat (TL/lt)</label>
        <input type="number" id="txUnitPrice" placeholder="0.00" step="0.01" min="0" readonly oninput="onLitersOrPriceChanged()">
        <label class="credit-check-label" for="txManualPrice" style="margin-top:8px">
          <input type="checkbox" id="txManualPrice" onchange="onManualPriceToggle()">
          <span class="credit-switch" aria-hidden="true"></span>
          <span class="credit-copy">
            <strong>Manuel fiyat</strong>
            <small>Sorun olursa işaretleyip fiyatı elle girin</small>
          </span>
        </label>
        <p class="credit-hint" id="txPriceHint">PO İpsala güncel fiyatı</p>
      </div>
    </div>
    <div class="form-row-2">
      <div class="form-group">
        <label>Tarih</label>
        <input type="date" id="txDate" value="${defaultDate}">
      </div>
      <div class="form-group">
        <label>Saat</label>
        <input type="time" id="txTime" value="${defaultTime}">
      </div>
    </div>
    <div class="form-group">
      <label>Toplam tutar (TL) *</label>
      <input type="number" id="txAmount" placeholder="0.00" step="0.01" min="0" oninput="this.dataset.touched='1'">
      <p class="credit-hint" id="txAmountHint">Fişteki TOPLAM — litre × fiyattan öneri gelir</p>
    </div>
    <div class="form-group">
      <label>Açıklama</label>
      <input type="text" id="txDesc" placeholder="İsteğe bağlı not">
    </div>
    <div class="form-group">
      <label>Fiş Fotoğrafı *</label>
      <div class="receipt-upload" id="receiptUploadBox" onclick="document.getElementById('receiptInput').click()">
        <div class="icon">📷</div>
        <p>Fiş fotoğrafı çekin veya seçin (zorunlu)</p>
        <input type="file" id="receiptInput" accept="image/*,.heic,.heif" capture="environment"
          onchange="previewReceipt(this)">
      </div>
      <img id="receiptPreview" class="receipt-preview hidden" alt="Fiş">
      <div id="ocrStatus" class="ocr-status hidden"></div>
    </div>
    <button class="btn btn-primary" onclick="saveTransaction()" id="saveBtn">Kaydet</button>
  `;
  receiptFile = null;
  window.__poPrices = null;
  ocrBusy = false;
  toggleSaleOptions();
  loadCreditCustomersForSale();
  loadVehiclesForSale();
  void loadPoPricesForForm();
}

async function loadPoPricesForForm() {
  try {
    const data = await api('GET', '/fuel-prices/current');
    window.__poPrices = data.prices || null;
  } catch {
    window.__poPrices = null;
  }
  applyPoPriceForType();
}

function applyPoPriceForType() {
  const type = document.getElementById('txType')?.value;
  const priceEl = document.getElementById('txUnitPrice');
  const hint = document.getElementById('txPriceHint');
  const manual = document.getElementById('txManualPrice')?.checked;
  if (!priceEl) return;

  const p = window.__poPrices;
  let unit = null;
  let label = 'PO fiyatı yok';
  if (p) {
    if (type === 'FUEL_BENZIN') { unit = p.benzin; label = 'PO İpsala Benzin'; }
    else if (type === 'FUEL_MOTORIN') { unit = p.motorin; label = 'PO İpsala Motorin'; }
    else if (type === 'OTHER') { unit = p.lpg; label = 'PO İpsala Otogaz'; }
  }

  if (!manual && unit != null) {
    priceEl.value = Number(unit).toFixed(2);
    priceEl.readOnly = true;
  } else if (!manual) {
    priceEl.value = '';
    priceEl.readOnly = true;
  } else {
    priceEl.readOnly = false;
  }

  if (hint) {
    hint.textContent = unit != null
      ? `${label}: ${Number(unit).toFixed(2)} TL/lt`
      : (type === 'CARD_POS' || type === 'CASH'
        ? 'Kart/nakit için birim fiyat gerekmez'
        : 'PO fiyatı yok — Manuel fiyat işaretleyin');
  }
  onLitersOrPriceChanged();
}

function onTxTypeChanged() {
  const manual = document.getElementById('txManualPrice');
  if (manual) manual.checked = false;
  const amountEl = document.getElementById('txAmount');
  if (amountEl) delete amountEl.dataset.touched;
  applyPoPriceForType();
}

function onManualPriceToggle() {
  const manual = document.getElementById('txManualPrice')?.checked;
  const priceEl = document.getElementById('txUnitPrice');
  if (!priceEl) return;
  if (manual) {
    priceEl.readOnly = false;
    priceEl.focus();
  } else {
    applyPoPriceForType();
  }
}

function onLitersOrPriceChanged() {
  const liters = parseFloat(document.getElementById('txLiters')?.value);
  const unit = parseFloat(document.getElementById('txUnitPrice')?.value);
  const amountEl = document.getElementById('txAmount');
  const hint = document.getElementById('txAmountHint');
  if (!amountEl) return;
  if (liters > 0 && unit > 0) {
    const suggested = Math.round(liters * unit * 100) / 100;
    if (!amountEl.dataset.touched) amountEl.value = suggested.toFixed(2);
    if (hint) hint.textContent = `Öneri: ${liters.toLocaleString('tr-TR')} lt × ${unit.toFixed(2)} = ${fmt(suggested)}`;
  }
}

function setOcrStatus(msg, kind = 'info') {
  const el = document.getElementById('ocrStatus');
  if (!el) return;
  if (!msg) {
    el.className = 'ocr-status hidden';
    el.textContent = '';
    return;
  }
  el.className = `ocr-status ${kind}`;
  el.textContent = msg;
}

function toggleSaleOptions(source) {
  const creditEl = document.getElementById('txIsCredit');
  const vehicleEl = document.getElementById('txIsVehicle');
  if (source === 'credit' && creditEl?.checked && vehicleEl) vehicleEl.checked = false;
  if (source === 'vehicle' && vehicleEl?.checked && creditEl) creditEl.checked = false;

  const creditOn = Boolean(creditEl?.checked);
  const vehicleOn = Boolean(vehicleEl?.checked);
  document.getElementById('creditToggleWrap')?.classList.toggle('active', creditOn);
  document.getElementById('vehicleToggleWrap')?.classList.toggle('active', vehicleOn);
  document.getElementById('creditCustomerGroup')?.classList.toggle('hidden', !creditOn);
  document.getElementById('vehicleSelectGroup')?.classList.toggle('hidden', !vehicleOn);
}

async function loadCreditCustomersForSale() {
  const select = document.getElementById('txCustomer');
  if (!select) return;
  try {
    const data = await api('GET', '/credit/lookup');
    creditCustomersCache = data.customers || [];
    if (!creditCustomersCache.length) {
      select.innerHTML = '<option value="">Aktif müşteri yok — yöneticiden ekleyin</option>';
      return;
    }
    select.innerHTML =
      '<option value="">Müşteri seçin...</option>' +
      creditCustomersCache.map(c =>
        `<option value="${c.id}">${c.name}${c.phone ? ' · ' + c.phone : ''}</option>`
      ).join('');
  } catch (e) {
    select.innerHTML = '<option value="">Müşteri listesi yüklenemedi</option>';
  }
}

async function loadVehiclesForSale() {
  const select = document.getElementById('txVehicle');
  if (!select) return;
  try {
    const data = await api('GET', '/vehicles/lookup');
    const vehicles = data.vehicles || [];
    if (!vehicles.length) {
      select.innerHTML = '<option value="">Aktif araç yok — yöneticiden ekleyin</option>';
      return;
    }
    select.innerHTML =
      '<option value="">Araç seçin...</option>' +
      vehicles.map(v =>
        `<option value="${v.id}">${v.name} · ${v.plate}</option>`
      ).join('');
  } catch (e) {
    select.innerHTML = '<option value="">Araç listesi yüklenemedi</option>';
  }
}

function isHeicFile(file) {
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') ||
    ['image/heic', 'image/heif'].includes(file.type);
}

async function prepareReceiptFile(file) {
  if (!isHeicFile(file)) return file;
  if (typeof heic2any !== 'function') return file;
  try {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const jpgName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
    return new File([blob], jpgName, { type: 'image/jpeg' });
  } catch (e) {
    console.warn('HEIC dönüştürme:', e);
    return file;
  }
}

async function previewReceipt(input) {
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById('receiptPreview');
  try {
    receiptFile = await prepareReceiptFile(file);
    preview.src = URL.createObjectURL(receiptFile);
    preview.classList.remove('hidden');
    if (isHeicFile(file) && receiptFile.type === 'image/jpeg') {
      toast('iPhone fotoğrafı JPEG\'e dönüştürüldü');
    }
  } catch (e) {
    receiptFile = file;
    preview.classList.add('hidden');
    toast('Önizleme yok — kayıt sırasında dönüştürülecek');
  }

  setOcrStatus('Fiş eklendi — kayıttan sonra sistem kontrol edecek', 'ok');
}

async function saveTransaction() {
  if (currentUser.role === 'STAFF') {
    await loadCurrentShift();
    if (!currentShift) {
      toast('Yeni işlem için önce vardiya başlatın');
      showHome();
      return;
    }
  }

  const type = document.getElementById('txType').value;
  const amount = parseFloat(document.getElementById('txAmount').value);
  let desc = document.getElementById('txDesc').value.trim();
  const isCredit = document.getElementById('txIsCredit')?.checked;
  const customerId = document.getElementById('txCustomer')?.value;
  const isVehicle = document.getElementById('txIsVehicle')?.checked;
  const vehicleId = document.getElementById('txVehicle')?.value;
  const receiptNo = document.getElementById('txReceiptNo')?.value?.trim();
  const liters = document.getElementById('txLiters')?.value;
  const plate = document.getElementById('txPlate')?.value?.trim().toUpperCase();
  const unitPrice = document.getElementById('txUnitPrice')?.value;
  const txDate = document.getElementById('txDate')?.value;
  const txTime = document.getElementById('txTime')?.value;

  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  if (!receiptFile) return toast('Fiş fotoğrafı zorunludur');
  if (isCredit && !customerId) return toast('Veresiye için müşteri seçin');
  if (isVehicle && !vehicleId) return toast('Şirket aracı seçin');
  if (isCredit && isVehicle) return toast('Veresiye ve şirket aracı aynı anda seçilemez');

  if (!desc) {
    const bits = [];
    if (type === 'FUEL_MOTORIN' && liters) bits.push(`Motorin ${liters} lt`);
    if (type === 'FUEL_BENZIN' && liters) bits.push(`Benzin ${liters} lt`);
    if (type === 'OTHER' && liters) bits.push(`Otogaz ${liters} lt`);
    if (unitPrice) bits.push(`@ ${Number(unitPrice).toFixed(2)} TL/lt`);
    if (plate) bits.push(`Plaka ${plate}`);
    if (receiptNo) bits.push(`Fiş No ${receiptNo}`);
    if (txDate && txTime) bits.push(`${txDate.split('-').reverse().join('.')} ${txTime}`);
    desc = bits.join(' · ');
  } else if (plate && !desc.toUpperCase().includes(plate)) {
    desc = `${desc} · Plaka ${plate}`;
  }

  document.getElementById('saveBtn').disabled = true;
  setOcrStatus('Kaydediliyor…', 'info');

  const clientId = crypto.randomUUID();
  let createdAt = new Date().toISOString();
  if (txDate && txTime) {
    const local = new Date(`${txDate}T${txTime}:00+03:00`);
    if (!Number.isNaN(local.getTime())) createdAt = local.toISOString();
  }

  if (!navigator.onLine) {
    if (currentUser.role === 'STAFF' && !currentShift) {
      document.getElementById('saveBtn').disabled = false;
      toast('Offline kayıt için de açık vardiya gerekir');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const queue = getQueue();
      queue.push({
        clientId, type, enteredAmount: amount, description: desc || null,
        receiptBase64: reader.result, createdAt,
        isCredit: Boolean(isCredit),
        customerId: isCredit ? customerId : null,
        isCompanyVehicle: Boolean(isVehicle),
        vehicleId: isVehicle ? vehicleId : null,
      });
      saveQueue(queue);
      toast('Offline kaydedildi — internet gelince gönderilecek');
      showHome();
    };
    reader.readAsDataURL(receiptFile);
    return;
  }

  try {
    const form = new FormData();
    form.append('type', type);
    form.append('enteredAmount', amount);
    if (desc) form.append('description', desc);
    form.append('clientId', clientId);
    form.append('createdAt', createdAt);
    form.append('isCredit', isCredit ? 'true' : 'false');
    if (isCredit && customerId) form.append('customerId', customerId);
    form.append('isCompanyVehicle', isVehicle ? 'true' : 'false');
    if (isVehicle && vehicleId) form.append('vehicleId', vehicleId);
    form.append('receipt', receiptFile);
    const data = await api('POST', '/transactions', form, true);
    if (data.creditSale) {
      toast('Kaydedildi — veresiye defterine işlendi');
    } else if (data.vehicleFuel) {
      toast('Kaydedildi — şirket aracı defterine işlendi');
    } else {
      toast('İşlem kaydedildi');
    }
    showHome();
  } catch (e) {
    toast(e.message || 'Bağlantı hatası — sunucu çalışıyor mu?');
    document.getElementById('saveBtn').disabled = false;
  }
}

// ===== TRANSACTIONS LIST =====
async function showTransactions() {
  setHeaderTitle('İşlemler');
  document.getElementById('mainContent').innerHTML =
    pageHeader('İşlem Listesi') + '<div id="txList"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', '/transactions?limit=40');
    const list = document.getElementById('txList');
    if (!data.transactions.length) {
      list.innerHTML = '<p class="empty">Henüz işlem yok</p>';
      return;
    }
    list.innerHTML = '<div class="tx-list">' + data.transactions.map(renderTx).join('') + '</div>';
  } catch (e) {
    document.getElementById('txList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function renderTx(t) {
  const suspicious = isAdmin() && ['SUSPICIOUS_MISMATCH','SUSPICIOUS_DATETIME_MISMATCH','SUSPICIOUS_UNREADABLE','PENDING_OCR'].includes(t.suspicionStatus);
  const badgeClass = suspicious ? 'suspicious' : 'normal';
  const isAdminUser = canViewReceipt();
  const receiptBtn = isAdminUser
    ? `<button class="btn btn-sm btn-primary" onclick="showReceiptViewer('${t.id}')">Fiş Gör</button>`
    : '';
  return `<div class="tx-item${suspicious ? ' suspicious' : ''}">
    <div class="tx-header">
      <div>
        <div class="tx-amount">${fmt(t.enteredAmount)}</div>
        <div class="tx-type">${TYPE_LABELS[t.type] || t.type}</div>
      </div>
      <span class="tx-badge ${badgeClass}">${isAdmin() ? (SUSPICION_LABELS[t.suspicionStatus] || t.suspicionStatus) : 'Normal'}</span>
    </div>
    <div class="tx-meta">
      ${fmtDate(t.createdAt)}${t.createdBy ? ' · ' + t.createdBy.name : ''}
      ${t.isCredit ? '<br><strong style="color:var(--po-warning)">📒 Veresiye</strong>' + (t.customer?.name ? ' · ' + t.customer.name : '') : ''}
      ${t.isCompanyVehicle ? '<br><strong style="color:var(--po-red)">🚗 Şirket aracı</strong>' + (t.vehicle ? ' · ' + t.vehicle.name + ' · ' + t.vehicle.plate : '') : ''}
      ${isAdmin() && t.receiptAmount ? `<br>Fiş tutarı: ${fmt(t.receiptAmount)} · Fark: ${fmt(t.amountDiff||0)}` : ''}
      ${isAdmin() && t.receiptDateTime ? renderDateTimeMismatchHtml(t.createdAt, t.receiptDateTime) : ''}
      ${t.description ? '<br>' + t.description : ''}
    </div>
    <div class="tx-actions">
      ${receiptBtn}
      <button class="btn btn-sm btn-secondary" onclick="showTransactionDetail('${t.id}')">Detay</button>
      ${currentUser.role !== 'STAFF' ? `<button class="btn btn-sm btn-secondary" onclick="openCorrectionModal('${t.id}', ${t.enteredAmount})">Düzeltme Talebi</button>` : ''}
    </div>
  </div>`;
}

async function showTransactionDetail(txId) {
  try {
    const { transaction: t } = await api('GET', `/transactions/${txId}`);
    openModal('İşlem Detayı', `
      <div class="detail-row"><span>Tutar</span><strong>${fmt(t.enteredAmount)}</strong></div>
      <div class="detail-row"><span>Tip</span><strong>${TYPE_LABELS[t.type]}</strong></div>
      <div class="detail-row"><span>Tarih</span><strong>${fmtDate(t.createdAt)}</strong></div>
      <div class="detail-row"><span>Pompacı</span><strong>${t.createdBy?.name || '?'}</strong></div>
      ${t.isCredit ? `<div class="detail-row"><span>Veresiye</span><strong style="color:var(--po-warning)">${t.customer?.name || 'Evet'}</strong></div>` : ''}
      ${t.isCompanyVehicle ? `<div class="detail-row"><span>Şirket aracı</span><strong style="color:var(--po-red)">${t.vehicle ? t.vehicle.name + ' · ' + t.vehicle.plate : 'Evet'}</strong></div>` : ''}
      ${isAdmin() && t.receiptAmount ? `<div class="detail-row"><span>Fiş tutarı</span><strong>${fmt(t.receiptAmount)}</strong></div>` : ''}
      ${renderDetailDateTimeRow(t)}
      ${isAdmin() && t.amountDiff ? `<div class="detail-row"><span>Fark</span><strong style="color:var(--po-warning)">${fmt(t.amountDiff)}</strong></div>` : ''}
      ${isAdmin() ? `<div class="detail-row"><span>Durum</span><strong>${SUSPICION_LABELS[t.suspicionStatus]}</strong></div>` : ''}
      ${t.description ? `<div class="detail-row"><span>Açıklama</span><strong>${t.description}</strong></div>` : ''}
      ${canViewReceipt() ? `<div id="receiptImgWrap"><p class="empty" style="padding:12px">Fiş yükleniyor...</p></div>` : ''}
    `);
    if (canViewReceipt()) {
      document.getElementById('modalBox').classList.add('modal-wide');
      await loadReceiptInto('receiptImgWrap', txId);
    }
  } catch (e) { toast(e.message); }
}

// ===== CORRECTION REQUEST =====
function openCorrectionModal(txId, currentAmount) {
  openModal('Düzeltme Talebi', `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Mevcut tutar: <strong>${fmt(currentAmount)}</strong><br>
      Değişiklik yönetici onayı olmadan uygulanmaz.
    </p>
    <div class="form-group">
      <label>Talep Tipi</label>
      <select id="corrType">
        <option value="EDIT">Tutar düzeltme</option>
        <option value="DELETE">Kayıt silme</option>
      </select>
    </div>
    <div class="form-group" id="newAmountGroup">
      <label>Yeni Tutar (TL)</label>
      <input type="number" id="corrNewAmount" step="0.01" placeholder="${currentAmount}">
    </div>
    <div class="form-group">
      <label>Gerekçe *</label>
      <textarea id="corrReason" rows="3" placeholder="Neden düzeltme gerekiyor?"></textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="submitCorrection('${txId}')">Talep Gönder</button>
  `);

  document.getElementById('corrType').addEventListener('change', (e) => {
    document.getElementById('newAmountGroup').style.display =
      e.target.value === 'DELETE' ? 'none' : 'block';
  });
}

async function submitCorrection(txId) {
  const type = document.getElementById('corrType').value;
  const reason = document.getElementById('corrReason').value.trim();
  const newAmount = document.getElementById('corrNewAmount')?.value;

  if (!reason) return toast('Gerekçe zorunludur');

  try {
    const body = { type, reason };
    if (type === 'EDIT') {
      const amt = parseFloat(newAmount);
      if (!amt || amt <= 0) return toast('Geçerli yeni tutar girin');
      body.newValues = { enteredAmount: amt };
    }
    await api('POST', `/transactions/${txId}/correction-request`, body);
    closeModal();
    toast('Düzeltme talebi gönderildi — yönetici onayı bekleniyor');
  } catch (e) { toast(e.message); }
}

async function requestCorrection(txId) {
  openCorrectionModal(txId, 0);
}

// ===== CORRECTIONS (ADMIN) =====
async function showCorrections() {
  setHeaderTitle('Onay Bekleyenler');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Düzeltme Talepleri') + '<div id="corrList"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', '/corrections?status=PENDING');
    const list = document.getElementById('corrList');
    if (!data.requests.length) {
      list.innerHTML = '<p class="empty">Bekleyen talep yok</p>';
      return;
    }
    list.innerHTML = data.requests.map(r => `
      <div class="tx-item">
        <div class="tx-amount">${r.type === 'DELETE' ? '🗑 Silme Talebi' : '✏️ Düzeltme Talebi'}</div>
        <div class="tx-meta">
          İşlem: ${fmt(r.transaction.enteredAmount)} · ${TYPE_LABELS[r.transaction.type]}<br>
          Gerekçe: ${r.reason}<br>
          Talep eden: ${r.requestedBy.name} · ${fmtDate(r.createdAt)}
          ${r.newValues ? '<br>Yeni değerler: ' + r.newValues : ''}
        </div>
        ${currentUser.role === 'ADMIN' ? `
          <div class="tx-actions">
            <button class="btn btn-sm btn-primary" onclick="showReceiptViewer('${r.transaction.id}')">Fiş Gör</button>
            <button class="btn btn-sm btn-primary" onclick="confirmCorrection('${r.id}','${r.transaction.id}')">Onayla</button>
            <button class="btn btn-sm btn-danger" onclick="reviewCorrection('${r.id}','REJECT')">Reddet</button>
          </div>` : ''}
      </div>`).join('');
  } catch (e) {
    document.getElementById('corrList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function confirmCorrection(corrId, txId) {
  openModal('Onay Öncesi — Fiş Kontrolü', `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:12px">
      Onaylamadan önce fiş fotoğrafını kontrol edin.
    </p>
    <div id="corrReceiptWrap"><p class="empty">Fiş yükleniyor...</p></div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal();showCorrections()">İptal</button>
    <button class="btn btn-primary" onclick="reviewCorrection('${corrId}','APPROVE')">Onayla</button>
  `);
  document.getElementById('modalBox').classList.add('modal-wide');
  await loadReceiptInto('corrReceiptWrap', txId);
}

async function reviewCorrection(id, action) {
  try {
    await api('POST', `/corrections/${id}/review`, { action });
    toast(action === 'APPROVE' ? 'Onaylandı' : 'Reddedildi');
    showCorrections();
  } catch (e) { toast(e.message); }
}

// ===== ADMIN DASHBOARD =====
async function showDashboard() {
  setHeaderTitle('Yönetici Paneli');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Yönetici Paneli') + '<div id="dashContent"><p class="empty">Yükleniyor...</p></div>';

  try {
    const d = await api('GET', '/admin/dashboard');
    document.getElementById('dashContent').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Bugünkü İşlem</div><div class="value">${d.today.transactionCount}</div></div>
        <div class="stat-card"><div class="label">Bugünkü Toplam</div><div class="value">${fmt(d.today.totalAmount)}</div></div>
        <div class="stat-card warning"><div class="label">Şüpheli</div><div class="value">${d.suspiciousCount}</div></div>
        <div class="stat-card"><div class="label">Onay Bekleyen</div><div class="value">${d.pendingCorrections}</div></div>
      </div>
      <div class="menu-grid">
        ${menuCard('📢','Duyurular','Kurallar ve duyuru yayınla','showAnnouncementsAdmin()')}
        ${menuCard('👤','Üyeler','Pompacı / muhasebeci ekle','showUsers()')}
        ${menuCard('📒','Veresiye','Müşteri borç / tahsilat','showCreditCustomers()')}
        ${menuCard('🚗','Şirket Araçları','Araç yakıt takibi','showVehicles()')}
        ${menuCard('🌾','Mutlu Tarım Harcamalar','Tedarikçi borç / ödeme','showExpenseSuppliers()')}
        ${menuCard('🌙','Gün Sonu Raporu','Günlük kapanış özeti','showDayClose()')}
        ${menuCard('📥','Excel Raporu','Dönem kayıtlarını indir','showExport()')}
        ${menuCard('⚠️','Şüpheli İşlemler','İnceleme gerektiren','showSuspicious()',true)}
        ${menuCard('👥','Pompacı Analizi','Performans karşılaştırma','showStaffPerformance()')}
        ${menuCard('✅','Onay Bekleyenler','Düzeltme talepleri','showCorrections()')}
      </div>`;
  } catch (e) {
    document.getElementById('dashContent').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

// ===== ANNOUNCEMENTS / DUYURULAR (ADMIN) =====
let announcementsCache = [];

async function showAnnouncementsAdmin() {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  setHeaderTitle('Duyurular');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Duyurular', 'showDashboard()') + `
    <div class="day-close-toolbar">
      <p class="credit-hint" style="margin:0;flex:1">Aktif duyurular ana sayfada turuncu kutuda görünür.</p>
      <button class="btn btn-primary" onclick="openAnnouncementModal()">+ Duyuru</button>
    </div>
    <div id="annList"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const data = await api('GET', '/announcements/manage');
    announcementsCache = data.announcements || [];
    const list = document.getElementById('annList');
    if (!announcementsCache.length) {
      list.innerHTML = '<p class="empty">Henüz duyuru yok — “+ Duyuru” ile ekleyin</p>';
      return;
    }
    list.innerHTML = announcementsCache.map(a => `
      <div class="tx-item${!a.isActive ? ' suspicious' : ''}">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${escHtml(a.title)}</div>
            <div class="tx-type">${fmtDate(a.createdAt)}${a.createdBy?.name ? ' · ' + escHtml(a.createdBy.name) : ''}</div>
          </div>
          <span class="tx-badge ${a.isActive ? 'normal' : 'suspicious'}">${a.isActive ? 'Yayında' : 'Pasif'}</span>
        </div>
        <div class="tx-meta" style="white-space:pre-wrap">${escHtml(a.body)}</div>
        <div class="tx-actions">
          <button class="btn btn-sm btn-secondary" onclick="openAnnouncementModalById('${a.id}')">Düzenle</button>
          <button class="btn btn-sm btn-warning" onclick="toggleAnnouncement('${a.id}', ${!a.isActive})">${a.isActive ? 'Pasifleştir' : 'Yayınla'}</button>
          <button class="btn btn-sm btn-ghost" onclick="deleteAnnouncement('${a.id}')">Sil</button>
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('annList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openAnnouncementModalById(id) {
  const a = announcementsCache.find(x => x.id === id);
  if (!a) return toast('Duyuru bulunamadı');
  openAnnouncementModal(a);
}

function openAnnouncementModal(ann = null) {
  const isEdit = Boolean(ann);
  openModal(isEdit ? 'Duyuru Düzenle' : 'Yeni Duyuru', `
    <div class="form-group">
      <label>Başlık *</label>
      <input type="text" id="annTitle" value="${escHtml(ann?.title || '')}" placeholder="Örn: Vardiya kuralları" maxlength="120">
    </div>
    <div class="form-group">
      <label>Duyuru metni *</label>
      <textarea id="annBody" rows="6" placeholder="Kurallar, hatırlatmalar...">${escHtml(ann?.body || '')}</textarea>
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label>Durum</label>
      <select id="annActive">
        <option value="true" ${ann.isActive ? 'selected' : ''}>Yayında</option>
        <option value="false" ${!ann.isActive ? 'selected' : ''}>Pasif</option>
      </select>
    </div>` : ''}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="${isEdit ? `saveAnnouncement('${ann.id}')` : 'saveAnnouncement()'}">${isEdit ? 'Güncelle' : 'Yayınla'}</button>
  `);
}

async function saveAnnouncement(id) {
  const title = document.getElementById('annTitle').value.trim();
  const body = document.getElementById('annBody').value.trim();
  if (!title || !body) return toast('Başlık ve metin zorunlu');
  try {
    if (id) {
      const isActive = document.getElementById('annActive').value === 'true';
      await api('PATCH', `/announcements/${id}`, { title, body, isActive });
      toast('Duyuru güncellendi');
    } else {
      await api('POST', '/announcements', { title, body, isActive: true });
      toast('Duyuru yayınlandı');
    }
    closeModal();
    showAnnouncementsAdmin();
  } catch (e) { toast(e.message); }
}

async function toggleAnnouncement(id, isActive) {
  try {
    await api('PATCH', `/announcements/${id}`, { isActive });
    toast(isActive ? 'Duyuru yayınlandı' : 'Duyuru pasifleştirildi');
    showAnnouncementsAdmin();
  } catch (e) { toast(e.message); }
}

async function deleteAnnouncement(id) {
  if (!confirm('Bu duyuru silinsin mi?')) return;
  try {
    await api('DELETE', `/announcements/${id}`);
    toast('Duyuru silindi');
    showAnnouncementsAdmin();
  } catch (e) { toast(e.message); }
}

// ===== USERS / ÜYELER (ADMIN) =====
let usersCache = [];

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function showUsers() {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  setHeaderTitle('Üyeler');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Üyeler', 'showDashboard()') + `
    <div class="day-close-toolbar">
      <p class="credit-hint" style="margin:0;flex:1">Pompacı, muhasebeci veya yönetici hesabı ekleyin.</p>
      <button class="btn btn-primary" onclick="openUserModal()">+ Üye Ekle</button>
    </div>
    <div id="usersList"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const data = await api('GET', '/admin/users');
    usersCache = data.users || [];
    const list = document.getElementById('usersList');
    if (!usersCache.length) {
      list.innerHTML = '<p class="empty">Henüz üye yok — “+ Üye Ekle” ile başlayın</p>';
      return;
    }
    list.innerHTML = usersCache.map(u => {
      const self = u.id === currentUser.id;
      const nick = u.username || (u.email ? u.email.split('@')[0] : '—');
      return `
      <div class="tx-item${!u.isActive ? ' suspicious' : ''}">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${escHtml(u.name)}${self ? ' <span style="font-size:12px;font-weight:600;color:var(--po-gray-light)">(siz)</span>' : ''}</div>
            <div class="tx-type">@${escHtml(nick)}</div>
          </div>
          <span class="tx-badge ${u.isActive ? 'normal' : 'suspicious'}">${u.isActive ? (ROLE_LABELS[u.role] || u.role) : 'Pasif'}</span>
        </div>
        <div class="tx-meta">
          Rol: <strong>${ROLE_LABELS[u.role] || u.role}</strong>
          · Kayıt: ${fmtDate(u.createdAt)}
        </div>
        <div class="tx-actions">
          <button class="btn btn-sm btn-secondary" onclick="openUserModalById('${u.id}')">Düzenle</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('usersList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openUserModalById(id) {
  const user = usersCache.find(u => u.id === id);
  if (!user) return toast('Üye bulunamadı');
  openUserModal(user);
}

function openUserModal(user = null) {
  const isEdit = Boolean(user);
  const nick = user?.username || (user?.email ? user.email.split('@')[0] : '');
  openModal(isEdit ? 'Üye Düzenle' : 'Yeni Üye', `
    <div class="form-group">
      <label>Ad Soyad *</label>
      <input type="text" id="userName" value="${escHtml(user?.name || '')}" placeholder="Örn: Ali Yılmaz" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Kullanıcı adı (nick) *</label>
      <input type="text" id="userUsername" value="${escHtml(nick)}" placeholder="örn: ali"
        autocomplete="off">
      <p class="credit-hint">Giriş bu nick ile yapılır (e-posta gerekmez).</p>
    </div>
    <div class="form-group">
      <label>Rol *</label>
      <select id="userRole">
        <option value="STAFF" ${!user || user.role === 'STAFF' ? 'selected' : ''}>Pompacı</option>
        <option value="ACCOUNTANT" ${user?.role === 'ACCOUNTANT' ? 'selected' : ''}>Muhasebeci</option>
        <option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>Yönetici</option>
      </select>
    </div>
    <div class="form-group">
      <label>${isEdit ? 'Yeni şifre (boş bırakırsanız değişmez)' : 'Şifre *'}</label>
      <input type="password" id="userPassword" placeholder="${isEdit ? '••••••••' : 'En az 6 karakter'}" autocomplete="new-password">
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label>Durum</label>
      <select id="userActive" ${user.id === currentUser.id ? 'disabled' : ''}>
        <option value="true" ${user.isActive ? 'selected' : ''}>Aktif</option>
        <option value="false" ${!user.isActive ? 'selected' : ''}>Pasif</option>
      </select>
      ${user.id === currentUser.id ? '<p class="credit-hint">Kendi hesabınızı pasifleştiremezsiniz.</p>' : ''}
    </div>` : ''}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="${isEdit ? `saveUser('${user.id}')` : 'saveUser()'}">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
  `);
}

async function saveUser(id) {
  const name = document.getElementById('userName').value.trim();
  const username = document.getElementById('userUsername').value.trim();
  const role = document.getElementById('userRole').value;
  const password = document.getElementById('userPassword').value;
  if (!name) return toast('Ad soyad zorunlu');
  if (!username) return toast('Kullanıcı adı (nick) zorunlu');

  try {
    if (id) {
      const body = { name, username, role };
      const activeEl = document.getElementById('userActive');
      if (activeEl && !activeEl.disabled) body.isActive = activeEl.value === 'true';
      if (password) body.password = password;
      await api('PATCH', `/admin/users/${id}`, body);
      toast('Üye güncellendi');
    } else {
      if (!password || password.length < 6) return toast('Şifre en az 6 karakter olmalı');
      await api('POST', '/admin/users', { name, username, password, role });
      toast('Üye eklendi');
    }
    closeModal();
    showUsers();
  } catch (e) { toast(e.message); }
}

// ===== SUSPICIOUS =====
async function showSuspicious() {
  setHeaderTitle('Şüpheli İşlemler');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Şüpheli İşlemler', 'showDashboard()') +
    '<div id="suspList"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', '/admin/suspicious');
    const list = document.getElementById('suspList');
    if (!data.transactions.length) {
      list.innerHTML = '<p class="empty">Şüpheli işlem yok 🎉</p>';
      return;
    }
    const more = data.count > data.transactions.length
      ? `<p class="credit-hint" style="margin-top:12px">Son ${data.transactions.length} kayıt gösteriliyor (toplam ${data.count})</p>`
      : '';
    list.innerHTML = data.transactions.map(t => {
      const alertBox = renderSuspicionAlertBox(t);
      return `
      <div class="tx-item suspicious">
        <div class="tx-amount">${fmt(t.enteredAmount)} — ${TYPE_LABELS[t.type]}</div>
        <div class="tx-meta">
          Pompacı: ${t.createdBy?.name || '?'} · ${fmtDate(t.createdAt)}
          ${t.description ? '<br>' + t.description : ''}
        </div>
        ${alertBox}
        <div class="tx-actions">
          <button class="btn btn-sm btn-primary" onclick="showReceiptViewer('${t.id}')">Fiş Gör</button>
          <button class="btn btn-sm btn-warning" onclick="openReviewSuspiciousModal('${t.id}')">İncelendi</button>
        </div>
      </div>`;
    }).join('') + more;
  } catch (e) {
    document.getElementById('suspList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function openReviewSuspiciousModal(id) {
  openModal('Şüpheli İşlem — Fiş Kontrolü', `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:12px">
      Fiş fotoğrafını inceleyin ve not ekleyin.
    </p>
    <div id="suspReceiptWrap"><p class="empty">Fiş yükleniyor...</p></div>
    <div class="form-group" style="margin-top:16px">
      <label>Not (isteğe bağlı)</label>
      <textarea id="reviewNote" rows="2" placeholder="İnceleme notunuz..."></textarea>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="reviewSuspicious('${id}')">İncelendi Olarak İşaretle</button>
  `);
  document.getElementById('modalBox').classList.add('modal-wide');
  await loadReceiptInto('suspReceiptWrap', id);
}

async function reviewSuspicious(id) {
  const note = document.getElementById('reviewNote')?.value?.trim();
  try {
    await api('POST', `/admin/suspicious/${id}/review`, { note: note || null });
    closeModal();
    toast('İncelendi olarak işaretlendi');
    showSuspicious();
  } catch (e) { toast(e.message); }
}

// ===== DAY CLOSE =====
function turkeyToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

async function showDayClose(selectedDate) {
  setHeaderTitle('Gün Sonu Raporu');
  const date = selectedDate || turkeyToday();

  document.getElementById('mainContent').innerHTML =
    pageHeader('Gün Sonu Raporu') + `
    <div class="day-close-toolbar">
      <div class="form-group" style="margin:0;flex:1">
        <label>Tarih</label>
        <input type="date" id="dayCloseDate" value="${date}" onchange="showDayClose(this.value)">
      </div>
      <button class="btn btn-primary" onclick="downloadDayClose()">Excel İndir</button>
    </div>
    <div id="dayCloseContent"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const { report: r } = await api('GET', `/reports/day-close?date=${date}`);
    const el = document.getElementById('dayCloseContent');

    let warningsHtml = '';
    if (r.warnings?.length) {
      warningsHtml = `<div class="day-close-warnings">${r.warnings.map(w =>
        `<div class="warning-item">⚠️ ${w}</div>`
      ).join('')}</div>`;
    }

    const staffHtml = r.staff.length
      ? r.staff.map(s => `
        <div class="staff-row">
          <span>${s.name}</span>
          <strong>${s.transactionCount} işlem · ${fmt(s.totalAmount)}${isAdmin() && s.suspiciousCount ? ` · <span style="color:var(--po-warning)">${s.suspiciousCount} şüpheli</span>` : ''}</strong>
        </div>`).join('')
      : '<p class="empty" style="padding:12px 0">Bu tarihte pompacı kaydı yok</p>';

    const shiftHtml = r.shifts.items.length
      ? r.shifts.items.map(s => `
        <div class="staff-row">
          <span>${s.staffName}</span>
          <strong>${s.status === 'OPEN' ? '🟢 Açık' : '🔴 Kapalı'} · ${fmtDate(s.startedAt)}${s.endedAt ? ' — ' + fmtDate(s.endedAt) : ''}</strong>
        </div>`).join('')
      : '<p class="empty" style="padding:12px 0">Vardiya kaydı yok</p>';

    el.innerHTML = `
      ${warningsHtml}
      <div class="day-close-header">
        <h3>${r.stationName}</h3>
        <p>${formatDayLabel(r.date)} gün sonu özeti</p>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Toplam İşlem</div><div class="value">${r.summary.transactionCount}</div></div>
        <div class="stat-card"><div class="label">Toplam Tutar</div><div class="value">${fmt(r.summary.totalAmount)}</div></div>
        ${isAdmin() ? `<div class="stat-card warning"><div class="label">Şüpheli</div><div class="value">${r.summary.suspiciousCount}</div></div>` : ''}
        <div class="stat-card"><div class="label">Vardiya</div><div class="value" style="font-size:18px">${r.shifts.closed} kapalı</div></div>
      </div>
      <div class="day-close-section">
        <h4>Ödeme Dağılımı</h4>
        <div class="day-close-breakdown">
          <div class="breakdown-item"><span>💵 Nakit</span><strong>${fmt(r.summary.cashTotal)}</strong></div>
          <div class="breakdown-item"><span>💳 Kart (POS)</span><strong>${fmt(r.summary.cardTotal)}</strong></div>
          <div class="breakdown-item"><span>⛽ Yakıt</span><strong>${fmt(r.summary.fuelTotal)}</strong></div>
          <div class="breakdown-item"><span>📋 Diğer</span><strong>${fmt(r.summary.otherTotal)}</strong></div>
        </div>
      </div>
      <div class="day-close-section">
        <h4>Pompacı Bazında</h4>
        ${staffHtml}
      </div>
      <div class="day-close-section">
        <h4>Vardiyalar</h4>
        ${shiftHtml}
      </div>`;
  } catch (e) {
    document.getElementById('dayCloseContent').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function downloadDayClose() {
  const date = document.getElementById('dayCloseDate')?.value || turkeyToday();
  try {
    const res = await fetch(`${API}/reports/day-close/export?date=${date}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Rapor indirilemedi');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gun-sonu-${date}.csv`;
    a.click();
    toast('Gün sonu raporu indirildi');
  } catch (e) { toast(e.message); }
}

// ===== EXPORT =====
function showExport() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  openModal('Excel Raporu İndir', `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Seçilen tarih aralığındaki tüm işlemler Excel'de açılabilir CSV dosyası olarak indirilir.
    </p>
    <div class="form-group">
      <label>Başlangıç Tarihi</label>
      <input type="date" id="exportFrom" value="${monthStart}">
    </div>
    <div class="form-group">
      <label>Bitiş Tarihi</label>
      <input type="date" id="exportTo" value="${today}">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="downloadCsv()">İndir</button>
  `);
}

async function downloadCsv() {
  const from = document.getElementById('exportFrom').value;
  const to = document.getElementById('exportTo').value;
  try {
    const res = await fetch(`${API}/reports/export-csv?from=${from}&to=${to}T23:59:59`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Rapor indirilemedi');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mutluakaryakit-${from}_${to}.csv`;
    a.click();
    closeModal();
    toast('Rapor indirildi');
  } catch (e) { toast(e.message); }
}

// ===== CREDIT / VERESIYE (ADMIN) =====

function normalizeLedgerFilters(raw = {}) {
  return {
    from: raw.from || '',
    to: raw.to || '',
    kind: raw.kind || 'all',
    minAmount: raw.minAmount || '',
    maxAmount: raw.maxAmount || '',
  };
}

function ledgerFiltersQuery(filters, extra = {}) {
  const f = normalizeLedgerFilters(filters);
  const params = new URLSearchParams();
  if (extra.q?.trim()) params.set('q', extra.q.trim());
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.kind && f.kind !== 'all') params.set('kind', f.kind);
  if (f.minAmount !== '' && f.minAmount != null) params.set('minAmount', f.minAmount);
  if (f.maxAmount !== '' && f.maxAmount != null) params.set('maxAmount', f.maxAmount);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function readLedgerFilterForm() {
  return normalizeLedgerFilters({
    from: document.getElementById('ledgerFrom')?.value,
    to: document.getElementById('ledgerTo')?.value,
    kind: document.getElementById('ledgerKind')?.value,
    minAmount: document.getElementById('ledgerMin')?.value,
    maxAmount: document.getElementById('ledgerMax')?.value,
  });
}

/** Ortak filtre paneli — liste veya detay (Veresiye + Mutlu Tarım) */
function renderLedgerFilterPanel({ entityId, module, scope = 'detail', filters = {}, debitLabel, creditLabel, debitKind, creditKind }) {
  const f = normalizeLedgerFilters(filters);
  let applyFn, clearFn;
  if (scope === 'list') {
    if (module === 'expense') {
      applyFn = `showExpenseSuppliers(document.getElementById('expenseSearch')?.value || '', readLedgerFilterForm())`;
      clearFn = `showExpenseSuppliers(document.getElementById('expenseSearch')?.value || '', {})`;
    } else {
      applyFn = `showCreditCustomers(document.getElementById('creditSearch')?.value || '', readLedgerFilterForm())`;
      clearFn = `showCreditCustomers(document.getElementById('creditSearch')?.value || '', {})`;
    }
  } else if (module === 'expense') {
    applyFn = `showExpenseDetail('${entityId}', readLedgerFilterForm())`;
    clearFn = `showExpenseDetail('${entityId}', {})`;
  } else {
    applyFn = `showCreditDetail('${entityId}', readLedgerFilterForm())`;
    clearFn = `showCreditDetail('${entityId}', {})`;
  }

  return `
    <div class="ledger-filter-panel">
      <div class="ledger-filter-title">Detaylı Filtre</div>
      <div class="ledger-filter-grid">
        <div class="form-group">
          <label>Başlangıç</label>
          <input type="date" id="ledgerFrom" value="${f.from}">
        </div>
        <div class="form-group">
          <label>Bitiş</label>
          <input type="date" id="ledgerTo" value="${f.to}">
        </div>
        <div class="form-group">
          <label>İşlem Tipi</label>
          <select id="ledgerKind">
            <option value="all" ${f.kind === 'all' ? 'selected' : ''}>Tümü</option>
            <option value="${debitKind}" ${f.kind === debitKind ? 'selected' : ''}>${debitLabel}</option>
            <option value="${creditKind}" ${f.kind === creditKind ? 'selected' : ''}>${creditLabel}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Min Tutar</label>
          <input type="number" id="ledgerMin" step="0.01" min="0" placeholder="0" value="${f.minAmount}">
        </div>
        <div class="form-group">
          <label>Max Tutar</label>
          <input type="number" id="ledgerMax" step="0.01" min="0" placeholder="∞" value="${f.maxAmount}">
        </div>
      </div>
      <div class="ledger-filter-actions">
        <button class="btn btn-secondary" onclick="${clearFn}">Temizle</button>
        <button class="btn btn-primary" onclick="${applyFn}">Uygula</button>
      </div>
    </div>`;
}

async function showCreditCustomers(query = '', filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Veresiye');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Veresiye Müşterileri') + `
    <div class="day-close-toolbar">
      <div class="form-group" style="margin:0;flex:1">
        <label>Ara</label>
        <input type="search" id="creditSearch" placeholder="İsim veya telefon"
          value="${String(query).replace(/"/g, '&quot;')}"
          onkeydown="if(event.key==='Enter')showCreditCustomers(this.value, readLedgerFilterForm())">
      </div>
      <button class="btn btn-secondary" onclick="showCreditCustomers(document.getElementById('creditSearch').value, readLedgerFilterForm())">Ara</button>
      <button class="btn btn-primary" onclick="openCustomerModal()">+ Müşteri</button>
    </div>
    ${renderLedgerFilterPanel({
      module: 'credit',
      scope: 'list',
      filters: f,
      debitLabel: 'Satış (borç)',
      creditLabel: 'Tahsilat',
      debitKind: 'SALE',
      creditKind: 'PAYMENT',
    })}
    <div id="creditSummary"></div>
    <div id="creditList"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const data = await api('GET', `/credit/customers${ledgerFiltersQuery(f, { q: query })}`);
    const hasPeriod = f.from || f.to || (f.kind && f.kind !== 'all') || f.minAmount || f.maxAmount;
    document.getElementById('creditSummary').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Müşteri</div><div class="value">${data.summary.customerCount}</div></div>
        <div class="stat-card warning"><div class="label">Toplam Alacak</div><div class="value" style="font-size:20px">${fmt(data.summary.totalDebt)}</div></div>
        <div class="stat-card"><div class="label">Borçlu</div><div class="value">${data.summary.debtors}</div></div>
        ${hasPeriod ? `
        <div class="stat-card warning"><div class="label">Filtre satış</div><div class="value" style="font-size:18px">${fmt(data.summary.periodSales || 0)}</div></div>
        <div class="stat-card"><div class="label">Filtre tahsilat</div><div class="value" style="font-size:18px">${fmt(data.summary.periodPayments || 0)}</div></div>
        ` : ''}
      </div>`;

    const list = document.getElementById('creditList');
    if (!data.customers.length) {
      list.innerHTML = '<p class="empty">Sonuç yok — filtreyi değiştirin veya “+ Müşteri” ekleyin</p>';
      return;
    }
    list.innerHTML = data.customers.map(c => `
      <div class="tx-item${c.balance > 0.01 ? ' suspicious' : ''}" onclick="showCreditDetail('${c.id}')" style="cursor:pointer">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${c.name}</div>
            <div class="tx-type">${c.phone || 'Telefon yok'}${c.note ? ' · ' + c.note : ''}</div>
          </div>
          <span class="tx-badge ${c.balance > 0.01 ? 'suspicious' : 'normal'}">${c.balance > 0.01 ? 'Borçlu' : 'Temiz'}</span>
        </div>
        <div class="tx-meta">
          Kalan borç: <strong style="color:${c.balance > 0.01 ? 'var(--po-warning)' : 'var(--po-success)'}">${fmt(c.balance)}</strong>
          · Satış ${fmt(c.totalSales)} · Tahsilat ${fmt(c.totalPayments)}
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('creditList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openCustomerModal(customer = null) {
  const isEdit = Boolean(customer);
  openModal(isEdit ? 'Müşteri Düzenle' : 'Yeni Müşteri', `
    <div class="form-group">
      <label>Ad Soyad / Firma *</label>
      <input type="text" id="custName" value="${customer?.name || ''}" placeholder="Örn: Mehmet Yılmaz">
    </div>
    <div class="form-group">
      <label>Telefon</label>
      <input type="tel" id="custPhone" value="${customer?.phone || ''}" placeholder="05xx xxx xx xx">
    </div>
    <div class="form-group">
      <label>Not</label>
      <textarea id="custNote" rows="2" placeholder="Plaka, adres vb.">${customer?.note || ''}</textarea>
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label>Durum</label>
      <select id="custActive">
        <option value="true" ${customer.isActive ? 'selected' : ''}>Aktif</option>
        <option value="false" ${!customer.isActive ? 'selected' : ''}>Pasif</option>
      </select>
    </div>` : ''}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="${isEdit ? `saveCustomer('${customer.id}')` : 'saveCustomer()'}">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
  `);
}

async function saveCustomer(id) {
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const note = document.getElementById('custNote').value.trim();
  if (!name) return toast('Müşteri adı zorunlu');

  try {
    if (id) {
      const isActive = document.getElementById('custActive').value === 'true';
      await api('PATCH', `/credit/customers/${id}`, { name, phone, note, isActive });
      toast('Müşteri güncellendi');
      closeModal();
      showCreditDetail(id);
    } else {
      const data = await api('POST', '/credit/customers', { name, phone, note });
      toast('Müşteri eklendi');
      closeModal();
      showCreditDetail(data.customer.id);
    }
  } catch (e) { toast(e.message); }
}

async function showCreditDetail(customerId, filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Müşteri Detayı');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Müşteri Detayı', 'showCreditCustomers()') +
    '<div id="creditDetail"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', `/credit/customers/${customerId}${ledgerFiltersQuery(f)}`);
    const c = data.customer;
    const lifetimeBal = data.lifetimeBalance ?? data.balance;
    const balanceColor = lifetimeBal > 0.01 ? 'var(--po-warning)' : 'var(--po-success)';
    const periodColor = data.balance > 0.01 ? 'var(--po-warning)' : 'var(--po-success)';

    const ledgerHtml = data.ledger.length
      ? data.ledger.map(item => `
        <div class="tx-item${item.kind === 'SALE' ? ' suspicious' : ''}">
          <div class="tx-header">
            <div>
              <div class="tx-amount" style="font-size:16px;color:${item.kind === 'SALE' ? 'var(--po-warning)' : 'var(--po-success)'}">
                ${item.kind === 'SALE' ? '+' : '−'}${fmt(item.amount)}
              </div>
              <div class="tx-type">${item.kind === 'SALE' ? 'Veresiye satış' : 'Tahsilat'}</div>
            </div>
            <span class="tx-badge ${item.kind === 'SALE' ? 'suspicious' : 'normal'}">${item.kind === 'SALE' ? 'Borç' : 'Ödeme'}</span>
          </div>
          <div class="tx-meta">${fmtDate(item.createdAt)} · ${item.label}</div>
          <div class="tx-actions">
            <button class="btn btn-sm btn-danger" onclick="deleteCreditEntry('${item.kind}','${item.id}','${customerId}')">Sil</button>
          </div>
        </div>`).join('')
      : '<p class="empty">Bu filtreye uyan hareket yok</p>';

    document.getElementById('creditDetail').innerHTML = `
      <div class="staff-card">
        <div class="staff-header">
          <div class="staff-rank">📒</div>
          <div>
            <strong>${c.name}</strong>
            <span class="tx-badge ${c.isActive ? 'normal' : 'suspicious'}">${c.isActive ? 'Aktif' : 'Pasif'}</span>
          </div>
        </div>
        <div class="staff-row"><span>Telefon</span><strong>${c.phone || '—'}</strong></div>
        <div class="staff-row"><span>Not</span><strong>${c.note || '—'}</strong></div>
        <div class="staff-row"><span>Güncel kalan borç</span><strong style="color:${balanceColor};font-size:18px">${fmt(lifetimeBal)}</strong></div>
        <div class="staff-row"><span>Tüm satışlar</span><strong>${fmt(data.lifetimeSales ?? data.totalSales)}</strong></div>
        <div class="staff-row"><span>Tüm tahsilatlar</span><strong>${fmt(data.lifetimePayments ?? data.totalPayments)}</strong></div>
      </div>
      <div class="tx-actions" style="margin:12px 0 16px">
        <button class="btn btn-sm btn-secondary" onclick='openCustomerModal(${JSON.stringify(c)})'>Düzenle</button>
        <button class="btn btn-sm btn-warning" onclick="openCreditSaleModal('${c.id}','${c.name.replace(/'/g, "\\'")}')">+ Borç Ekle</button>
        <button class="btn btn-sm btn-primary" onclick="openCreditPaymentModal('${c.id}','${c.name.replace(/'/g, "\\'")}',${lifetimeBal})">Tahsilat</button>
      </div>
      ${renderLedgerFilterPanel({
        entityId: customerId,
        module: 'credit',
        filters: f,
        debitLabel: 'Satış (borç)',
        creditLabel: 'Tahsilat',
        debitKind: 'SALE',
        creditKind: 'PAYMENT',
      })}
      <div class="stats-grid" style="margin-top:12px">
        <div class="stat-card warning"><div class="label">Dönem satış</div><div class="value" style="font-size:18px">${fmt(data.totalSales)}</div></div>
        <div class="stat-card"><div class="label">Dönem tahsilat</div><div class="value" style="font-size:18px">${fmt(data.totalPayments)}</div></div>
        <div class="stat-card"><div class="label">Dönem net</div><div class="value" style="font-size:18px;color:${periodColor}">${fmt(data.balance)}</div></div>
      </div>
      <p class="section-label">Hareketler</p>
      <div class="tx-list">${ledgerHtml}</div>`;
  } catch (e) {
    document.getElementById('creditDetail').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openCreditSaleModal(customerId, name) {
  openModal('Veresiye Satış — ' + name, `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Müşteriye verilen yakıt / ürün borca yazılır.
    </p>
    <div class="form-group">
      <label>Tutar (TL) *</label>
      <input type="number" id="creditSaleAmount" step="0.01" min="0" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>Açıklama</label>
      <input type="text" id="creditSaleDesc" placeholder="Örn: Motorin 40 lt · Plaka 34 ABC 123">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="saveCreditSale('${customerId}')">Borca Yaz</button>
  `);
}

async function saveCreditSale(customerId) {
  const amount = parseFloat(document.getElementById('creditSaleAmount').value);
  const description = document.getElementById('creditSaleDesc').value.trim();
  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  try {
    await api('POST', `/credit/customers/${customerId}/sales`, { amount, description });
    closeModal();
    toast('Borç eklendi');
    showCreditDetail(customerId);
  } catch (e) { toast(e.message); }
}

function openCreditPaymentModal(customerId, name, balance) {
  openModal('Tahsilat — ' + name, `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Kalan borç: <strong>${fmt(balance)}</strong>
    </p>
    <div class="form-group">
      <label>Ödenen Tutar (TL) *</label>
      <input type="number" id="creditPayAmount" step="0.01" min="0" placeholder="0.00" value="${balance > 0 ? balance.toFixed(2) : ''}">
    </div>
    <div class="form-group">
      <label>Not</label>
      <input type="text" id="creditPayNote" placeholder="Örn: Nakit / Havale">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="saveCreditPayment('${customerId}')">Tahsilat Kaydet</button>
  `);
}

async function saveCreditPayment(customerId) {
  const amount = parseFloat(document.getElementById('creditPayAmount').value);
  const note = document.getElementById('creditPayNote').value.trim();
  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  try {
    await api('POST', `/credit/customers/${customerId}/payments`, { amount, note });
    closeModal();
    toast('Tahsilat kaydedildi');
    showCreditDetail(customerId);
  } catch (e) { toast(e.message); }
}

async function deleteCreditEntry(kind, id, customerId) {
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  try {
    const path = kind === 'SALE' ? `/credit/sales/${id}` : `/credit/payments/${id}`;
    await api('DELETE', path);
    toast('Kayıt silindi');
    showCreditDetail(customerId);
  } catch (e) { toast(e.message); }
}

// ===== MUTLU TARIM HARCAMALAR (ADMIN) =====
async function showExpenseSuppliers(query = '', filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Mutlu Tarım');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Mutlu Tarım Harcamalar') + `
    <div class="day-close-toolbar">
      <div class="form-group" style="margin:0;flex:1">
        <label>Ara</label>
        <input type="search" id="expenseSearch" placeholder="Firma adı veya telefon"
          value="${String(query).replace(/"/g, '&quot;')}"
          onkeydown="if(event.key==='Enter')showExpenseSuppliers(this.value, readLedgerFilterForm())">
      </div>
      <button class="btn btn-secondary" onclick="showExpenseSuppliers(document.getElementById('expenseSearch').value, readLedgerFilterForm())">Ara</button>
      <button class="btn btn-primary" onclick="openSupplierModal()">+ Firma</button>
    </div>
    ${renderLedgerFilterPanel({
      module: 'expense',
      scope: 'list',
      filters: f,
      debitLabel: 'Alış (borç)',
      creditLabel: 'Ödeme',
      debitKind: 'PURCHASE',
      creditKind: 'PAYMENT',
    })}
    <div id="expenseSummary"></div>
    <div id="expenseList"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const data = await api('GET', `/expenses/suppliers${ledgerFiltersQuery(f, { q: query })}`);
    const hasPeriod = f.from || f.to || (f.kind && f.kind !== 'all') || f.minAmount || f.maxAmount;
    document.getElementById('expenseSummary').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Firma</div><div class="value">${data.summary.supplierCount}</div></div>
        <div class="stat-card warning"><div class="label">Toplam Borç</div><div class="value" style="font-size:20px">${fmt(data.summary.totalDebt)}</div></div>
        <div class="stat-card"><div class="label">Borçlu</div><div class="value">${data.summary.debtors}</div></div>
        ${hasPeriod ? `
        <div class="stat-card warning"><div class="label">Filtre alış</div><div class="value" style="font-size:18px">${fmt(data.summary.periodPurchases || 0)}</div></div>
        <div class="stat-card"><div class="label">Filtre ödeme</div><div class="value" style="font-size:18px">${fmt(data.summary.periodPayments || 0)}</div></div>
        ` : ''}
      </div>`;

    const list = document.getElementById('expenseList');
    if (!data.suppliers.length) {
      list.innerHTML = '<p class="empty">Sonuç yok — filtreyi değiştirin veya “+ Firma” ekleyin</p>';
      return;
    }
    list.innerHTML = data.suppliers.map(s => `
      <div class="tx-item${s.balance > 0.01 ? ' suspicious' : ''}" onclick="showExpenseDetail('${s.id}')" style="cursor:pointer">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${s.name}</div>
            <div class="tx-type">${s.phone || 'Telefon yok'}${s.note ? ' · ' + s.note : ''}</div>
          </div>
          <span class="tx-badge ${s.balance > 0.01 ? 'suspicious' : 'normal'}">${s.balance > 0.01 ? 'Borçlu' : 'Temiz'}</span>
        </div>
        <div class="tx-meta">
          Kalan borç: <strong style="color:${s.balance > 0.01 ? 'var(--po-warning)' : 'var(--po-success)'}">${fmt(s.balance)}</strong>
          · Alış ${fmt(s.totalPurchases)} · Ödeme ${fmt(s.totalPayments)}
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('expenseList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openSupplierModal(supplier = null) {
  const isEdit = Boolean(supplier);
  openModal(isEdit ? 'Firma Düzenle' : 'Yeni Firma', `
    <div class="form-group">
      <label>Firma Adı *</label>
      <input type="text" id="suppName" value="${supplier?.name || ''}" placeholder="Örn: Sanayi Tornacı">
    </div>
    <div class="form-group">
      <label>Telefon</label>
      <input type="tel" id="suppPhone" value="${supplier?.phone || ''}" placeholder="05xx xxx xx xx">
    </div>
    <div class="form-group">
      <label>Not</label>
      <textarea id="suppNote" rows="2" placeholder="Ne iş yapıldığı, adres vb.">${supplier?.note || ''}</textarea>
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label>Durum</label>
      <select id="suppActive">
        <option value="true" ${supplier.isActive ? 'selected' : ''}>Aktif</option>
        <option value="false" ${!supplier.isActive ? 'selected' : ''}>Pasif</option>
      </select>
    </div>` : ''}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="${isEdit ? `saveSupplier('${supplier.id}')` : 'saveSupplier()'}">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
  `);
}

async function saveSupplier(id) {
  const name = document.getElementById('suppName').value.trim();
  const phone = document.getElementById('suppPhone').value.trim();
  const note = document.getElementById('suppNote').value.trim();
  if (!name) return toast('Firma adı zorunlu');

  try {
    if (id) {
      const isActive = document.getElementById('suppActive').value === 'true';
      await api('PATCH', `/expenses/suppliers/${id}`, { name, phone, note, isActive });
      toast('Firma güncellendi');
      closeModal();
      showExpenseDetail(id);
    } else {
      const data = await api('POST', '/expenses/suppliers', { name, phone, note });
      toast('Firma eklendi');
      closeModal();
      showExpenseDetail(data.supplier.id);
    }
  } catch (e) { toast(e.message); }
}

async function showExpenseDetail(supplierId, filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Firma Detayı');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Firma Detayı', 'showExpenseSuppliers()') +
    '<div id="expenseDetail"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', `/expenses/suppliers/${supplierId}${ledgerFiltersQuery(f)}`);
    const s = data.supplier;
    const lifetimeBal = data.lifetimeBalance ?? data.balance;
    const balanceColor = lifetimeBal > 0.01 ? 'var(--po-warning)' : 'var(--po-success)';
    const periodColor = data.balance > 0.01 ? 'var(--po-warning)' : 'var(--po-success)';

    const ledgerHtml = data.ledger.length
      ? data.ledger.map(item => `
        <div class="tx-item${item.kind === 'PURCHASE' ? ' suspicious' : ''}">
          <div class="tx-header">
            <div>
              <div class="tx-amount" style="font-size:16px;color:${item.kind === 'PURCHASE' ? 'var(--po-warning)' : 'var(--po-success)'}">
                ${item.kind === 'PURCHASE' ? '+' : '−'}${fmt(item.amount)}
              </div>
              <div class="tx-type">${item.kind === 'PURCHASE' ? 'Alış / harcama' : 'Ödeme'}</div>
            </div>
            <span class="tx-badge ${item.kind === 'PURCHASE' ? 'suspicious' : 'normal'}">${item.kind === 'PURCHASE' ? 'Borç' : 'Ödeme'}</span>
          </div>
          <div class="tx-meta">${fmtDate(item.createdAt)} · ${item.label}</div>
          <div class="tx-actions">
            <button class="btn btn-sm btn-danger" onclick="deleteExpenseEntry('${item.kind}','${item.id}','${supplierId}')">Sil</button>
          </div>
        </div>`).join('')
      : '<p class="empty">Bu filtreye uyan hareket yok</p>';

    document.getElementById('expenseDetail').innerHTML = `
      <div class="staff-card">
        <div class="staff-header">
          <div class="staff-rank">🌾</div>
          <div>
            <strong>${s.name}</strong>
            <span class="tx-badge ${s.isActive ? 'normal' : 'suspicious'}">${s.isActive ? 'Aktif' : 'Pasif'}</span>
          </div>
        </div>
        <div class="staff-row"><span>Telefon</span><strong>${s.phone || '—'}</strong></div>
        <div class="staff-row"><span>Not</span><strong>${s.note || '—'}</strong></div>
        <div class="staff-row"><span>Güncel kalan borç</span><strong style="color:${balanceColor};font-size:18px">${fmt(lifetimeBal)}</strong></div>
        <div class="staff-row"><span>Tüm alışlar</span><strong>${fmt(data.lifetimePurchases ?? data.totalPurchases)}</strong></div>
        <div class="staff-row"><span>Tüm ödemeler</span><strong>${fmt(data.lifetimePayments ?? data.totalPayments)}</strong></div>
      </div>
      <div class="tx-actions" style="margin:12px 0 16px">
        <button class="btn btn-sm btn-secondary" onclick='openSupplierModal(${JSON.stringify(s)})'>Düzenle</button>
        <button class="btn btn-sm btn-warning" onclick="openExpensePurchaseModal('${s.id}','${s.name.replace(/'/g, "\\'")}')">+ Alış Ekle</button>
        <button class="btn btn-sm btn-primary" onclick="openExpensePaymentModal('${s.id}','${s.name.replace(/'/g, "\\'")}',${lifetimeBal})">Ödeme Yap</button>
      </div>
      ${renderLedgerFilterPanel({
        entityId: supplierId,
        module: 'expense',
        filters: f,
        debitLabel: 'Alış (borç)',
        creditLabel: 'Ödeme',
        debitKind: 'PURCHASE',
        creditKind: 'PAYMENT',
      })}
      <div class="stats-grid" style="margin-top:12px">
        <div class="stat-card warning"><div class="label">Dönem alış</div><div class="value" style="font-size:18px">${fmt(data.totalPurchases)}</div></div>
        <div class="stat-card"><div class="label">Dönem ödeme</div><div class="value" style="font-size:18px">${fmt(data.totalPayments)}</div></div>
        <div class="stat-card"><div class="label">Dönem net</div><div class="value" style="font-size:18px;color:${periodColor}">${fmt(data.balance)}</div></div>
      </div>
      <p class="section-label">Hareketler</p>
      <div class="tx-list">${ledgerHtml}</div>`;
  } catch (e) {
    document.getElementById('expenseDetail').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openExpensePurchaseModal(supplierId, name) {
  openModal('Alış / Harcama — ' + name, `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Sanayi malzemesi, torna, ekipman vb. borca yazılır.
    </p>
    <div class="form-group">
      <label>Tutar (TL) *</label>
      <input type="number" id="expensePurchaseAmount" step="0.01" min="0" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>Açıklama</label>
      <input type="text" id="expensePurchaseDesc" placeholder="Örn: Torna mili · Demir profil">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="saveExpensePurchase('${supplierId}')">Borca Yaz</button>
  `);
}

async function saveExpensePurchase(supplierId) {
  const amount = parseFloat(document.getElementById('expensePurchaseAmount').value);
  const description = document.getElementById('expensePurchaseDesc').value.trim();
  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  try {
    await api('POST', `/expenses/suppliers/${supplierId}/purchases`, { amount, description });
    closeModal();
    toast('Alış kaydedildi');
    showExpenseDetail(supplierId);
  } catch (e) { toast(e.message); }
}

function openExpensePaymentModal(supplierId, name, balance) {
  openModal('Ödeme — ' + name, `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Kalan borç: <strong>${fmt(balance)}</strong>
    </p>
    <div class="form-group">
      <label>Ödenen Tutar (TL) *</label>
      <input type="number" id="expensePayAmount" step="0.01" min="0" placeholder="0.00" value="${balance > 0 ? balance.toFixed(2) : ''}">
    </div>
    <div class="form-group">
      <label>Not</label>
      <input type="text" id="expensePayNote" placeholder="Örn: Yıl sonu kapama / Havale">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="saveExpensePayment('${supplierId}')">Ödeme Kaydet</button>
  `);
}

async function saveExpensePayment(supplierId) {
  const amount = parseFloat(document.getElementById('expensePayAmount').value);
  const note = document.getElementById('expensePayNote').value.trim();
  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  try {
    await api('POST', `/expenses/suppliers/${supplierId}/payments`, { amount, note });
    closeModal();
    toast('Ödeme kaydedildi');
    showExpenseDetail(supplierId);
  } catch (e) { toast(e.message); }
}

async function deleteExpenseEntry(kind, id, supplierId) {
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  try {
    const path = kind === 'PURCHASE' ? `/expenses/purchases/${id}` : `/expenses/payments/${id}`;
    await api('DELETE', path);
    toast('Kayıt silindi');
    showExpenseDetail(supplierId);
  } catch (e) { toast(e.message); }
}

// ===== ŞİRKET ARAÇLARI (ADMIN) =====
function vehicleFiltersQuery(filters, extra = {}) {
  const f = normalizeLedgerFilters(filters);
  const params = new URLSearchParams();
  if (extra.q?.trim()) params.set('q', extra.q.trim());
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.minAmount !== '' && f.minAmount != null) params.set('minAmount', f.minAmount);
  if (f.maxAmount !== '' && f.maxAmount != null) params.set('maxAmount', f.maxAmount);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function renderVehicleFilterPanel({ vehicleId, scope = 'list', filters = {} }) {
  const f = normalizeLedgerFilters(filters);
  const applyFn = scope === 'detail'
    ? `showVehicleDetail('${vehicleId}', readLedgerFilterForm())`
    : `showVehicles(document.getElementById('vehicleSearch')?.value || '', readLedgerFilterForm())`;
  const clearFn = scope === 'detail'
    ? `showVehicleDetail('${vehicleId}', {})`
    : `showVehicles(document.getElementById('vehicleSearch')?.value || '', {})`;

  return `
    <div class="ledger-filter-panel">
      <div class="ledger-filter-title">Detaylı Filtre</div>
      <div class="ledger-filter-grid">
        <div class="form-group">
          <label>Başlangıç</label>
          <input type="date" id="ledgerFrom" value="${f.from}">
        </div>
        <div class="form-group">
          <label>Bitiş</label>
          <input type="date" id="ledgerTo" value="${f.to}">
        </div>
        <div class="form-group">
          <label>Min Tutar</label>
          <input type="number" id="ledgerMin" step="0.01" min="0" placeholder="0" value="${f.minAmount}">
        </div>
        <div class="form-group">
          <label>Max Tutar</label>
          <input type="number" id="ledgerMax" step="0.01" min="0" placeholder="∞" value="${f.maxAmount}">
        </div>
      </div>
      <div class="ledger-filter-actions">
        <button class="btn btn-secondary" onclick="${clearFn}">Temizle</button>
        <button class="btn btn-primary" onclick="${applyFn}">Uygula</button>
      </div>
    </div>`;
}

async function showVehicles(query = '', filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Şirket Araçları');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Şirket Araçları') + `
    <div class="day-close-toolbar">
      <div class="form-group" style="margin:0;flex:1">
        <label>Ara</label>
        <input type="search" id="vehicleSearch" placeholder="Araç adı veya plaka"
          value="${String(query).replace(/"/g, '&quot;')}"
          onkeydown="if(event.key==='Enter')showVehicles(this.value, readLedgerFilterForm())">
      </div>
      <button class="btn btn-secondary" onclick="showVehicles(document.getElementById('vehicleSearch').value, readLedgerFilterForm())">Ara</button>
      <button class="btn btn-primary" onclick="openVehicleModal()">+ Araç</button>
    </div>
    ${renderVehicleFilterPanel({ scope: 'list', filters: f })}
    <div id="vehicleSummary"></div>
    <div id="vehicleList"><p class="empty">Yükleniyor...</p></div>`;

  try {
    const data = await api('GET', `/vehicles${vehicleFiltersQuery(f, { q: query })}`);
    const hasPeriod = f.from || f.to || f.minAmount || f.maxAmount;
    document.getElementById('vehicleSummary').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Araç</div><div class="value">${data.summary.vehicleCount}</div></div>
        <div class="stat-card warning"><div class="label">${hasPeriod ? 'Filtre yakıt' : 'Toplam yakıt'}</div><div class="value" style="font-size:20px">${fmt(data.summary.totalFuel)}</div></div>
      </div>`;

    const list = document.getElementById('vehicleList');
    if (!data.vehicles.length) {
      list.innerHTML = '<p class="empty">Sonuç yok — “+ Araç” ile ekleyin</p>';
      return;
    }
    list.innerHTML = data.vehicles.map(v => `
      <div class="tx-item" onclick="showVehicleDetail('${v.id}')" style="cursor:pointer">
        <div class="tx-header">
          <div>
            <div class="tx-amount">${v.name}</div>
            <div class="tx-type">${v.plate}${v.note ? ' · ' + v.note : ''}</div>
          </div>
          <span class="tx-badge ${v.isActive ? 'normal' : 'suspicious'}">${v.isActive ? 'Aktif' : 'Pasif'}</span>
        </div>
        <div class="tx-meta">
          Yakıt: <strong style="color:var(--po-red)">${fmt(v.totalFuel)}</strong>
          · ${v.fillCount} dolum
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('vehicleList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openVehicleModal(vehicle = null) {
  const isEdit = Boolean(vehicle);
  openModal(isEdit ? 'Araç Düzenle' : 'Yeni Şirket Aracı', `
    <div class="form-group">
      <label>Araç Adı *</label>
      <input type="text" id="vehName" value="${vehicle?.name || ''}" placeholder="Örn: Ford Transit">
    </div>
    <div class="form-group">
      <label>Plaka *</label>
      <input type="text" id="vehPlate" value="${vehicle?.plate || ''}" placeholder="34 ABC 123">
    </div>
    <div class="form-group">
      <label>Not</label>
      <textarea id="vehNote" rows="2" placeholder="Sürücü, kullanım vb.">${vehicle?.note || ''}</textarea>
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label>Durum</label>
      <select id="vehActive">
        <option value="true" ${vehicle.isActive ? 'selected' : ''}>Aktif</option>
        <option value="false" ${!vehicle.isActive ? 'selected' : ''}>Pasif</option>
      </select>
    </div>` : ''}
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="${isEdit ? `saveVehicle('${vehicle.id}')` : 'saveVehicle()'}">${isEdit ? 'Güncelle' : 'Kaydet'}</button>
  `);
}

async function saveVehicle(id) {
  const name = document.getElementById('vehName').value.trim();
  const plate = document.getElementById('vehPlate').value.trim();
  const note = document.getElementById('vehNote').value.trim();
  if (!name) return toast('Araç adı zorunlu');
  if (!plate) return toast('Plaka zorunlu');

  try {
    if (id) {
      const isActive = document.getElementById('vehActive').value === 'true';
      await api('PATCH', `/vehicles/${id}`, { name, plate, note, isActive });
      toast('Araç güncellendi');
      closeModal();
      showVehicleDetail(id);
    } else {
      const data = await api('POST', '/vehicles', { name, plate, note });
      toast('Araç eklendi');
      closeModal();
      showVehicleDetail(data.vehicle.id);
    }
  } catch (e) { toast(e.message); }
}

async function showVehicleDetail(vehicleId, filters = {}) {
  if (!isAdmin()) return toast('Bu menü yalnızca yönetici içindir');
  const f = normalizeLedgerFilters(filters);
  setHeaderTitle('Araç Detayı');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Araç Detayı', 'showVehicles()') +
    '<div id="vehicleDetail"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', `/vehicles/${vehicleId}${vehicleFiltersQuery(f)}`);
    const v = data.vehicle;

    const ledgerHtml = data.ledger.length
      ? data.ledger.map(item => `
        <div class="tx-item">
          <div class="tx-header">
            <div>
              <div class="tx-amount" style="font-size:16px;color:var(--po-red)">${fmt(item.amount)}</div>
              <div class="tx-type">Yakıt dolumu</div>
            </div>
            <span class="tx-badge normal">Yakıt</span>
          </div>
          <div class="tx-meta">${fmtDate(item.createdAt)} · ${item.label}</div>
          <div class="tx-actions">
            <button class="btn btn-sm btn-danger" onclick="deleteVehicleFill('${item.id}','${vehicleId}')">Sil</button>
          </div>
        </div>`).join('')
      : '<p class="empty">Bu filtreye uyan dolum yok</p>';

    document.getElementById('vehicleDetail').innerHTML = `
      <div class="staff-card">
        <div class="staff-header">
          <div class="staff-rank">🚗</div>
          <div>
            <strong>${v.name}</strong>
            <span class="tx-badge ${v.isActive ? 'normal' : 'suspicious'}">${v.isActive ? 'Aktif' : 'Pasif'}</span>
          </div>
        </div>
        <div class="staff-row"><span>Plaka</span><strong>${v.plate}</strong></div>
        <div class="staff-row"><span>Not</span><strong>${v.note || '—'}</strong></div>
        <div class="staff-row"><span>Tüm zamanlar yakıt</span><strong style="color:var(--po-red);font-size:18px">${fmt(data.lifetimeTotal)}</strong></div>
      </div>
      <div class="tx-actions" style="margin:12px 0 16px">
        <button class="btn btn-sm btn-secondary" onclick='openVehicleModal(${JSON.stringify(v)})'>Düzenle</button>
        <button class="btn btn-sm btn-warning" onclick="openVehicleFillModal('${v.id}','${v.name.replace(/'/g, "\\'")}')">+ Yakıt Ekle</button>
      </div>
      ${renderVehicleFilterPanel({ vehicleId, scope: 'detail', filters: f })}
      <div class="stats-grid" style="margin-top:12px">
        <div class="stat-card warning"><div class="label">Dönem yakıt</div><div class="value" style="font-size:18px">${fmt(data.totalFuel)}</div></div>
        <div class="stat-card"><div class="label">Dönem dolum</div><div class="value" style="font-size:18px">${data.fillCount}</div></div>
      </div>
      <p class="section-label">Dolumlar</p>
      <div class="tx-list">${ledgerHtml}</div>`;
  } catch (e) {
    document.getElementById('vehicleDetail').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function openVehicleFillModal(vehicleId, name) {
  openModal('Yakıt Ekle — ' + name, `
    <p style="font-size:13px;color:var(--po-gray);margin-bottom:16px">
      Manuel yakıt kaydı (fişsiz). Normalde pompacı Yeni İşlem’den yazar.
    </p>
    <div class="form-group">
      <label>Tutar (TL) *</label>
      <input type="number" id="vehFillAmount" step="0.01" min="0" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>Açıklama</label>
      <input type="text" id="vehFillDesc" placeholder="Örn: Motorin 50 lt">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="saveVehicleFill('${vehicleId}')">Kaydet</button>
  `);
}

async function saveVehicleFill(vehicleId) {
  const amount = parseFloat(document.getElementById('vehFillAmount').value);
  const description = document.getElementById('vehFillDesc').value.trim();
  if (!amount || amount <= 0) return toast('Geçerli tutar girin');
  try {
    await api('POST', `/vehicles/${vehicleId}/fills`, { amount, description });
    closeModal();
    toast('Yakıt kaydedildi');
    showVehicleDetail(vehicleId);
  } catch (e) { toast(e.message); }
}

async function deleteVehicleFill(id, vehicleId) {
  if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
  try {
    await api('DELETE', `/vehicles/fills/${id}`);
    toast('Kayıt silindi');
    showVehicleDetail(vehicleId);
  } catch (e) { toast(e.message); }
}

// ===== SETTINGS =====
function showSettings() {
  openModal('Ayarlar — Şifre Değiştir', `
    <div class="form-group">
      <label>Mevcut Şifre</label>
      <input type="password" id="currentPassword" placeholder="••••••••">
    </div>
    <div class="form-group">
      <label>Yeni Şifre (min 6 karakter)</label>
      <input type="password" id="newPassword" placeholder="••••••••">
    </div>
    <div class="form-group">
      <label>Yeni Şifre Tekrar</label>
      <input type="password" id="newPassword2" placeholder="••••••••">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">İptal</button>
    <button class="btn btn-primary" onclick="changePassword()">Kaydet</button>
  `);
}

async function changePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const newPassword2 = document.getElementById('newPassword2').value;

  if (newPassword.length < 6) return toast('Yeni şifre en az 6 karakter olmalı');
  if (newPassword !== newPassword2) return toast('Yeni şifreler eşleşmiyor');

  try {
    await api('POST', '/settings/change-password', { currentPassword, newPassword });
    closeModal();
    toast('Şifre güncellendi');
  } catch (e) { toast(e.message); }
}

// ===== STAFF PERFORMANCE =====
async function showStaffPerformance() {
  setHeaderTitle('Pompacı Analizi');
  document.getElementById('mainContent').innerHTML =
    pageHeader('Pompacı Analizi') + '<div id="staffList"><p class="empty">Yükleniyor...</p></div>';

  try {
    const data = await api('GET', '/reports/staff-performance');
    const list = document.getElementById('staffList');
    if (!data.staff.length) {
      list.innerHTML = '<p class="empty">Veri yok</p>';
      return;
    }
    list.innerHTML = data.staff.map((s, i) => `
      <div class="staff-card">
        <div class="staff-header">
          <div class="staff-rank">${i + 1}</div>
          <div>
            <strong>${s.staff.name}</strong>
            ${isAdmin() && s.suspiciousCount > 0 ? `<span class="tx-badge suspicious">${s.suspiciousCount} şüpheli</span>` : ''}
          </div>
        </div>
        <div class="staff-row"><span>İşlem sayısı</span><strong>${s.transactionCount}</strong></div>
        <div class="staff-row"><span>Toplam ciro</span><strong>${fmt(s.totalAmount)}</strong></div>
        <div class="staff-row"><span>Ortalama işlem</span><strong>${fmt(s.averageAmount)}</strong></div>
        ${isAdmin() ? `<div class="staff-row"><span>Şüpheli oranı</span><strong>%${s.suspiciousRate}</strong></div>` : ''}
      </div>`).join('');
  } catch (e) {
    document.getElementById('staffList').innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

// ===== INIT =====
async function init() {
  if (token) {
    try {
      currentUser = await api('GET', '/auth/me');
      showApp();
      syncOfflineQueue();
      return;
    } catch {
      localStorage.removeItem('token');
      token = null;
    }
  }
  showLogin();
}

init();
