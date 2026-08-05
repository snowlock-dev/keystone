const APP_NAME    = "Keystone";
const APP_VERSION = "0.2";

console.log(
  "%cKeystone v" + APP_VERSION + " Initialized!%c\nStudy smart. Track everything.",
  "color: #8b5cf6; font-size: 20px; font-weight: 900;",
  "color: #6b7280; font-size: 12px; font-weight: normal;"
);

const SUBJECTS = [
  { key: 'physics', name: 'Physics',    icon: 'ph-magnet',     color: 'rgb(244,63,94)' },
  { key: 'chem',    name: 'Chemsitry',  icon: 'ph-atom',       color: 'rgb(59,130,246)'},
  { key: 'maths',   name: 'Maths',      icon: 'ph-calculator', color: 'rgb(139,92,246)'},
  { key: 'mocks',   name: 'Mock Tests', icon: 'ph-exam',       color: 'rgb(255,143,63)'}
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KEYBOARD_SHORTCUTS = {
  '1':'home', 
  '2':'taskflow', 
  '3':'tracker', 
  '4':'notes'
};

const DEFAULT_GOALS     = { hours: 4, minutes: 0, questions: 50 };
const DEFAULT_QUESTIONS = { phy: 0, chem: 0, maths: 0 };



/* --- UTILITY FUNCTIONS --- */



/* Formats date as YYYY-MM-DD (local time). Used as day key. */
function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} - ${String(d.getDate()).padStart(2, '0')}`;
}

/* Return a new Date set to 00:00:00 local time */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);

  return d;
}

/* Seconds -> "HH:MM:SS" */
function formatTime(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

/* Seconds -> "1h 30min" or "45min" */
function formatDurationShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* Debounce helper, because why not */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* Look up a subject definition by key (fallback to first). */
function subjectByKey(key) {
  return SUBJECTS.find(s => s.key === key) || SUBJECTS[0];
}