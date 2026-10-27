/**
 * بوصلة — تطبيق ويب لحساب اتجاه القبلة ومواقيت الصلاة
 * يعتمد على:
 *  - Adhan.js (حساب المواقيت والقبلة بدقة فلكية)
 *  - hijri-converter (تحويل التواريخ وفق تقويم أم القرى)
 *  - DeviceOrientation API (بوصلة حية)
 */

import {
  Coordinates,
  CalculationMethod,
  PrayerTimes,
  Qibla,
  Madhab,
  HighLatitudeRule,
} from 'https://unpkg.com/adhan/lib/bundles/adhan.esm.js';

import {
  gregorianToHijri,
  hijriToGregorian,
} from 'https://cdn.jsdelivr.net/npm/@tabby_ai/hijri-converter@1.0.5/+esm';

/* ==================== الحالة العامة ==================== */
const state = {
  coords: null,            // { latitude, longitude, altitude }
  heading: 0,              // الاتجاه الحالي بالدرجات
  qibla: 0,                // اتجاه القبلة بالدرجات
  currentDate: new Date(),
  method: 'MuslimWorldLeague',
  madhab: 'shafi',
  highLat: 'MiddleOfTheNight',
  offsets: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  compassEnabled: false,
  smoothHeading: null,
  prayerSource: 'local',
  sleepReminderTimer: null,
};

/* ==================== عناصر DOM ==================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  themeToggle: $('#themeToggle'),
  locateBtn: $('#locateBtn'),
  compassRing: $('#compassRing'),
  compassNeedle: $('#compassNeedle'),
  qiblaMarker: $('#qiblaMarker'),
  headingValue: $('#headingValue'),
  qiblaValue: $('#qiblaValue'),
  accuracyLabel: $('#accuracyLabel'),
  compassStatus: $('#compassStatus'),
  enableCompassBtn: $('#enableCompassBtn'),
  prevMonth: $('#prevMonth'),
  nextMonth: $('#nextMonth'),
  gregorianDate: $('#gregorianDate'),
  hijriDate: $('#hijriDate'),
  searchDate: $('#searchDate'),
  searchBtn: $('#searchBtn'),
  todayBtn: $('#todayBtn'),
  remindersList: $('#remindersList'),
  birthDate: $('#birthDate'),
  calendarType: $('#calendarType'),
  calcAgeBtn: $('#calcAgeBtn'),
  ageResult: $('#ageResult'),
  methodSelect: $('#methodSelect'),
  madhabSelect: $('#madhabSelect'),
  highLatSelect: $('#highLatSelect'),
  offsetGrid: $('#offsetGrid'),
  prayerTableBody: $('#prayerTableBody'),
  prayerSource: $('#prayerSource'),
  refreshPrayerBtn: $('#refreshPrayerBtn'),
  sleepTime: $('#sleepTime'),
  wakeTime: $('#wakeTime'),
  calcSleepBtn: $('#calcSleepBtn'),
  sleepResult: $('#sleepResult'),
};

/* ==================== أدوات مساعدة ==================== */
const prayerNames = {
  fajr: 'الفجر',
  sunrise: 'الشروق',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

const hijriMonths = [
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الثاني', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
];

function formatTime(date) {
  if (!date) return '—';
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateGregorian(date) {
  return date.toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateHijri(date) {
  return date.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function getHijriParts(date) {
  // استخدام Intl لاستخراج أجزاء التاريخ الهجري
  const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    year: 'numeric', month: 'numeric', day: 'numeric',
  });
  const parts = fmt.formatToParts(date);
  const obj = {};
  parts.forEach(({ type, value }) => { if (type !== 'literal') obj[type] = parseInt(value, 10); });
  return { year: obj.year, month: obj.month, day: obj.day };
}

function getDaysInGregorianMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/* ==================== تغيير الألوان ==================== */
const themes = ['dark', 'light', 'warm'];
let themeIndex = 0;

function applyTheme(index) {
  const theme = themes[index];
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('bousala-theme', theme);
}

els.themeToggle.addEventListener('click', () => {
  themeIndex = (themeIndex + 1) % themes.length;
  applyTheme(themeIndex);
});

// استعادة السمة المحفوظة
const savedTheme = localStorage.getItem('bousala-theme');
if (savedTheme) {
  themeIndex = themes.indexOf(savedTheme);
  if (themeIndex === -1) themeIndex = 0;
  applyTheme(themeIndex);
}

/* ==================== تحديد الموقع ==================== */
function setLocation(lat, lon, alt = 0) {
  state.coords = { latitude: lat, longitude: lon, altitude: alt };
  localStorage.setItem('bousala-coords', JSON.stringify(state.coords));
  updateAll();
}

function requestLocation() {
  if (!navigator.geolocation) {
    els.compassStatus.textContent = 'المتصفح لا يدعم تحديد الموقع.';
    return;
  }
  els.compassStatus.textContent = 'جارٍ تحديد موقعك…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude || 0);
      els.compassStatus.textContent = 'تم تحديد الموقع. يمكنك تفعيل البوصلة.';
    },
    (err) => {
      els.compassStatus.textContent = 'تعذر تحديد الموقع: ' + err.message;
      // استخدام إحداثيات افتراضية (مكة) للاختبار
      if (!state.coords) setLocation(21.4225, 39.8262);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

els.locateBtn.addEventListener('click', requestLocation);

// استعادة الإحداثيات المحفوظة
const savedCoords = localStorage.getItem('bousala-coords');
if (savedCoords) {
  try { state.coords = JSON.parse(savedCoords); } catch (e) { /* ignore */ }
}

/* ==================== البوصلة ==================== */
let compassPermissionGranted = false;

function smoothAngle(prev, next, factor = 0.15) {
  if (prev === null) return next;
  let diff = next - prev;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return (prev + diff * factor + 360) % 360;
}

function handleOrientation(event) {
  if (!state.compassEnabled) return;

  let heading = null;
  let accuracy = null;

  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading; // iOS
    accuracy = event.webkitCompassAccuracy;
  } else if (event.absolute && event.alpha !== null) {
    heading = (360 - event.alpha) % 360;
    accuracy = event.alpha; // تقريبي
  }

  if (heading === null) return;

  state.smoothHeading = smoothAngle(state.smoothHeading, heading, 0.2);
  state.heading = state.smoothHeading;

  // تحديث الواجهة
  els.headingValue.textContent = `${Math.round(state.heading)}°`;
  els.compassNeedle.style.transform = `rotate(${state.heading}deg)`;

  if (state.qibla) {
    const qiblaRelative = (state.qibla - state.heading + 360) % 360;
    els.qiblaMarker.style.transform = `rotate(${qiblaRelative}deg)`;
    els.qiblaValue.textContent = `${Math.round(state.qibla)}°`;
  }

  if (accuracy !== null && !isNaN(accuracy)) {
    els.accuracyLabel.textContent = `الدقة: ±${Math.round(accuracy)}°`;
  } else {
    els.accuracyLabel.textContent = 'الدقة: غير متاحة';
  }
}

async function enableCompass() {
  if (state.compassEnabled) return;

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        els.compassStatus.textContent = 'لم يتم منح إذن البوصلة.';
        return;
      }
    } catch (e) {
      els.compassStatus.textContent = 'تعذر طلب إذن البوصلة.';
      return;
    }
  }

  state.compassEnabled = true;
  els.compassStatus.textContent = 'البوصلة مفعّلة. حرّك جهازك لمعايرة الاتجاه.';

  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
  }
}

els.enableCompassBtn.addEventListener('click', enableCompass);

/* ==================== حساب القبلة ==================== */
function updateQibla() {
  if (!state.coords) return;
  const coords = new Coordinates(state.coords.latitude, state.coords.longitude);
  state.qibla = Qibla(coords);
  els.qiblaValue.textContent = `${Math.round(state.qibla)}°`;
}

/* ==================== التقويم ==================== */
function updateCalendar(date) {
  state.currentDate = date;
  els.gregorianDate.textContent = formatDateGregorian(date);
  els.hijriDate.textContent = formatDateHijri(date);
  renderReminders(date);
  // تحديث مواقيت الصلاة إذا كان الموقع متاحًا
  if (state.coords) renderPrayerTimes();
}

function renderReminders(date) {
  const year = date.getFullYear();
  const reminders = [];

  // عيد الفطر: 1 شوال
  const eidFitr = hijriToGregorian({ year: getHijriParts(date).year, month: 10, day: 1 });
  // عيد الأضحى: 10 ذو الحجة
  const eidAdha = hijriToGregorian({ year: getHijriParts(date).year, month: 12, day: 10 });
  // يوم عرفة: 9 ذو الحجة
  const arafah = hijriToGregorian({ year: getHijriParts(date).year, month: 12, day: 9 });

  const events = [
    { name: 'عيد الفطر', date: eidFitr },
    { name: 'يوم عرفة', date: arafah },
    { name: 'عيد الأضحى', date: eidAdha },
  ];

  events.forEach(ev => {
    const evDate = new Date(ev.date.year, ev.date.month - 1, ev.date.day);
    const diffDays = Math.ceil((evDate - date) / (1000 * 60 * 60 * 24));
    let status = '';
    if (diffDays === 0) status = 'اليوم';
    else if (diffDays > 0) status = `بعد ${diffDays} يوم`;
    else status = 'مضى';
    reminders.push({ name: ev.name, status, date: evDate });
  });

  els.remindersList.innerHTML = reminders
    .map(r => `<li><strong>${r.name}</strong><span>${r.status} — ${formatDateGregorian(r.date)}</span></li>`)
    .join('');
}

function changeMonth(offset) {
  const d = new Date(state.currentDate);
  d.setMonth(d.getMonth() + offset);
  updateCalendar(d);
}

els.prevMonth.addEventListener('click', () => changeMonth(-1));
els.nextMonth.addEventListener('click', () => changeMonth(1));

els.searchBtn.addEventListener('click', () => {
  const val = els.searchDate.value;
  if (val) {
    const [y, m, d] = val.split('-').map(Number);
    updateCalendar(new Date(y, m - 1, d));
  }
});

els.todayBtn.addEventListener('click', () => updateCalendar(new Date()));

/* ==================== حاسبة العمر ==================== */
function calculateAge(birthDate, birthCalendar = 'gregorian') {
  let birth;
  if (birthCalendar === 'hijri') {
    const parts = els.birthDate.value.split('-').map(Number);
    // نفترض أن الإدخال الهجري بصيغة YYYY-MM-DD
    const g = hijriToGregorian({ year: parts[0], month: parts[1], day: parts[2] });
    birth = new Date(g.year, g.month - 1, g.day);
  } else {
    birth = new Date(birthDate);
  }

  const today = new Date();

  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  let days = today.getDate() - birth.getDate();

  if (days < 0) {
    months--;
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months, days };
}

els.calcAgeBtn.addEventListener('click', () => {
  const val = els.birthDate.value;
  if (!val) {
    els.ageResult.textContent = 'يرجى إدخال تاريخ الميلاد.';
    return;
  }
  const type = els.calendarType.value;
  const age = calculateAge(val, type);
  els.ageResult.textContent = `العمر: ${age.years} سنة، ${age.months} شهرًا، ${age.days} يومًا.`;
});

/* ==================== مواقيت الصلاة ==================== */
function getCalculationParams() {
  let params;
  switch (state.method) {
    case 'NorthAmerica': params = CalculationMethod.NorthAmerica(); break;
    case 'Egyptian': params = CalculationMethod.Egyptian(); break;
    case 'UmmAlQura': params = CalculationMethod.UmmAlQura(); break;
    case 'Karachi': params = CalculationMethod.Karachi(); break;
    default: params = CalculationMethod.MuslimWorldLeague();
  }
  params.madhab = state.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule = HighLatitudeRule[state.highLat];
  return params;
}

function applyOffsets(times) {
  const result = {};
  const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  keys.forEach(k => {
    if (times[k] instanceof Date) {
      const offset = state.offsets[k] || 0;
      result[k] = new Date(times[k].getTime() + offset * 60000);
    } else {
      result[k] = times[k];
    }
  });
  return result;
}

function renderPrayerTimes() {
  if (!state.coords) {
    els.prayerTableBody.innerHTML = '<tr><td colspan="2">يرجى تحديد الموقع أولاً.</td></tr>';
    return;
  }

  const coords = new Coordinates(state.coords.latitude, state.coords.longitude);
  const params = getCalculationParams();
  const date = state.currentDate;

  let prayerTimes;
  try {
    prayerTimes = new PrayerTimes(coords, date, params);
  } catch (e) {
    els.prayerTableBody.innerHTML = '<tr><td colspan="2">تعذر حساب المواقيت.</td></tr>';
    return;
  }

  const times = {
    fajr: prayerTimes.fajr,
    sunrise: prayerTimes.sunrise,
    dhuhr: prayerTimes.dhuhr,
    asr: prayerTimes.asr,
    maghrib: prayerTimes.maghrib,
    isha: prayerTimes.isha,
  };

  const adjusted = applyOffsets(times);

  els.prayerTableBody.innerHTML = Object.entries(prayerNames)
    .map(([key, name]) => {
      const time = adjusted[key];
      return `<tr><td>${name}</td><td>${formatTime(time)}</td></tr>`;
    })
    .join('');

  els.prayerSource.textContent = 'المصدر: حساب محلي (Adhan.js).';
  state.prayerSource = 'local';
}

function renderOffsetsInputs() {
  const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  els.offsetGrid.innerHTML = keys.map(k => `
    <div>
      <label for="offset-${k}">${prayerNames[k]} (دقائق)</label>
      <input type="number" id="offset-${k}" value="${state.offsets[k] || 0}" min="-30" max="30" step="1" data-key="${k}">
    </div>
  `).join('');

  els.offsetGrid.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      state.offsets[inp.dataset.key] = parseInt(inp.value, 10) || 0;
      renderPrayerTimes();
    });
  });
}

els.methodSelect.addEventListener('change', () => {
  state.method = els.methodSelect.value;
  renderPrayerTimes();
});

els.madhabSelect.addEventListener('change', () => {
  state.madhab = els.madhabSelect.value;
  renderPrayerTimes();
});

els.highLatSelect.addEventListener('change', () => {
  state.highLat = els.highLatSelect.value;
  renderPrayerTimes();
});

els.refreshPrayerBtn.addEventListener('click', renderPrayerTimes);

/* ==================== تذكير النوم ==================== */
function calcSleepDuration() {
  const sleep = els.sleepTime.value;
  const wake = els.wakeTime.value;
  if (!sleep || !wake) {
    els.sleepResult.textContent = 'يرجى إدخال وقتي النوم والاستيقاظ.';
    return;
  }
  const [sh, sm] = sleep.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let sleepMinutes = sh * 60 + sm;
  let wakeMinutes = wh * 60 + wm;
  if (wakeMinutes <= sleepMinutes) wakeMinutes += 24 * 60; // في اليوم التالي
  const diff = wakeMinutes - sleepMinutes;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  els.sleepResult.textContent = `مدة النوم: ${hours} ساعة و${mins} دقيقة.`;
}

els.calcSleepBtn.addEventListener('click', calcSleepDuration);

/* ==================== تحديث شامل ==================== */
function updateAll() {
  updateCalendar(state.currentDate);
  updateQibla();
  renderPrayerTimes();
}

/* ==================== التهيئة الأولية ==================== */
function init() {
  renderOffsetsInputs();
  updateAll();

  // إذا لم تكن هناك إحداثيات محفوظة، اطلب الموقع تلقائيًا؟ (اختياري)
  if (!state.coords) {
    els.compassStatus.textContent = 'اضغط "تحديد الموقع" للبدء.';
  } else {
    els.compassStatus.textContent = 'الموقع محفوظ. اضغط "تفعيل البوصلة".';
  }
}

init();

/* ==================== تصدير للاختبار (اختياري) ==================== */
if (typeof window !== 'undefined') {
  window.__bousala = {
    calculateAge,
    getHijriParts,
    formatTime,
    state,
  };
}
