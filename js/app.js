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
  '2':'taskflow', 
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

    function wrapped(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    }

    wrapped.cancel = () => {
        clearTimeout(timer);
    };

    return wrapped;
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
    if (!days[key]) days[key] = { sessions: [], questions: { ...DEFAULT_QUESTIONS }, todos: [] };
    if (!days[key].todos) days[key].todos = [];

    return days[key];
  },

  dayExists(date) {
    return !!this.read().tracker.days[dayKey(date)];
  },

  // -- Todos/Tasks ------
  getTodos(date) {
    return this._ensureDay(date).todos || [];
  },

  setTodos(date, todos) {
    this._ensureDay(date).todos = todos;
    this.write();
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

  // Taskflow
  todoInput:          $('todoInput'),
  addBtn:             $('addBtn'),
  todoList:           $('todoList'),
  statsBar:           $('statsBar'),
  activeCountEl:      $('activeCount'),
  progressSection:    $('progressSection'),
  progressFill:       $('progressFill'),
  progressPct:        $('progressPct'),
  clearCompletedBtn:  $('clearCompletedBtn'),
  dayNameEl:          $('dayName'),
  dayDateEl:          $('dayDate'),
  todayChip:          $('todayChip'),
  contentArea:        $('contentArea'),
  filterTabs:         document.querySelectorAll('.filter-tab'),

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


// -- DASHBOARD: STATS COMPUTATION -- //

// Total seconds for sessions ending today
function getTodayTotalSeconds() {
  const todayStart = startOfDay(new Date()).getTime();
  return Storage.allSessions()
    .filter(s => new Date(s.end).getTime() >= todayStart)
    .reduce((sum, s) => sum + s.duration, 0);
}

// Per-day totals for the last `numDays` days, keyed by day-start ms
function computeDailyTotals(numDays) {
  const totals = {};
  for (let i = 0; i < numDays; i++) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    totals[d.getTime()] = 0;
  }
  for (const s of Storage.allSessions()) {
    const dayStart = startOfDay(new Date(s.end)).getTime();
    if (totals[dayStart] !== undefined) totals[dayStart] += s.duration;
  }
  return totals;
}

function computeTimeStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    const dayEnd   = dayStart + DAY_MS;
    const hasLogged = Storage.allSessions().some(s => {
      const t = new Date(s.end).getTime();
      return t >= dayStart && t < dayEnd;
    });
    if (hasLogged) streak++;
    else break;
  }
  return streak;
}

function computeQuestionStreak() {
  const goal = Storage.getGoals().questions;
  if (!goal || goal <= 0) return 0;

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);

    if (!Storage.dayExists(d)) {
      if (i === 0) continue; // today hasn't started yet; don't break
      break;
    }
    const q = Storage.getQuestions(d);
    const total = (q.phy || 0) + (q.chem || 0) + (q.maths || 0);
    if (total >= goal) streak++;
    else break;
  }
  return streak;
}


// -- DASHBOARD — RENDERING -- //

function renderStats(dailyTotals) {
  // 1. Most hours in a single day (7-day window)
  const maxDay = Math.max(0, ...Object.values(dailyTotals));
  DOM.statMaxDay.textContent = formatDurationShort(maxDay);

  // 2. Average session duration (30-day window)
  const thirtyDaysAgo = startOfDay(new Date()).getTime() - 29 * DAY_MS;
  const recent = Storage.allSessions().filter(s => new Date(s.end).getTime() >= thirtyDaysAgo);
  const avgSes = recent.length > 0
    ? recent.reduce((a, s) => a + s.duration, 0) / recent.length
    : 0;
  DOM.statAvgSession.textContent = formatDurationShort(avgSes);

  // 3. 7-day daily average
  const weekTotal = Object.values(dailyTotals).reduce((a, b) => a + b, 0);
  DOM.statAvgHrsDay.textContent = formatDurationShort(weekTotal / 7);

  // 4. Time streak
  DOM.statTimeStreak.textContent = computeTimeStreak() + ' days';

  // 5. Question streak
  DOM.statQuestionStreak.textContent = computeQuestionStreak() + ' days';
}


function renderPieChart() {
  const sevenDaysAgo = startOfDay(new Date()).getTime() - 6 * DAY_MS;

  const pieData = {};
  SUBJECTS.forEach(s => { pieData[s.key] = 0; });

  for (const s of Storage.allSessions()) {
    if (new Date(s.end).getTime() >= sevenDaysAgo) {
      pieData[s.subject] = (pieData[s.subject] || 0) + s.duration;
    }
  }

  const total = Object.values(pieData).reduce((a, b) => a + b, 0);
  DOM.pieTotal.textContent = formatDurationShort(total);

  DOM.pieChart.innerHTML = '';
  DOM.pieLegend.innerHTML = '';

  if (total === 0) {
    const legend = document.createElement('div');
    legend.className = 'legend-item';
    legend.style.color = 'var(--muted)';
    legend.textContent = 'No data yet';
    DOM.pieLegend.appendChild(legend);
    return;
  }

  let startAngle = 0;
  const R = 80, CX = 100, CY = 100;
  const toRad = (deg) => (deg - 90) * Math.PI / 180;

  for (const subj of SUBJECTS) {
    const value = pieData[subj.key];
    if (value === 0) continue;

    const pct = value / total;

    if (pct === 1) {
      // Full circle to avoid 360* path math edge case
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', CX);
      circle.setAttribute('cy', CY);
      circle.setAttribute('r', R);
      circle.setAttribute('fill', subj.color);
      circle.setAttribute('opacity', '0.9');
      DOM.pieChart.appendChild(circle);
    } else {
      const endAngle = startAngle + pct * 360;
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;

      const x1 = CX + R * Math.cos(toRad(startAngle));
      const y1 = CY + R * Math.sin(toRad(startAngle));
      const x2 = CX + R * Math.cos(toRad(endAngle));
      const y2 = CY + R * Math.sin(toRad(endAngle));

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d',
        `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`);
      path.setAttribute('fill', subj.color);
      path.setAttribute('opacity', '0.9');
      path.setAttribute('stroke', 'var(--card)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linejoin', 'round');
      DOM.pieChart.appendChild(path);

      startAngle = endAngle;
    }

    const legend = document.createElement('div');
    legend.className = 'legend-item';
    legend.innerHTML =
      `<span class="legend-dot" style="background:${subj.color}"></span> ` +
      `${subj.name} (${Math.round(pct * 100)}%)`;
    DOM.pieLegend.appendChild(legend);
  }
}


function renderBarChart(dailyTotals) {
  const W = 400, H = 200, PAD = 40;
  const maxVal = Math.max(3600, ...Object.values(dailyTotals)); // min 1h scale
  const maxH   = H - PAD * 2;
  const stepX  = (W - PAD * 2) / 7;
  const barW   = stepX * 0.6;

  const parts = [];

  // Grid lines + axis labels
  parts.push(`<line x1="${PAD}" y1="${PAD}" x2="${W-PAD}" y2="${PAD}" class="chart-grid-line"/>`);
  parts.push(`<line x1="${PAD}" y1="${H-PAD}" x2="${W-PAD}" y2="${H-PAD}" class="chart-grid-line"/>`);
  parts.push(`<text x="${PAD-5}" y="${PAD+4}" text-anchor="end" class="chart-axis-label">${formatDurationShort(maxVal)}</text>`);
  parts.push(`<text x="${PAD-5}" y="${H-PAD+4}" text-anchor="end" class="chart-axis-label">0m</text>`);

  const allSessions = Storage.allSessions();

  // Stacked bars (oldest day → leftmost)
  for (let i = 6; i >= 0; i--) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    const dayEnd   = dayStart + DAY_MS;

    const x = PAD + (6 - i) * stepX + (stepX - barW) / 2;
    let currentY = H - PAD;

    for (const subj of SUBJECTS) {
      const subjDur = allSessions
        .filter(s => s.subject === subj.key
          && new Date(s.end).getTime() >= dayStart
          && new Date(s.end).getTime() <  dayEnd)
        .reduce((sum, s) => sum + s.duration, 0);

      if (subjDur > 0) {
        const barH = (subjDur / maxVal) * maxH;
        currentY -= barH;
        parts.push(
          `<rect x="${x}" y="${currentY}" width="${barW}" height="${barH}" ` +
          `fill="${subj.color}" rx="2" class="bar-chart-bar">` +
          `<title>${subj.name}: ${formatDurationShort(subjDur)}</title></rect>`
        );
      }
    }

    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    parts.push(`<text x="${x + barW/2}" y="${H - PAD + 15}" text-anchor="middle" class="chart-axis-label">${label}</text>`);
  }

  DOM.barChart.innerHTML = parts.join('');
}


// -- DASHBOARD: GOALS & QUESTIONS -- //

// Update only the progress text (safe to call on every input keystroke).
function renderGoalProgress() {
  const goals    = Storage.getGoals();
  const q        = Storage.getQuestions(new Date());
  const goalSecs = goals.hours * 3600 + goals.minutes * 60;
  const todaySecs= getTodayTotalSeconds();
  const totalQ   = (q.phy || 0) + (q.chem || 0) + (q.maths || 0);

  DOM.timeGoalText.textContent = `${formatDurationShort(todaySecs)} / ${formatDurationShort(goalSecs)}`;
  DOM.timeGoalText.classList.toggle('met', goalSecs > 0 && todaySecs >= goalSecs);

  DOM.questionsGoalText.textContent = `${totalQ} / ${goals.questions}`;
  DOM.questionsGoalText.classList.toggle('met', goals.questions > 0 && totalQ >= goals.questions);
}

// Full goals render: syncs input values from storage (call on init / data change)
function renderGoals() {
  const goals = Storage.getGoals();
  const q     = Storage.getQuestions(new Date());

  DOM.goalHours.value     = goals.hours;
  DOM.goalMinutes.value   = goals.minutes;
  DOM.questionsGoal.value = goals.questions;
  DOM.qPhy.value          = q.phy;
  DOM.qChem.value         = q.chem;
  DOM.qMaths.value        = q.maths;

  renderGoalProgress();
}

// Goal input listeners
[DOM.goalHours, DOM.goalMinutes, DOM.questionsGoal].forEach(input => {
  input.addEventListener('input', () => {
    Storage.setGoals({
      hours:     parseInt(DOM.goalHours.value,     10) || 0,
      minutes:   parseInt(DOM.goalMinutes.value,   10) || 0,
      questions: parseInt(DOM.questionsGoal.value, 10) || 0
    });
    renderGoalProgress();
  });
});

// Question input listeners
[DOM.qPhy, DOM.qChem, DOM.qMaths].forEach(input => {
  input.addEventListener('input', () => {
    Storage.setQuestions(new Date(), {
      phy:   parseInt(DOM.qPhy.value,   10) || 0,
      chem:  parseInt(DOM.qChem.value,  10) || 0,
      maths: parseInt(DOM.qMaths.value, 10) || 0
    });
    renderGoalProgress();
  });
});


function renderDashboard() {
  const dailyTotals = computeDailyTotals(7);
  renderStats(dailyTotals);
  renderPieChart();
  renderBarChart(dailyTotals);
  renderGoals();
}

function renderAll() {
  renderSessionLog();
  renderDashboard();
}


/* =============================================================
 * BACKUP & RESTORE
 * -------------------------------------------------------------
 * Export wraps the storage data with metadata. Import validates
 * and replaces all data, then reloads.
 * ============================================================= */
function exportData() {
  const payload = {
    app:        APP_NAME,
    version:    APP_VERSION,
    exportedAt: new Date().toISOString(),
    data:       Storage.read()
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'keystone.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Backup exported to keystone.json', 'success');
}


function isValidBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;

  if (parsed.app !== APP_NAME) return false;

  if (!parsed.data || typeof parsed.data !== 'object')
    return false;

  const data = parsed.data;

  if (!data.notes || typeof data.notes.content !== 'string')
    return false;

  if (!data.tracker || typeof data.tracker !== 'object')
    return false;

  if (!data.tracker.goals)
    return false;

  const g = data.tracker.goals;

  if (
    typeof g.hours !== 'number' ||
    typeof g.minutes !== 'number' ||
    typeof g.questions !== 'number'
  )
    return false;

  if (
    !data.tracker.days ||
    typeof data.tracker.days !== 'object'
  )
    return false;

  return true;
}


function handleImportFile(file) {
  if (!file || !file.name.endsWith('.json')) {
    showToast('Please select a keystone.json file', 'error');
    return;
  }

  if (!isValidBackup(parsed)) {
    showToast("Invalid backup file", "error");
    return;
  }

  saveNotesDebounced.cancel();

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || !parsed.data) {
        showToast('Invalid backup format', 'error');
        return;
      }
      Storage.replaceAll(structuredClone(parsed.data));
      showToast('keystone.json loaded! Reloading…', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      showToast('Error reading JSON file', 'error');
    }
  };
  reader.readAsText(file);
}

DOM.exportBtn.addEventListener('click', exportData);
DOM.importBtn.addEventListener('click', () => DOM.importFileInput.click());
DOM.importFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleImportFile(e.target.files[0]);
    e.target.value = '';
  }
});


// -- KEYBOARD SHORTCUTS -- //
window.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + 1-4 -> switch section
  if ((e.ctrlKey || e.metaKey) && KEYBOARD_SHORTCUTS[e.key]) {
    e.preventDefault();
    switchSection(KEYBOARD_SHORTCUTS[e.key]);
    return;
  }

  // Arrow keys -> calendar navigation / day navigation
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'ArrowLeft') {
    if (activeSection === 'taskflow') {
      tfNavigateDay(-1);
    } else {
      navigateCalendar(-1);
    }
  }
  if (e.key === 'ArrowRight') {
    if (activeSection === 'taskflow') {
      tfNavigateDay(1);
    } else {
      navigateCalendar(1);
    }
  }

  if (e.key === '/' && activeSection === 'taskflow' && !tfEditingId) {
    e.preventDefault();
    DOM.todoInput.focus();
  }
});

renderAll();


// =============================================================
// TASKFLOW FRONTEND LOGIC (from taskflow.html)
// =============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- SOUND EFFECTS --- //
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playCompletionSfx() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, t);
    osc2.frequency.setValueAtTime(880, t);
    osc1.frequency.exponentialRampToValueAtTime(587.33, t + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.28);
    osc2.stop(t + 0.28);
  } catch (e) {}
}

function play100Sfx() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const start = t + i * 0.12;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch (e) {}
}

// --- STATE --- //
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let tfTodos = [];
let tfCurrentFilter = 'all';
let tfEditingId = null;
let tfSelectedYear = 0;
let tfSelectedMonth = 0;
let tfSelectedDay = 1;
let tfIsTransitioning = false;

function tfSelectedDate() {
  return new Date(tfSelectedYear, tfSelectedMonth, tfSelectedDay);
}

function tfIsToday() {
  const now = new Date();
  return tfSelectedYear === now.getFullYear() &&
         tfSelectedMonth === now.getMonth() &&
         tfSelectedDay === now.getDate();
}

function tfGetOrdinalSuffix(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function tfNavigateDay(delta) {
  if (tfIsTransitioning) return;

  const d = new Date(tfSelectedYear, tfSelectedMonth, tfSelectedDay + delta);
  tfSelectedYear = d.getFullYear();
  tfSelectedMonth = d.getMonth();
  tfSelectedDay = d.getDate();

  tfSwitchDay();
}

function tfGoToToday() {
  if (tfIsTransitioning || tfIsToday()) return;

  const now = new Date();
  tfSelectedYear = now.getFullYear();
  tfSelectedMonth = now.getMonth();
  tfSelectedDay = now.getDate();

  tfSwitchDay();
}

function tfSwitchDay() {
  if (tfIsTransitioning) return;
  tfIsTransitioning = true;

  let finished = false;

  const finishTransition = () => {
    if (finished) return;
    finished = true;

    tfLoadTodos();
    tfEditingId = null;
    tfCurrentFilter = 'all';
    DOM.filterTabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    if (DOM.filterTabs[0]) {
      DOM.filterTabs[0].classList.add('active');
      DOM.filterTabs[0].setAttribute('aria-selected', 'true');
    }

    tfUpdateDateDisplay();
    tfRender();

    DOM.contentArea.classList.remove('transitioning');
    tfIsTransitioning = false;
  };

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion) {
    DOM.contentArea.classList.add('transitioning');
    setTimeout(finishTransition, 160);
    setTimeout(finishTransition, 500); // safety net
  } else {
    finishTransition();
  }
}

function tfUpdateDateDisplay() {
  const d = tfSelectedDate();
  const dow = d.getDay();
  DOM.dayNameEl.textContent = DAY_NAMES[dow];

  const suffix = tfGetOrdinalSuffix(tfSelectedDay);
  let dateStr = MONTH_NAMES[tfSelectedMonth] + ' ' + tfSelectedDay + suffix;

  const currentYear = new Date().getFullYear();
  if (tfSelectedYear !== currentYear) {
    dateStr += ', ' + tfSelectedYear;
  }

  DOM.dayDateEl.textContent = dateStr;
  DOM.todayChip.style.display = tfIsToday() ? 'none' : 'inline-flex';

  if (tfIsToday()) {
    DOM.dayNameEl.classList.add('is-today');
    DOM.dayDateEl.classList.add('is-today');
  } else {
    DOM.dayNameEl.classList.remove('is-today');
    DOM.dayDateEl.classList.remove('is-today');
  }
}

function tfLoadTodos() {
  tfTodos = Storage.getTodos(tfSelectedDate());
}

function tfSaveTodos() {
  Storage.setTodos(tfSelectedDate(), tfTodos);
}

function tfGetFilteredTodos() {
  switch (tfCurrentFilter) {
    case 'active': return tfTodos.filter(t => !t.completed);
    case 'completed': return tfTodos.filter(t => t.completed);
    default: return tfTodos;
  }
}

function tfRender() {
  const filtered = tfGetFilteredTodos();
  const activeTodos = tfTodos.filter(t => !t.completed);
  const completedTodos = tfTodos.filter(t => t.completed);
  const total = tfTodos.length;

  if (total > 0) {
    DOM.statsBar.style.display = 'flex';
    DOM.progressSection.style.display = 'block';
    DOM.activeCountEl.textContent = activeTodos.length;

    const pct = Math.round((completedTodos.length / total) * 100);
    DOM.progressFill.style.width = pct + '%';
    DOM.progressPct.textContent = pct + '%';
  } else {
    DOM.statsBar.style.display = 'none';
    DOM.progressSection.style.display = 'none';
  }

  DOM.clearCompletedBtn.style.display = completedTodos.length > 0 ? 'inline-flex' : 'none';

  DOM.todoList.innerHTML = '';

  if (filtered.length === 0) {
    let emptyMsg, emptyTitle, emptyIcon;

    if (tfCurrentFilter === 'active' && total > 0) {
      emptyTitle = 'No active tasks';
      emptyMsg = 'Everything is done. Well played.';
      emptyIcon = 'ph ph-smiley';
    } else if (tfCurrentFilter === 'completed' && total > 0) {
      emptyTitle = 'Nothing completed yet';
      emptyMsg = 'Complete some tasks to see them here.';
      emptyIcon = 'ph ph-check-circle';
    } else {
      emptyTitle = 'All clear';
      emptyMsg = 'Add your first task to get started.';
      emptyIcon = 'ph ph-clipboard-text';
    }

    DOM.todoList.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon"><i class="' + emptyIcon + '"></i></div>' +
        '<p class="empty-title">' + escapeHtml(emptyTitle) + '</p>' +
        '<p class="empty-desc">' + escapeHtml(emptyMsg) + '</p>' +
      '</div>';
    return;
  }

  filtered.forEach((todo, index) => {
    const item = document.createElement('div');
    item.className = 'todo-item' + (todo.completed ? ' completed' : '');
    item.style.animationDelay = Math.min(index * 0.04, 0.4) + 's';
    item.dataset.id = todo.id;

    if (tfEditingId === todo.id) {
      item.innerHTML =
        '<div class="checkbox-wrapper">' +
          '<input type="checkbox" ' + (todo.completed ? 'checked' : '') + ' aria-label="Mark task complete">' +
          '<div class="checkbox-visual">' +
            '<svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg>' +
          '</div>' +
        '</div>' +
        '<input type="text" class="edit-input" value="' + escapeAttr(todo.text) + '" maxlength="200" aria-label="Edit task">' +
        '<div class="todo-actions" style="opacity:1">' +
          '<button class="action-btn save-btn" aria-label="Save edit" title="Save"><i class="ph ph-check"></i></button>' +
          '<button class="action-btn cancel-btn" aria-label="Cancel edit" title="Cancel"><i class="ph ph-x"></i></button>' +
        '</div>';
    } else {
      item.innerHTML =
        '<div class="checkbox-wrapper">' +
          '<input type="checkbox" ' + (todo.completed ? 'checked' : '') + ' aria-label="Mark task complete">' +
          '<div class="checkbox-visual">' +
            '<svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg>' +
          '</div>' +
        '</div>' +
        '<span class="todo-text">' + escapeHtml(todo.text) + '</span>' +
        '<div class="todo-actions">' +
          '<button class="action-btn edit-btn" aria-label="Edit task" title="Edit"><i class="ph ph-pencil-simple"></i></button>' +
          '<button class="action-btn delete" aria-label="Delete task" title="Delete"><i class="ph ph-trash"></i></button>' +
        '</div>';
    }

    DOM.todoList.appendChild(item);

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => { tfToggleTodo(todo.id); });

    if (tfEditingId === todo.id) {
      const editInput = item.querySelector('.edit-input');
      const saveBtn = item.querySelector('.save-btn');
      const cancelBtn = item.querySelector('.cancel-btn');

      requestAnimationFrame(() => {
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      });

      const save = () => {
        const newText = editInput.value.trim();
        if (newText && newText !== todo.text) {
          const t = tfTodos.find(x => x.id === todo.id);
          if (t) t.text = newText;
          tfSaveTodos();
          showToast('Task updated', 'success');
        }
        tfEditingId = null;
        tfRender();
      };

      const cancel = () => {
        tfEditingId = null;
        tfRender();
      };

      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') cancel();
      });

      saveBtn.addEventListener('click', save);
      cancelBtn.addEventListener('click', cancel);
    } else {
      const editBtn = item.querySelector('.edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => { tfEditingId = todo.id; tfRender(); });
      }

      const deleteBtn = item.querySelector('.action-btn.delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          item.classList.add('removing');
          setTimeout(() => { tfDeleteTodo(todo.id); }, 300);
        });
      }
    }
  });
}

function tfAddTodo() {
  const text = DOM.todoInput.value.trim();
  if (!text) {
    DOM.todoInput.focus();
    const wrapper = DOM.todoInput.closest('.input-wrapper');
    wrapper.style.animation = 'none';
    void wrapper.offsetHeight;
    wrapper.style.animation = 'shake 0.4s ease';
    return;
  }

  const todo = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
    text: text,
    completed: false,
    createdAt: Date.now()
  };

  tfTodos.unshift(todo);
  tfSaveTodos();
  DOM.todoInput.value = '';
  DOM.todoInput.focus();
  tfRender();
  showToast('Task added', 'success');
}

function tfToggleTodo(id) {
  const todo = tfTodos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    if (todo.completed) {
      playCompletionSfx();
      const allDone = tfTodos.length > 0 && tfTodos.every(t => t.completed);
      if (allDone) {
        setTimeout(play100Sfx, 250);
      }
    }
    tfSaveTodos();
    tfRender();
  }
}

function tfDeleteTodo(id) {
  tfTodos = tfTodos.filter(t => t.id !== id);
  tfSaveTodos();
  tfRender();
  showToast('Task removed', 'neutral');
}

function tfClearCompleted() {
  const count = tfTodos.filter(t => t.completed).length;
  tfTodos = tfTodos.filter(t => !t.completed);
  tfSaveTodos();
  tfRender();
  showToast(count + ' task' + (count !== 1 ? 's' : '') + ' cleared', 'neutral');
}

// --- INITIALIZATION & EVENT LISTENERS --- //
function initTaskflow() {
  const now = new Date();
  tfSelectedYear = now.getFullYear();
  tfSelectedMonth = now.getMonth();
  tfSelectedDay = now.getDate();

  tfUpdateDateDisplay();
  tfLoadTodos();
  tfRender();
}

if (DOM.addBtn) DOM.addBtn.addEventListener('click', tfAddTodo);
if (DOM.todoInput) {
  DOM.todoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tfAddTodo();
  });
}
if (DOM.clearCompletedBtn) DOM.clearCompletedBtn.addEventListener('click', tfClearCompleted);

const prevDayEl = document.getElementById('prevDay');
const nextDayEl = document.getElementById('nextDay');
if (prevDayEl) prevDayEl.addEventListener('click', () => { tfNavigateDay(-1); });
if (nextDayEl) nextDayEl.addEventListener('click', () => { tfNavigateDay(1); });
if (DOM.todayChip) DOM.todayChip.addEventListener('click', tfGoToToday);

DOM.filterTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    DOM.filterTabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    tfCurrentFilter = tab.dataset.filter;
    tfRender();
  });
});

initTaskflow();