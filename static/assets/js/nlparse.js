// Разбор фразы для быстрого добавления: «завтра в 19 кино с Машей»,
// «в пятницу в 10:30 стоматолог», «25.12 подарки», «послезавтра утром бег».
// Возвращает { title, date (YYYY-MM-DD | null), time (HH:MM | null) }.

// \w и \b в JS не понимают кириллицу — поэтому явные [а-яё]*
const WEEKDAYS = [
  [/понедельник[а-яё]*|пн/, 1], [/вторник[а-яё]*|вт/, 2], [/сред[ауые]|ср/, 3], [/четверг[а-яё]*|чт/, 4],
  [/пятниц[а-яё]*|пт/, 5], [/суббот[а-яё]*|сб/, 6], [/воскресень[а-яё]*|вс/, 0],
];
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const PARTS = { 'утром': '09:00', 'днём': '14:00', 'днем': '14:00', 'вечером': '19:00', 'ночью': '23:00' };

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function parsePhrase(text, todayIso) {
  let s = ` ${String(text || '').trim()} `;
  const today = new Date(`${todayIso}T12:00:00`);
  let date = null, time = null;
  const cut = re => { s = s.replace(re, ' '); };
  const low = () => s.toLowerCase();

  // время: «в 19», «в 19:30», «в 7 вечера», «19:00»
  let m = low().match(/\s(?:в|к)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(утра|дня|вечера|ночи)?(?=\s)/);
  if (!m) m = low().match(/\s(\d{1,2})[:.](\d{2})(?=\s)/);
  if (m) {
    let hh = Number(m[1]);
    const mm = Number(m[2] || 0);
    const part = m[3];
    if ((part === 'вечера' || part === 'дня') && hh < 12) hh += 12;
    if (part === 'ночи' && hh === 12) hh = 0;
    if (hh <= 23 && mm <= 59) {
      time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    }
  }
  if (!time) {
    for (const [word, t] of Object.entries(PARTS)) {
      const re = new RegExp(`\\s${word}(?=\\s)`, 'i');
      if (re.test(s)) { time = t; cut(re); break; }
    }
  }

  // дата
  const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  if (/\sпослезавтра(?=\s)/i.test(s)) { date = add(2); cut(/\sпослезавтра(?=\s)/i); }
  else if (/\sзавтра(?=\s)/i.test(s)) { date = add(1); cut(/\sзавтра(?=\s)/i); }
  else if (/\sсегодня(?=\s)/i.test(s)) { date = add(0); cut(/\sсегодня(?=\s)/i); }
  else if (/\sна выходных(?=\s)/i.test(s)) { date = add((6 - today.getDay() + 7) % 7 || 7); cut(/\sна выходных(?=\s)/i); }
  if (!date) {
    const dm = low().match(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/);
    if (dm) {
      const d = new Date(today);
      d.setMonth(Number(dm[2]) - 1, Number(dm[1]));
      if (dm[3]) d.setFullYear(Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]));
      else if (d < today) d.setFullYear(d.getFullYear() + 1);
      date = iso(d);
      s = s.slice(0, dm.index) + ' ' + s.slice(dm.index + dm[0].length);
    }
  }
  if (!date) {
    const dm = low().match(/\s(\d{1,2})\s+([а-яё]+)(?=\s)/);
    const mi = dm ? MONTHS.findIndex(p => dm[2].startsWith(p) && (p !== 'ма' || /^ма[яй]/.test(dm[2]))) : -1;
    if (dm && mi >= 0) {
      const d = new Date(today);
      d.setMonth(mi, Number(dm[1]));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      date = iso(d);
      s = s.slice(0, dm.index) + ' ' + s.slice(dm.index + dm[0].length);
    }
  }
  if (!date) {
    for (const [re, wd] of WEEKDAYS) {
      const full = new RegExp(`\\s(?:в|во)?\\s*(${re.source})(?=\\s)`, 'i');
      const hit = s.match(full);
      if (hit) {
        let diff = (wd - today.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        date = add(diff);
        s = s.slice(0, hit.index) + ' ' + s.slice(hit.index + hit[0].length);
        break;
      }
    }
  }
  const title = s.replace(/\s+/g, ' ').trim();
  return { title: title ? title[0].toUpperCase() + title.slice(1) : '', date, time };
}
