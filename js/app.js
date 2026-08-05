const APP_NAME    = "Keystone";
const APP_VERSION = "0.2";
const STORAGE_KEY = "keystone";
const DAY_MS      = 86_400_000;

const SUBJECTS = [
  { key: 'physics', name: 'Physics',    icon: 'ph-magnet',     color: 'rgb(244, 63, 94)' },
  { key: 'chem',    name: 'Chemistry',  icon: 'ph-atom',       color: 'rgb(59, 130, 246)' },
  { key: 'maths',   name: 'Maths',      icon: 'ph-calculator', color: 'rgb(139, 92, 246)' },
  { key: 'mock',    name: 'Mock Tests', icon: 'ph-exam',       color: 'rgb(255, 143, 63)' }
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Return a new Date set to 00:00:00 local time
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Seconds -> "HH:MM:SS"
function formatTime(sec) {
  const h = Math.floor(sec / 3600);
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
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this._cache = raw ? JSON.parse(raw) : this._defaultData();
    } catch (err) {
      console.error("Keystone: storage parse error", err);
      this._cache = this._defaultData();
    }
    return this._cache;
  },

  write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._cache));
      return true;
    } catch (err) {
      console.error("Keystone: storage write error", err);
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
    const key  = dayKey(date);
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


// --- CALENDAR --- //
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function navigateCalendar(delta) {
  DOM.calendarGrid.classList.add('fade-out');
  setTimeout(() => {
    calMonth += delta;
    if (calMonth < 0)  { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0;  calYear++; }
    renderCalendar();
    DOM.calendarGrid.classList.remove('fade-out');
  }, 200);
}

function renderCalendar() {
  DOM.calMonthYear.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  DOM.calendarGrid.innerHTML = '';

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(calYear, calMonth, d);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (isSameDay(dateObj, today)) cell.classList.add('today');
    cell.innerHTML = `
      <span class="cal-dow">${DAY_NAMES_SHORT[dateObj.getDay()]}</span>
      <span class="cal-date">${d}</span>
    `;
    DOM.calendarGrid.appendChild(cell);
  }
}

DOM.calPrev.addEventListener('click', () => navigateCalendar(-1));
DOM.calNext.addEventListener('click', () => navigateCalendar(1));
renderCalendar();


// -- NOTES -- //
const saveNotesDebounced = debounce(() => {
  if (Storage.setNotes(DOM.notesInput.value)) {
    DOM.notesSaveIndicator.textContent = 'All changes saved';
    DOM.notesSaveIndicator.classList.remove('saving');
  } else {
    DOM.notesSaveIndicator.textContent = 'Save failed';
  }
}, 500);

function updateNotesCount() {
  const text  = DOM.notesInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  DOM.notesCount.textContent =
    `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
}

function handleNotesChange() {
  DOM.notesSaveIndicator.textContent = 'Saving...';
  DOM.notesSaveIndicator.classList.add('saving');
  saveNotesDebounced();
  updateNotesCount();
}

// Two-click confirmation for clearing notes
let notesClearConfirm = false;
let notesClearTimer   = null;

function handleNotesClear() {
  if (!DOM.notesInput.value.trim()) return;

  if (!notesClearConfirm) {
    // First click — arm confirmation
    notesClearConfirm = true;
    DOM.notesClearBtn.classList.add('confirm');
    DOM.notesClearBtn.innerHTML = '<i class="ph-fill ph-check-fat"></i>';
    showToast('Click again to confirm clearing notes', 'neutral');
    clearTimeout(notesClearTimer);
    notesClearTimer = setTimeout(() => {
      notesClearConfirm = false;
      DOM.notesClearBtn.classList.remove('confirm');
      DOM.notesClearBtn.innerHTML = '<i class="ph ph-trash"></i>';
    }, 3000);
    return;
  }

  // Second click — actually clear
  clearTimeout(notesClearTimer);
  notesClearConfirm = false;
  DOM.notesClearBtn.classList.remove('confirm');
  DOM.notesClearBtn.innerHTML = '<i class="ph ph-trash"></i>';
  DOM.notesInput.value = '';
  Storage.clearNotes();
  DOM.notesSaveIndicator.textContent = 'All changes saved';
  DOM.notesSaveIndicator.classList.remove('saving');
  updateNotesCount();
  showToast('Notes cleared', 'success');
}

// Init notes
DOM.notesInput.value = Storage.getNotes();
DOM.notesSaveIndicator.textContent = 'All changes saved';
DOM.notesSaveIndicator.classList.remove('saving');
updateNotesCount();

DOM.notesInput.addEventListener('input', handleNotesChange);
DOM.notesClearBtn.addEventListener('click', handleNotesClear);

// Tab inserts two spaces inside the textarea
DOM.notesInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = DOM.notesInput;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + 2;
  handleNotesChange();
});


// TRACKER: ACTIVE SESSION (in-memory only, not persisted)
const activeTracker = {
  subject:           'physics',
  description:       '',
  startedAt:         null,   // ms timestamp of current run start
  pausedAccumulated: 0,      // seconds accumulated before current run
  isPaused:          false
};

function resetActiveTracker() {
  activeTracker.subject           = 'physics';
  activeTracker.description       = '';
  activeTracker.startedAt         = null;
  activeTracker.pausedAccumulated = 0;
  activeTracker.isPaused          = false;
}

function getActiveElapsedSec() {
  if (!activeTracker.startedAt) return activeTracker.pausedAccumulated;
  return activeTracker.pausedAccumulated + Math.floor((Date.now() - activeTracker.startedAt) / 1000);
}

function updateTimerUI() {
  const elapsed   = getActiveElapsedSec();
  const isRunning = !!activeTracker.startedAt;

  DOM.activeTimerDisplay.textContent = formatTime(elapsed);
  DOM.activeTimerDisplay.classList.toggle('running', isRunning);

  DOM.startBtn.innerHTML = isRunning
    ? '<i class="ph-fill ph-pause"></i>'
    : '<i class="ph-fill ph-play"></i>';
  DOM.startBtn.classList.toggle('pause', isRunning);
  DOM.startBtn.classList.toggle('start', !isRunning);

  DOM.endBtn.disabled         = !isRunning && !activeTracker.isPaused;
  DOM.subjectSelect.disabled  = isRunning;
  DOM.sessionDesc.disabled    = isRunning;
}

// Start / Pause toggle
DOM.startBtn.addEventListener('click', () => {
  if (activeTracker.startedAt) {
    // Pause
    activeTracker.pausedAccumulated = getActiveElapsedSec();
    activeTracker.startedAt = null;
    activeTracker.isPaused  = true;
  } else {
    // Start or resume
    if (!activeTracker.isPaused) {
      activeTracker.subject           = DOM.subjectSelect.value;
      activeTracker.description       = DOM.sessionDesc.value.trim();
      activeTracker.pausedAccumulated = 0;
    }
    activeTracker.startedAt = Date.now();
    activeTracker.isPaused  = false;
  }
  updateTimerUI();
});

// End & log
DOM.endBtn.addEventListener('click', () => {
  const duration = getActiveElapsedSec();
  if (duration > 5) {
    const now   = new Date();
    const start = new Date(now.getTime() - duration * 1000);
    Storage.addSession({
      id:          now.getTime().toString(36),
      subject:     activeTracker.subject,
      description: activeTracker.description,
      start:       start.toISOString(),
      end:         now.toISOString(),
      duration
    });
    showToast(`Session logged: ${formatDurationShort(duration)}`, 'success');
  }

  resetActiveTracker();
  DOM.sessionDesc.value   = '';
  DOM.subjectSelect.value = 'physics';

  updateTimerUI();
  renderAll();
});

// Tick every second while running
setInterval(() => {
  if (activeTracker.startedAt) updateTimerUI();
}, 1000);

updateTimerUI();


// -- TRACKER: SESSION LOG -- //
function renderSessionLog() {
  const todaySessions = Storage.getSessions(new Date())
    .slice()
    .sort((a, b) => new Date(b.end) - new Date(a.end));

  DOM.sessionLog.innerHTML = '';

  if (todaySessions.length === 0) {
    DOM.sessionLog.innerHTML =
      '<div style="text-align:center;padding:2rem 1rem;color:var(--muted);font-size:0.85rem">' +
      'No sessions logged today. Get started!</div>';
    return;
  }

  for (const s of todaySessions) {
    const subj = subjectByKey(s.subject);
    const time = new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-item-icon" style="background:${subj.color}22;color:${subj.color}">
        <i class="ph-fill ${subj.icon}"></i>
      </div>
      <div class="log-item-info">
        <div class="log-item-subject">${subj.name}</div>
        <div class="log-item-desc">${s.description || 'Ended at ' + time}</div>
      </div>
      <div class="log-item-duration">${formatDurationShort(s.duration)}</div>
      <button class="log-item-delete" data-id="${s.id}" aria-label="Delete session">
        <i class="ph ph-x"></i>
      </button>
    `;
    DOM.sessionLog.appendChild(item);
  }
}

// Delete via event delegation
DOM.sessionLog.addEventListener('click', (e) => {
  const btn = e.target.closest('.log-item-delete');
  if (!btn) return;
  Storage.removeSession(btn.dataset.id);
  renderAll();
  showToast('Session deleted', 'success');
});


// -- TRACKER: MANUAL SESSION MODAL -- //
DOM.openModalBtn.addEventListener('click', () => {
  DOM.modalSubject.value  = 'physics';
  DOM.modalDuration.value = 30;
  DOM.modalDesc.value     = '';
  DOM.sessionModal.classList.add('active');
});

DOM.discardModalBtn.addEventListener('click', () => {
  DOM.sessionModal.classList.remove('active');
});

DOM.sessionModal.addEventListener('click', (e) => {
  if (e.target === DOM.sessionModal) {
    DOM.sessionModal.classList.remove('active');
  }
});

DOM.saveModalBtn.addEventListener('click', () => {
  const subject     = DOM.modalSubject.value;
  const durationMin = parseInt(DOM.modalDuration.value, 10);
  const desc        = DOM.modalDesc.value.trim();

  if (isNaN(durationMin) || durationMin <= 0) {
    showToast('Please enter a valid duration', 'error');
    return;
  }

  const durationSec = durationMin * 60;
  const now   = new Date();
  const start = new Date(now.getTime() - durationSec * 1000);

  Storage.addSession({
    id:          now.getTime().toString(36),
    subject,
    description: desc,
    start:       start.toISOString(),
    end:         now.toISOString(),
    duration:    durationSec
  });

  DOM.sessionModal.classList.remove('active');
  renderAll();
  showToast('Manual session added', 'success');
});


