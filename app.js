'use strict';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const DEFAULTS = {
  method: 'Turkey',
  madhab: 'shafi',
  adjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  theme: 'dark',
  notifications: false,
  birthdate: null,
};

const state = {
  coords: null,
  heading: null,
  qiblaBearing: null,
  times: null,
  settings: { ...DEFAULTS },
};

const PRAYERS = [
  { key: 'fajr', name: 'الفجر' },
  { key: 'sunrise', name: 'الشروق' },
  { key: 'dhuhr', name: 'الظهر' },
  { key: 'asr', name: 'العصر' },
  { key: 'maghrib', name: 'المغرب' },
  { key: 'isha', name: 'العشاء' },
];

/* ============ Storage ============ */
function loadSettings() {
  try {
    const raw = localStorage.getItem('bousala-settings');
    if (raw) state.settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { console.warn(e); }
}
function saveSettings() {
  try { localStorage.setItem('bousala-settings', JSON.stringify(state.settings)); }
  catch (e) { console.warn(e); }
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadSettings();
  document.documentElement.dataset.theme = state.settings.theme;

  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#menuBtn').addEventListener('click', () => $('#sheet').classList.add('open'));
  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet') $('#sheet').classList.remove('open');
  });
  $$('.sheet-content button').forEach(b => b.addEventListener('click', () => {
    handleMenuAction(b.dataset.action);
    $('#sheet').classList.remove('open');
  }));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }

  buildSettingsUI();

  if (typeof adhan === 'undefined') {
    toast('⚠️ يلزم اتصال بالإنترنت لمرة أولى');
  } else {
    await getLocation();
  }

  setInterval(updateCountdown, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateCountdown();
      if (state.coords) computeTimes();
    }
  });
}

/* ============ Location ============ */
function getLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { toast('GPS غير مدعوم'); resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        computeTimes(); computeQibla();
        toast('📍 تم تحديد الموقع');
        resolve();
      },
      () => {
        toast('⚠️ تعذر الموقع — استخدام مكة احتياطًا');
        state.coords = { lat: 21.4225, lng: 39.8262 };
        computeTimes(); computeQibla();
        resolve();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

/* ============ Prayer Times ============ */
function getParams() {
  const M = adhan.CalculationMethod;
  const map = {
    Turkey: M.Turkey, UmmAlQura: M.UmmAlQura, MuslimWorldLeague: M.MuslimWorldLeague,
    Egyptian: M.Egyptian, Karachi: M.Karachi, Dubai: M.Dubai, Qatar: M.Qatar,
    Kuwait: M.Kuwait, Singapore: M.Singapore, NorthAmerica: M.NorthAmerica,
    MoonsightingCommittee: M.MoonsightingCommittee,
  };
  const p = (map[state.settings.method] || M.Turkey)();
  p.madhab = state.settings.madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  p.adjustments = { ...state.settings.adjustments };
  return p;
}

function computeTimes() {
  if (!state.coords || typeof adhan === 'undefined') return;
  const c = new adhan.Coordinates(state.coords.lat, state.coords.lng);
  state.times = new adhan.PrayerTimes(c, new Date(), getParams());
  renderTimes();
  updateCountdown();
  if (state.settings.notifications) scheduleNotifications();
}

function renderTimes() {
  if (!state.times) return;
  const next = state.times.nextPrayer();
  $('#prayerList').innerHTML = PRAYERS.map(p => `
    <li class="prayer-item ${p.key === next ? 'next' : ''}">
      <span class="prayer-name">${p.name}</span>
      <span class="prayer-time">${fmt(state.times.timeForPrayer(p.key))}</span>
    </li>`).join('');

  const now = new Date();
  $('#gregorianDate').textContent = new Intl.DateTimeFormat('ar-SA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(now);
  $('#hijriDate').textContent = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    year: 'numeric', month: 'long', day: 'numeric'
  }).format(now);
}

function fmt(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('ar-SA', {
    hour: '2-digit', minute: '2-digit', hour12: true
  }).format(date);
}

function updateCountdown() {
  if (!state.times || !state.coords) return;
  const now = new Date();
  const next = state.times.nextPrayer();
  const names = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  let target = next === 'none' ? null : state.times.timeForPrayer(next);
  let name = names[next] || 'الفجر';

  if (!target) {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    const c = new adhan.Coordinates(state.coords.lat, state.coords.lng);
    const tomorrow = new adhan.PrayerTimes(c, t, getParams());
    target = tomorrow.fajr;
    name = 'الفجر';
  }

  $('#nextName').textContent = name;
  $('#nextTime').textContent = fmt(target);
  const diff = target - now;
  if (diff <= 0) { $('#countdown').textContent = '—'; return; }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  $('#countdown').textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const pad = n => String(n).padStart(2, '0');

/* ============ Qibla ============ */
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function computeQibla() {
  if (!state.coords) return;
  const kaaba = { lat: 21.4225, lng: 39.8262 };
  const φ1 = toRad(state.coords.lat), φ2 = toRad(kaaba.lat);
  const Δλ = toRad(kaaba.lng - state.coords.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  state.qiblaBearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  $('#qiblaAngle').textContent = state.qiblaBearing.toFixed(1) + '°';
  updateCompass();
}

function ensureRose() {
  let rose = $('#rose');
  if (!rose) {
    rose = document.createElement('div');
    rose.className = 'rose'; rose.id = 'rose';
    rose.innerHTML = `
      <span class="cardinal n">N</span>
      <span class="cardinal e">E</span>
      <span class="cardinal s">S</span>
      <span class="cardinal w">W</span>
      <div class="qibla-needle"></div>`;
    $('#compass').appendChild(rose);
  }
  return rose;
}

function updateCompass() {
  if (!state.qiblaBearing) return;
  const rose = ensureRose();
  const heading = state.heading || 0;
  rose.style.transform = `rotate(${-heading}deg)`;
  rose.querySelector('.qibla-needle').style.transform = `rotate(${state.qiblaBearing}deg)`;

  $('#headingVal').textContent = heading.toFixed(0) + '°';
  const diff = ((state.qiblaBearing - heading + 540) % 360) - 180;
  const msg = $('#alignMsg');
  if (Math.abs(diff) < 5) {
    msg.textContent = '✓ أنت تواجه القبلة';
    msg.style.color = '#34d399';
  } else if (diff > 0) {
    msg.textContent = `↻ أدر الجهاز يمينًا ${Math.abs(diff).toFixed(0)}°`;
    msg.style.color = '';
  } else {
    msg.textContent = `↺ أدر الجهاز يسارًا ${Math.abs(diff).toFixed(0)}°`;
    msg.style.color = '';
  }
}

function setupCompass() {
  const attach = () => {
    window.addEventListener('deviceorientationabsolute', e => {
      if (e.webkitCompassHeading != null) state.heading = e.webkitCompassHeading;
      else if (e.alpha != null) state.heading = (360 - e.alpha) % 360;
      else return;
      updateCompass();
    });
    window.addEventListener('deviceorientation', e => {
      if (e.webkitCompassHeading != null) { state.heading = e.webkitCompassHeading; updateCompass(); }
    });
  };
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(r => { if (r === 'granted') attach(); })
      .catch(() => toast('⚠️ يلزم السماح بالبوصلة'));
  } else attach();
}

/* ============ Settings UI ============ */
function buildSettingsUI() {
  $('#tab-settings').innerHTML = `
    <div class="settings-group">
      <h3>🕌 طريقة الحساب</h3>
      <div class="field">
        <select id="methodSelect">
          <option value="Turkey">Diyanet / إسطنبول</option>
          <option value="UmmAlQura">أم القرى</option>
          <option value="MuslimWorldLeague">رابطة العالم الإسلامي</option>
          <option value="Egyptian">الهيئة المصرية</option>
          <option value="Karachi">كراتشي</option>
          <option value="Dubai">دبي</option>
          <option value="Qatar">قطر</option>
          <option value="Kuwait">الكويت</option>
          <option value="Singapore">سنغافورة</option>
          <option value="NorthAmerica">أمريكا الشمالية</option>
          <option value="MoonsightingCommittee">لجنة رؤية الهلال</option>
        </select>
      </div>
      <div class="field">
        <label>مذهب العصر</label>
        <select id="madhabSelect">
          <option value="shafi">شافعي / مالكي / حنبلي</option>
          <option value="hanafi">حنفي</option>
        </select>
      </div>
    </div>

    <div class="settings-group">
      <h3>⏱️ تعديلات يدوية (دقائق)</h3>
      <div id="adjustmentsContainer"></div>
    </div>

    <div class="settings-group">
      <h3>🎨 الثيم</h3>
      <div class="field">
        <select id="themeSelect">
          <option value="dark">داكن</option>
          <option value="light">فاتح</option>
          <option value="emerald">زمردي</option>
        </select>
      </div>
    </div>

    <div class="settings-group">
      <h3>🔔 الإشعارات</h3>
      <div class="toggle-row">
        <span>تذكيرات الصلاة</span>
        <div class="toggle ${state.settings.notifications ? 'on' : ''}" id="notifToggle"></div>
      </div>
    </div>

    <div class="settings-group">
      <h3>🎂 حساب العمر</h3>
      <div class="field">
        <label>تاريخ الميلاد</label>
        <input type="date" id="birthdateInput" value="${state.settings.birthdate || ''}">
      </div>
      <div id="ageDisplay"></div>
    </div>
  `;

  $('#methodSelect').value = state.settings.method;
  $('#madhabSelect').value = state.settings.madhab;
  $('#themeSelect').value = state.settings.theme;

  $('#methodSelect').onchange = e => {
    state.settings.method = e.target.value; saveSettings(); computeTimes();
  };
  $('#madhabSelect').onchange = e => {
    state.settings.madhab = e.target.value; saveSettings(); computeTimes();
  };
  $('#themeSelect').onchange = e => {
    state.settings.theme = e.target.value;
    document.documentElement.dataset.theme = e.target.value;
    saveSettings();
  };
  $('#notifToggle').onclick = async e => {
    const t = e.currentTarget;
    if (!state.settings.notifications) {
      if (!('Notification' in window)) { toast('الإشعارات غير مدعومة'); return; }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        state.settings.notifications = true;
        t.classList.add('on'); saveSettings(); scheduleNotifications();
        toast('🔔 تم تفعيل التذكيرات');
      } else toast('⚠️ يرجى السماح من إعدادات المتصفح');
    } else {
      state.settings.notifications = false;
      t.classList.remove('on'); saveSettings();
    }
  };
  $('#birthdateInput').onchange = e => {
    state.settings.birthdate = e.target.value; saveSettings(); showAge();
  };

  buildAdjustmentsUI();
  if (state.settings.birthdate) showAge();
}

function buildAdjustmentsUI() {
  const c = $('#adjustmentsContainer');
  c.innerHTML = PRAYERS.map(p => `
    <div class="adjust-row">
      <span>${p.name}</span>
      <input type="number" min="-60" max="60" value="${state.settings.adjustments[p.key] || 0}" data-key="${p.key}">
    </div>`).join('');
  c.querySelectorAll('input').forEach(inp => {
    inp.onchange = e => {
      state.settings.adjustments[e.target.dataset.key] = parseInt(e.target.value) || 0;
      saveSettings(); computeTimes();
    };
  });
}

function showAge() {
  const el = $('#ageDisplay');
  if (!state.settings.birthdate) { el.textContent = ''; return; }
  const b = new Date(state.settings.birthdate), n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  let m = n.getMonth() - b.getMonth();
  let d = n.getDate() - b.getDate();
  if (d < 0) { m--; d += new Date(n.getFullYear(), n.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  el.textContent = `العمر: ${y} سنة و${m} شهر و${d} يوم`;
}

/* ============ Menu ============ */
function handleMenuAction(a) {
  switch (a) {
    case 'sync':
      if (state.coords) { computeTimes(); toast('✓ تم تزامن الوقت والمواقيت'); }
      else getLocation();
      break;
    case 'locate':
      getLocation();
      break;
    case 'theme': {
      const arr = ['dark', 'light', 'emerald'];
      const i = arr.indexOf(state.settings.theme);
      state.settings.theme = arr[(i + 1) % arr.length];
      document.documentElement.dataset.theme = state.settings.theme;
      saveSettings(); toast('🎨 تم تبديل الثيم');
      break;
    }
    case 'notifications':
      switchTab('settings');
      setTimeout(() => $('#notifToggle')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      break;
    case 'backup':
      exportBackup();
      break;
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bousala-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('💾 تم تصدير النسخة الاحتياطية');
}

/* ============ Navigation ============ */
function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
  if (tab === 'qibla') { setupCompass(); updateCompass(); }
}

/* ============ Notifications ============ */
function scheduleNotifications() {
  if (!state.settings.notifications || !state.times) return;
  const names = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  const now = Date.now();
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
    const t = state.times.timeForPrayer(p);
    if (!t) return;
    const delay = t.getTime() - now;
    if (delay > 0 && delay < 24 * 3600000) {
      setTimeout(() => {
        if (Notification.permission !== 'granted') return;
        navigator.serviceWorker.ready
          .then(reg => reg.showNotification('حان وقت ' + names[p], {
            body: 'اللهم اجعلنا من المقيمين للصلاة',
            icon: './icons/icon.svg',
            badge: './icons/icon.svg',
            tag: 'prayer-' + p,
            vibrate: [200, 100, 200],
          }))
          .catch(() => new Notification('حان وقت ' + names[p]));
      }, delay);
    }
  });
}

/* ============ Toast ============ */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
