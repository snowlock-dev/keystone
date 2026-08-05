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
  '2':'tasks', 
  '3':'tracker', 
  '4':'notes'
};

const DEFAULT_GOALS     = { hours: 4, minutes: 0, questions: 50 };
const DEFAULT_QUESTIONS = { phy: 0, chem: 0, maths: 0 };



// --- UTILITY FUNCTIONS --- //



// Formats date as YYYY-MM-DD (local time). Used as day key
function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} - ${String(d.getDate()).padStart(2, '0')}`;
}

// Return a new Date set to 00:00:00 local time
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);

  return d;
}

// Seconds -> "HH:MM:SS"
function formatTime(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// Seconds -> "1h 30min" or "45min" 
function formatDurationShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Debounce helper, because why not 
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Look up a subject definition by key (fallback to first).
function subjectByKey(key) {
  return SUBJECTS.find(s => s.key === key) || SUBJECTS[0];
}


// --- STORAGE LAYER --- //


const Storage = {
  _cache: null,

  _defaultData() {
    return {
      notes: { content: '' },
      tracker: { goals: { ...DEFAULT_GOALS }, days: {} }
    };
  },

  read() {
    if (this._cache) return this._cache

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      this._cache = raw ? JSON.parse(raw) : this._defaultData();
    } catch (err) {
      console.error("Keystone: Storage Parse Error!")
    }
    return this._cache;
  },

  write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._cache));
      return true;
    } catch(err) {
      console.error("Keystone: Storage Write Error", err);
      return false;
    }
  },

  // Used by import
  replaceAll(data) {
    this._cache = data;
    this.write();
  },


  // -- Notes ------
  getNotes()       { return this.read().notes.content; },
  setNotes(text)   { this.read().notes.content = text; return this.write(); },
  clearNotes()     { this.read().notes.content = ''; this.write(); },

  // -- Goals ------
  getGoals()       { return this.read().tracker.goals; },
  setGoals(goals)  { this.read().tracker.goals = goals; this.write(); },

  // -- Per-day access ------

  // returns day record, creates it if missing
  _ensureDay(date) {
    const key = dayKey(date);
    const days = this.read().tracker.days;
    if (!days[key]) days[key] = { sessions: [], questions: { ...DEFAULT_QUESTIONS } };

    return days[key];
  },

  dayExists(date) {
    return !!this.read().tracker.days[dayKey(date)];
  },

  getQuestions(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? { ...DEFAULT_QUESTIONS, ...day.questions } : { ...DEFAULT_QUESTIONS };
  },

  setQuestions(date, q) {
    this._ensureDay(date).questions = q;
    this.write();
  },

  getSessions(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? day.sessions : [];
  },

  addSession(session) {
    this._ensureDay(new Date(session.end)).sessions.push(session);
    this.write();
  },

  removeSession(id) {
    const days = this.read().tracker.days;
    for (const key of Object.keys(days)) {
      const before = days[key].sessions.length;
      days[key].sessions = days[key].sessions.filter(s => s.id !== id);
      if (days[key].sessions.length !== before) {
        this.write();
        return true;
      }
    }
    return false;
  },

  // Flatten all sessions across all days.
  allSessions() {
    const out = [];
    for (const day of Object.values(this.read().tracker.days)) {
      out.push(...day.sessions);
    }
    return out;
  }
};


// --- DOM REFERENCES --- //


const $ = (id) => document.getElementById(id);

const DOM = {
  // Layout
  navItems:       document.querySelectorAll('.nav-item'),
  sectionViews:   document.querySelectorAll('.section-view'),
  toastContainer: $('toastContainer'),

  // Calendar
  calendarGrid: $('calendarGrid'),
  calMonthYear: $('calMonthYear'),
  calPrev:      $('calPrev'),
  calNext:      $('calNext'),

  // Notes
  notesInput:         $('notesInput'),
  notesSaveIndicator: $('notesSaveIndicator'),
  notesCount:         $('notesCount'),
  notesClearBtn:      $('notesClearBtn'),

  // Backup
  exportBtn:       $('exportBtn'),
  importBtn:       $('importBtn'),
  importFileInput: $('importFileInput'),

  // Time tracker
  subjectSelect:      $('subjectSelect'),
  sessionDesc:        $('sessionDesc'),
  activeTimerDisplay: $('activeTimerDisplay'),
  startBtn:           $('startBtn'),
  endBtn:             $('endBtn'),

  // TIme tracker: session log
  sessionLog:   $('sessionLog'),
  openModalBtn: $('openModalBtn'),

  // Time tracker: modal
  sessionModal:    $('sessionModal'),
  modalSubject:    $('modalSubject'),
  modalDuration:   $('modalDuration'),
  modalDesc:       $('modalDesc'),
  discardModalBtn: $('discardModalBtn'),
  saveModalBtn:    $('saveModalBtn'),

  // Dashboard: stats
  statMaxDay:         $('statMaxDay'),
  statAvgSession:     $('statAvgSession'),
  statAvgHrsDay:      $('statAvgHrsDay'),
  statTimeStreak:     $('statTimeStreak'),
  statQuestionStreak: $('statQuestionStreak'),

  // Dashboard: charts
  pieChart:  $('pieChart'),
  pieTotal:  $('pieTotal'),
  pieLegend: $('pieLegend'),
  barChart:  $('barChart'),

  // Goals & Questions
  goalHours:         $('goalHours'),
  goalMinutes:       $('goalMinutes'),
  questionsGoal:     $('questionsGoal'),
  qPhy:              $('qPhy'),
  qChem:             $('qChem'),
  qMaths:            $('qMaths'),
  timeGoalText:      $('timeGoalText'),
  questionsGoalText: $('questionsGoalText')
};


// --- TOAST NOTIFICATION --- //

function showToast(message, state = 'neutral') {
  const toast = document.createElement('div');
  toast.className = 'toast ' + state;
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- ROUTING --- //

let activeSection = 'home';

function switchSection(name) {
  activeSection = name;
  DOM.navItems.forEach(item =>
    item.classList.toggle('active', item.dataset.section === name)
  );
  DOM.sectionViews.forEach(view =>
    view.classList.toggle('active', view.dataset.section === name)
  );
}

DOM.navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection(item.dataset.section);
  });
});