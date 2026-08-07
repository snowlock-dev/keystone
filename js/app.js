const APP_NAME    = "Keystone";
const APP_VERSION = "1";
const STORAGE_KEY = "keystone";
const DAY_MS      = 86_400_000;

const _initRaw = localStorage.getItem(STORAGE_KEY) || '';
const _initKB  = (new TextEncoder().encode(_initRaw).length / 1024).toFixed(2);

console.log(
  `%cKeystone v${APP_VERSION} Initialized!%c\nStudy smart. Track everything.\nStorage used: ${_initKB} KB`,
  "color: #8b5cf6; font-size: 18px; font-weight: 900;",
  "color: #6b7280; font-size: 12px; margin-top: 4px; display: block;"
);

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
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const KEYBOARD_SHORTCUTS = {
  '1':'home', 
  '2':'taskflow', 
  '3':'tracker', 
  '4':'notes',
  '5':'tests',
  '6':'errors'
};

const DEFAULT_GOALS     = { hours: 4, minutes: 0, questions: 50 };
const DEFAULT_QUESTIONS = { phy: 0, chem: 0, maths: 0 };

// --- UTILITY FUNCTIONS --- //

// [IMPROVEMENT] Unified ID generator to prevent collisions
function generateId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
}

// [IMPROVEMENT] Deep clone helper for transactional updates — never mutate cached state directly
function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch (e) { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(obj));
}

function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function formatDurationShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function checkStorageSize() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  
  // TextEncoder accurately converts strings to UTF-8 bytes
  const bytes = new TextEncoder().encode(raw).length;
  const MB = bytes / (1024 * 1024);
  
  if (MB > 4) {
    const warningMsg = `Storage size is ${MB.toFixed(2)}MB. Approaching the 5MB limit.`;
    console.warn("Keystone:", warningMsg);
    showToast(warningMsg, 'error'); // 'error' gives it the red border to grab attention
  }
}

// [IMPROVEMENT] Enhanced debounce with flush() and isPending() for safe cleanup on unload
function debounce(fn, ms) {
  let timer;
  let lastArgs;
  let pending = false;
  function wrapped(...args) {
    lastArgs = args;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pending = false;
      fn(...args);
    }, ms);
  }
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = false;
    lastArgs = null;
  };
  // [IMPROVEMENT] Immediately invoke pending callback — used in beforeunload to flush saves
  wrapped.flush = () => {
    if (pending) {
      clearTimeout(timer);
      timer = null;
      pending = false;
      fn(...lastArgs);
      lastArgs = null;
      return true;
    }
    return false;
  };
  // [IMPROVEMENT] Check if a debounced call is pending — used to avoid overwriting local edits during cross-tab sync
  wrapped.isPending = () => pending;
  return wrapped;
}

function subjectByKey(key) {
  return SUBJECTS.find(s => s.key === key) || SUBJECTS[0];
}

// [IMPROVEMENT] Validate a single session object — returns normalized session or null if fundamentally invalid
function validateSession(s) {
  if (!s || typeof s !== "object") return null;

  // ID: must be a non-empty string; generate one if missing (normalize)
  let id = s.id;
  if (typeof id !== "string" || id.trim() === "") {
    id = generateId();
  }

  // Subject: must exist in SUBJECTS list; default to 'physics' if invalid (normalize)
  const subjectKey =
    typeof s.subject === "string" && SUBJECTS.some(sub => sub.key === s.subject)
      ? s.subject
      : "physics";

  // Dates: must be valid ISO strings — discard session if they cannot be parsed
  const startStr = typeof s.start === "string" ? s.start : null;
  const endStr   = typeof s.end   === "string" ? s.end   : null;
  if (!startStr || isNaN(new Date(startStr).getTime())) return null;
  if (!endStr   || isNaN(new Date(endStr).getTime()))   return null;

  // Duration: must be a finite, non-negative number — discard if invalid
  const duration = typeof s.duration === "number" ? s.duration : null;
  if (duration === null || !Number.isFinite(duration) || duration < 0) return null;

  return {
    id,
    subject: subjectKey,
    description: typeof s.description === "string" ? s.description : "",
    start: startStr,
    end: endStr,
    duration
  };
}

// [IMPROVEMENT] Enhanced structural validation — now validates sessions and null-checks questions
function validateData(data) {
  if (!data) return false;
  if (!data.tracker) return false;
  if (!data.tracker.days || typeof data.tracker.days !== "object") return false;

  // Active session must be null or an object
  if (data.tracker.activeSession !== null && typeof data.tracker.activeSession !== "object") {
    return false;
  }

  for (const day of Object.values(data.tracker.days)) {
    if (!day || typeof day !== "object") return false;
    if (!Array.isArray(day.todos)) return false;
    if (!Array.isArray(day.sessions)) return false;
    if (typeof day.questions !== "object" || day.questions === null) return false;

    // [IMPROVEMENT] Validate every session before saving
    for (const s of day.sessions) {
      if (!validateSession(s)) return false;
    }
  }

  if (!Array.isArray(data.tests)) return false;
  if (!Array.isArray(data.errors)) return false;

  return true;
}

// --- STORAGE LAYER --- //

const Storage = {
  _cache: null,
  // [IMPROVEMENT] Cached flat list of all sessions — invalidated on every write
  _allSessionsCache: null,

  _defaultData() {
    return {
      version: 1,
      notes: { content: "" },
      tracker: {
        goals: { ...DEFAULT_GOALS },
        days: {},
        activeSession: null
      },
      globalTodos: [],
      tests: [],
      errors: []
    };
  },

  // [IMPROVEMENT] Transactional update — clone → modify → validate → atomic swap.
  // If anything fails the original _cache is left untouched.
  transaction(fn) {
    const current = this.read();
    const draft = deepClone(current);

    try {
      const result = fn(draft);

      // Validate the entire draft before committing
      if (!validateData(draft)) {
        console.error("Keystone: transaction validation failed — keeping original state");
        return false;
      }

      // Atomically replace cache only after validation passes
      this._cache = draft;

      // Persist to localStorage
      const saved = this.write();
      if (!saved) {
        // Restore original on save failure
        this._cache = current;
        return false;
      }

      // Invalidate derived caches after successful commit
      this._invalidateSessionsCache();
      return result !== undefined ? result : true;
    } catch (err) {
      console.error("Keystone: transaction failed — keeping original state", err);
      this._cache = current;
      return false;
    }
  },

  // [IMPROVEMENT] Invalidate the sessions list cache — called after every successful write
  _invalidateSessionsCache() {
    this._allSessionsCache = null;
  },

  _normalizeData(data) {
    const normalized = this._defaultData();

    if (!data || typeof data !== "object") {
      return normalized;
    }

    // ------------------------
    // Notes
    // ------------------------
    if (data.notes && typeof data.notes === "object") {
      normalized.notes = {
        content:
          typeof data.notes.content === "string"
            ? data.notes.content
            : ""
      };
    }

    // ------------------------
    // Tracker
    // ------------------------
    if (data.tracker && typeof data.tracker === "object") {

      // Goals — [IMPROVEMENT] use Number.isFinite for proper numeric validation
      normalized.tracker.goals = {
        hours:     Number.isFinite(data.tracker.goals?.hours)     ? data.tracker.goals.hours     : DEFAULT_GOALS.hours,
        minutes:   Number.isFinite(data.tracker.goals?.minutes)   ? data.tracker.goals.minutes   : DEFAULT_GOALS.minutes,
        questions: Number.isFinite(data.tracker.goals?.questions) ? data.tracker.goals.questions : DEFAULT_GOALS.questions
      };

      // Active timer session — [IMPROVEMENT] use Number.isSafeInteger for timestamps
      if (data.tracker.activeSession && typeof data.tracker.activeSession === "object") {
        const as = data.tracker.activeSession;
        normalized.tracker.activeSession = {
          subject:
            typeof as.subject === "string" && SUBJECTS.some(s => s.key === as.subject)
              ? as.subject
              : "physics",
          description: typeof as.description === "string" ? as.description : "",
          startedAt: Number.isSafeInteger(as.startedAt) ? as.startedAt : null,
          pausedAccumulated: Number.isFinite(as.pausedAccumulated) ? as.pausedAccumulated : 0,
          isPaused: !!as.isPaused
        };
      }

      // Days
      if (data.tracker.days && typeof data.tracker.days === "object") {
        normalized.tracker.days = {};

        for (const [dayKey, day] of Object.entries(data.tracker.days)) {
          normalized.tracker.days[dayKey] = {
            sessions: [],
            questions: { ...DEFAULT_QUESTIONS },
            todos: []
          };

          // ------------------------
          // Sessions — [IMPROVEMENT] validate every session via validateSession()
          // ------------------------
          if (Array.isArray(day.sessions)) {
            normalized.tracker.days[dayKey].sessions = day.sessions
              .map(s => validateSession(s))   // Returns normalized session or null
              .filter(s => s !== null);       // Discard invalid sessions
          }

          // ------------------------
          // Questions — [IMPROVEMENT] use Number.isFinite
          // ------------------------
          if (day.questions && typeof day.questions === "object") {
            normalized.tracker.days[dayKey].questions = {
              phy:   Number.isFinite(day.questions.phy)   ? day.questions.phy   : 0,
              chem:  Number.isFinite(day.questions.chem)  ? day.questions.chem  : 0,
              maths: Number.isFinite(day.questions.maths) ? day.questions.maths : 0
            };
          }

          // ------------------------
          // Todos — [IMPROVEMENT] use Number.isSafeInteger for createdAt timestamps
          // ------------------------
          if (Array.isArray(day.todos)) {
            normalized.tracker.days[dayKey].todos = day.todos
              .filter(t => t && typeof t === "object")
              .map(t => ({
                id:       typeof t.id === "string" ? t.id : generateId(),
                text:     typeof t.text === "string" ? t.text : "",
                completed: !!t.completed,
                createdAt: Number.isSafeInteger(t.createdAt) ? t.createdAt : Date.now()
              }))
              .filter(t => t.text.trim() !== "");
          }
        }
      }
    }

    // ------------------------
    // Global Todos (Taskset) — [IMPROVEMENT] use Number.isSafeInteger for createdAt
    // ------------------------
    normalized.globalTodos = [];
    if (data && Array.isArray(data.globalTodos)) {
      normalized.globalTodos = data.globalTodos
        .filter(t => t && typeof t === "object")
        .map(t => ({
          id:       typeof t.id === "string" ? t.id : generateId(),
          text:     typeof t.text === "string" ? t.text : "",
          completed: !!t.completed,
          createdAt: Number.isSafeInteger(t.createdAt) ? t.createdAt : Date.now()
        }))
        .filter(t => t.text.trim() !== "");
    } else {
      // Compatibility with taskset.html's legacy key "myTasks"
      try {
        const legacyTasks = localStorage.getItem('myTasks');
        if (legacyTasks) {
          const parsed = JSON.parse(legacyTasks);
          if (Array.isArray(parsed)) {
            normalized.globalTodos = parsed
              .filter(t => t && typeof t === "object")
              .map(t => ({
                id: generateId(),
                text: typeof t.text === 'string' ? t.text : '',
                completed: !!t.completed,
                createdAt: Date.now()
              }))
              .filter(t => t.text.trim() !== "");

            localStorage.removeItem('myTasks'); 
          }
        }
      } catch (err) {
        console.error("Failed to migrate legacy taskset myTasks", err);
      }
    }

    // Normalize Tests
    normalized.tests = [];
    if (Array.isArray(data.tests)) {
      normalized.tests = data.tests
        .filter(t => t && typeof t === "object")
        .map(t => ({
          id: typeof t.id === "string" ? t.id : generateId(),
          date: typeof t.date === "string" && !isNaN(new Date(t.date).getTime()) ? t.date : new Date().toISOString(),
          name: typeof t.name === "string" ? t.name : "Untitled Test",
          totalMarks: Number.isFinite(t.totalMarks) ? t.totalMarks : 300,
          obtainedMarks: Number.isFinite(t.obtainedMarks) ? t.obtainedMarks : 0,
          accuracy: Number.isFinite(t.accuracy) ? t.accuracy : 0
        }));
    }

    // Normalize Errors
    normalized.errors = [];
    if (Array.isArray(data.errors)) {
      normalized.errors = data.errors
        .filter(e => e && typeof e === "object")
        .map(e => ({
          id: typeof e.id === "string" ? e.id : generateId(),
          date: typeof e.date === "string" && !isNaN(new Date(e.date).getTime()) ? e.date : new Date().toISOString(),
          subject: typeof e.subject === "string" && SUBJECTS.some(s => s.key === e.subject) ? e.subject : "physics",
          chapter: typeof e.chapter === "string" ? e.chapter : "General",
          errorType: typeof e.errorType === "string" ? e.errorType : "Conceptual Gap",
          takeaway: typeof e.takeaway === "string" ? e.takeaway : ""
        }));
    }

    return normalized;
  },

  read() {
    if (this._cache) return this._cache;

    try {
      let raw = localStorage.getItem(STORAGE_KEY);

      // Try recovering from temp backup
      if (!raw) {
        const tmp = localStorage.getItem(STORAGE_KEY + "_tmp");
        if (tmp) {
          console.warn("Recovering storage from temporary backup...");
          localStorage.setItem(STORAGE_KEY, tmp);
          localStorage.removeItem(STORAGE_KEY + "_tmp");
          raw = tmp;
        }
      }

      this._cache = this._normalizeData(
        raw ? JSON.parse(raw) : this._defaultData()
      );

    } catch (err) {
      console.error("Keystone: storage parse error. Resetting.", err);
      this._cache = this._defaultData();
    }

    return this._cache;
  },

  write() {
    try {
      if (!validateData(this._cache)) {
        console.error("Refusing to save invalid data.");
        return false;
      }
      const json = JSON.stringify(this._cache);
      // Write to temp first, then overwrite real, then clean up — crash-safe atomic write
      localStorage.setItem(STORAGE_KEY + "_tmp", json);
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.removeItem(STORAGE_KEY + "_tmp");
      return true;
    } catch (err) {
      console.error("Keystone: storage write error", err);
      return false;
    }
  },

  replaceAll(data) {
    // [IMPROVEMENT] Normalize and validate before replacing cache
    const normalized = this._normalizeData(data);
    if (!validateData(normalized)) {
      console.error("Refusing to replace with invalid data");
      return false;
    }
    this._cache = normalized;
    this._invalidateSessionsCache();
    return this.write();
  },

  // -- Global Todos ------ [IMPROVEMENT] transactional + return copies
  getGlobalTodos() { return deepClone(this.read().globalTodos || []); },
  setGlobalTodos(todos) {
    return this.transaction(draft => { draft.globalTodos = todos; });
  },

  // -- Notes ------ [IMPROVEMENT] transactional
  getNotes()       { return this.read().notes.content; },
  setNotes(text)   { return this.transaction(draft => { draft.notes.content = text; }); },
  clearNotes()     { return this.transaction(draft => { draft.notes.content = ''; }); },

  // -- Goals ------ [IMPROVEMENT] transactional + return copy
  getGoals()       { return { ...this.read().tracker.goals }; },
  setGoals(goals)  { return this.transaction(draft => { draft.tracker.goals = goals; }); },

  // -- Active Session Persistence ------ [IMPROVEMENT] transactional + return copy
  getActiveSession() {
    const s = this.read().tracker.activeSession;
    return s ? { ...s } : null;
  },
  setActiveSession(session) {
    return this.transaction(draft => { draft.tracker.activeSession = session; });
  },

  // [IMPROVEMENT] Ensure a day exists inside a transaction draft — never mutates _cache directly
  _ensureDayInDraft(draft, date) {
    const key  = dayKey(date);
    if (!draft.tracker.days[key]) {
      draft.tracker.days[key] = { sessions: [], questions: { ...DEFAULT_QUESTIONS }, todos: [] };
    }
    // Safety fallbacks for older save formats
    if (!draft.tracker.days[key].todos)     draft.tracker.days[key].todos = [];
    if (!draft.tracker.days[key].questions) draft.tracker.days[key].questions = { ...DEFAULT_QUESTIONS };
    if (!draft.tracker.days[key].sessions)  draft.tracker.days[key].sessions = [];
    return draft.tracker.days[key];
  },

  dayExists(date) {
    return !!this.read().tracker.days[dayKey(date)];
  },

  // -- Todos/Tasks ------ [IMPROVEMENT] transactional + return deep copies (no side effects on read)
  getTodos(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? deepClone(day.todos || []) : [];
  },
  setTodos(date, todos) {
    return this.transaction(draft => { this._ensureDayInDraft(draft, date).todos = todos; });
  },

  getQuestions(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? { ...DEFAULT_QUESTIONS, ...day.questions } : { ...DEFAULT_QUESTIONS };
  },
  setQuestions(date, q) {
    return this.transaction(draft => { this._ensureDayInDraft(draft, date).questions = q; });
  },

  // [IMPROVEMENT] Return deep clone to prevent external mutation of cached data
  getSessions(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? deepClone(day.sessions || []) : [];
  },

  // [IMPROVEMENT] Validate session before adding; use transaction
  addSession(session) {
    const validated = validateSession(session);
    if (!validated) {
      console.error("Keystone: refusing to add invalid session", session);
      return false;
    }
    return this.transaction(draft => {
      this._ensureDayInDraft(draft, new Date(validated.end)).sessions.push(validated);
    });
  },

  removeSession(id) {
    return this.transaction(draft => {
      let removed = false;
      for (const key of Object.keys(draft.tracker.days)) {
        const before = draft.tracker.days[key].sessions.length;
        draft.tracker.days[key].sessions = draft.tracker.days[key].sessions.filter(s => s.id !== id);
        if (draft.tracker.days[key].sessions.length !== before) removed = true;
      }
      return removed;
    });
  },

  // [IMPROVEMENT] Cache the flat sessions list — invalidated on every write and cross-tab sync
  allSessions() {
    if (this._allSessionsCache) return this._allSessionsCache;

    const out = [];
    for (const day of Object.values(this.read().tracker.days)) {
      if (Array.isArray(day.sessions)) out.push(...day.sessions);
    }
    this._allSessionsCache = out;
    return out;
  },

  // -- Tests --
  getTests() { return deepClone(this.read().tests || []); },
  addTest(test) { return this.transaction(draft => { draft.tests.push(test); }); },
  removeTest(id) {
    return this.transaction(draft => {
      const before = draft.tests.length;
      draft.tests = draft.tests.filter(t => t.id !== id);
      return draft.tests.length !== before;
    });
  },

  // -- Errors --
  getErrors() { return deepClone(this.read().errors || []); },
  addError(error) { return this.transaction(draft => { draft.errors.push(error); }); },
  removeError(id) {
    return this.transaction(draft => {
      const before = draft.errors.length;
      draft.errors = draft.errors.filter(e => e.id !== id);
      return draft.errors.length !== before;
    });
  },
  updateErrorTakeaway(id, takeaway) {
    return this.transaction(draft => {
      const err = draft.errors.find(e => e.id === id);
      if (err) {
        err.takeaway = takeaway;
        return true;
      }
      return false;
    });
  }
};


// --- DOM REFERENCES --- //

const $ = (id) => document.getElementById(id);

const DOM = {
  navItems:       document.querySelectorAll('.nav-item'),
  sectionViews:   document.querySelectorAll('.section-view'),
  toastContainer: $('toastContainer'),

  calendarGrid: $('calendarGrid'),
  calMonthYear: $('calMonthYear'),
  calPrev:      $('calPrev'),
  calNext:      $('calNext'),

  notesInput:         $('notesInput'),
  notesSaveIndicator: $('notesSaveIndicator'),
  notesCount:         $('notesCount'),
  notesClearBtn:      $('notesClearBtn'),

  exportBtn:       $('exportBtn'),
  importBtn:       $('importBtn'),
  importFileInput: $('importFileInput'),

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
  filterTabs:         document.querySelectorAll('#dailyFlowContainer .filter-tabs .filter-tab'),
  globalFilterTabs:   document.querySelectorAll('#tasksetContainer .filter-tabs .filter-tab'),

  tabDailyFlow:       $('tabDailyFlow'),
  tabTaskset:         $('tabTaskset'),
  dailyFlowContainer: $('dailyFlowContainer'),
  tasksetContainer:   $('tasksetContainer'),
  tasksetClockSection: $('tasksetClockSection'),
  tasksetClockDisplay: $('tasksetClockDisplay'),

  globalTodoInput:         $('globalTodoInput'),
  globalAddBtn:            $('globalAddBtn'),
  globalTodoList:          $('globalTodoList'),
  globalStatsBar:          $('globalStatsBar'),
  globalActiveCount:       $('globalActiveCount'),
  globalProgressSection:   $('globalProgressSection'),
  globalProgressFill:      $('globalProgressFill'),
  globalProgressPct:       $('globalProgressPct'),
  globalClearCompletedBtn: $('globalClearCompletedBtn'),

  subjectSelect:      $('subjectSelect'),
  sessionDesc:        $('sessionDesc'),
  activeTimerDisplay: $('activeTimerDisplay'),
  startBtn:           $('startBtn'),
  endBtn:             $('endBtn'),

  sessionLog:   $('sessionLog'),
  openModalBtn: $('openModalBtn'),

  sessionModal:    $('sessionModal'),
  modalSubject:    $('modalSubject'),
  modalDuration:   $('modalDuration'),
  modalDesc:       $('modalDesc'),
  discardModalBtn: $('discardModalBtn'),
  saveModalBtn:    $('saveModalBtn'),

  statMaxDay:         $('statMaxDay'),
  statAvgSession:     $('statAvgSession'),
  statAvgHrsDay:      $('statAvgHrsDay'),
  statTimeStreak:     $('statTimeStreak'),
  statQuestionStreak: $('statQuestionStreak'),

  pieChart:  $('pieChart'),
  pieTotal:  $('pieTotal'),
  pieLegend: $('pieLegend'),
  barChart:  $('barChart'),

  goalHours:         $('goalHours'),
  goalMinutes:       $('goalMinutes'),
  questionsGoal:     $('questionsGoal'),
  qPhy:              $('qPhy'),
  qChem:             $('qChem'),
  qMaths:            $('qMaths'),
  timeGoalText:      $('timeGoalText'),
  questionsGoalText: $('questionsGoalText'),

  // Tests Dashboard
  testStatsCards:    $('testStatsCards'),
  testLineChart:     $('testLineChart'),
  testHistoryList:   $('testHistoryList'),
  addTestForm:       $('addTestForm'),
  testNameInput:     $('testNameInput'),
  testDateInput:     $('testDateInput'),
  testTotalInput:    $('testTotalInput'),
  testObtainedInput: $('testObtainedInput'),
  testAccuracyInput: $('testAccuracyInput'),

  // Error Log
  addErrorForm:      $('addErrorForm'),
  errorLogList:      $('errorLogList'),
  errorSubjectSelect:$('errorSubjectSelect'),
  errorChapterInput: $('errorChapterInput'),
  errorTypeSelect:   $('errorTypeSelect'),
  errorTakeawayInput:$('errorTakeawayInput'),
  errorSubjectFilters: $('errorSubjectFilters'),
  errorTypeFilters:    $('errorTypeFilters')
};


// --- TOAST NOTIFICATION --- //

function showToast(message, state = 'neutral') {
  if (!DOM.toastContainer) return;
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
    cell.style.cursor = 'pointer';
    
    if (isSameDay(dateObj, today)) cell.classList.add('today');
    cell.innerHTML = `
      <span class="cal-dow">${DAY_NAMES_SHORT[dateObj.getDay()]}</span>
      <span class="cal-date">${d}</span>
    `;
    
    cell.addEventListener('click', () => {
      tfSelectedYear = calYear;
      tfSelectedMonth = calMonth;
      tfSelectedDay = d;
      switchSection('taskflow');
      tfSwitchDay();
    });

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
  DOM.notesCount.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
}

function handleNotesChange() {
  DOM.notesSaveIndicator.textContent = 'Saving...';
  DOM.notesSaveIndicator.classList.add('saving');
  saveNotesDebounced();
  updateNotesCount();
}

let notesClearConfirm = false;
let notesClearTimer   = null;

function handleNotesClear() {
  if (!DOM.notesInput.value.trim()) return;

  if (!notesClearConfirm) {
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

DOM.notesInput.value = Storage.getNotes();
DOM.notesSaveIndicator.textContent = 'All changes saved';
DOM.notesSaveIndicator.classList.remove('saving');
updateNotesCount();

DOM.notesInput.addEventListener('input', handleNotesChange);
DOM.notesClearBtn.addEventListener('click', handleNotesClear);

DOM.notesInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = DOM.notesInput;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + 2;
  handleNotesChange();
});


// TRACKER: ACTIVE SESSION
const activeTracker = {
  subject:           'physics',
  description:       '',
  startedAt:         null,
  pausedAccumulated: 0,
  isPaused:          false
};

// [IMPROVEMENT] Reset in-memory fields only — does NOT write to storage.
// Used during cross-tab sync to avoid triggering a write loop.
function resetActiveTrackerFields() {
  activeTracker.subject           = 'physics';
  activeTracker.description       = '';
  activeTracker.startedAt         = null;
  activeTracker.pausedAccumulated = 0;
  activeTracker.isPaused          = false;
}

function resetActiveTracker() {
  resetActiveTrackerFields();
  Storage.setActiveSession(null); // Clear from storage on reset
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

  DOM.endBtn.disabled         = !isRunning && activeTracker.pausedAccumulated === 0;
  DOM.subjectSelect.disabled  = isRunning;
  DOM.sessionDesc.disabled    = isRunning;
}

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
  Storage.setActiveSession({ ...activeTracker });
  updateTimerUI();
});

DOM.endBtn.addEventListener('click', () => {
  const duration = getActiveElapsedSec();
  if (duration > 60) {
    const now   = new Date();
    const start = new Date(now.getTime() - duration * 1000);
    Storage.addSession({
      id:          generateId(),
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

setInterval(() => {
  if (activeTracker.startedAt) updateTimerUI();
}, 1000);

// [IMPROVEMENT] Restore active session on load
function initActiveSession() {
  const saved = Storage.getActiveSession();
  if (saved && (saved.startedAt || saved.isPaused)) {
    Object.assign(activeTracker, saved);
    DOM.subjectSelect.value = activeTracker.subject;
    DOM.sessionDesc.value = activeTracker.description;
  }
  updateTimerUI();
}
initActiveSession();


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

DOM.discardModalBtn.addEventListener('click', () => DOM.sessionModal.classList.remove('active'));
DOM.sessionModal.addEventListener('click', (e) => {
  if (e.target === DOM.sessionModal) DOM.sessionModal.classList.remove('active');
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
    id:          generateId(),
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
// [IMPROVEMENT] All functions below accept an optional `allSessions` array to avoid
// calling Storage.allSessions() multiple times during a single render cycle.

function getTodayTotalSeconds(allSessions) {
  const todayStart = startOfDay(new Date()).getTime();
  return (allSessions || Storage.allSessions())
    .filter(s => new Date(s.end).getTime() >= todayStart)
    .reduce((sum, s) => sum + s.duration, 0);
}

function computeDailyTotals(numDays, allSessions) {
  const sessions = allSessions || Storage.allSessions();
  const totals = {};
  for (let i = 0; i < numDays; i++) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    totals[d.getTime()] = 0;
  }
  for (const s of sessions) {
    const dayStart = startOfDay(new Date(s.end)).getTime();
    if (totals[dayStart] !== undefined) totals[dayStart] += s.duration;
  }
  return totals;
}

// [IMPROVEMENT] Accept cached sessions array to avoid redundant allSessions() calls
function computeTimeStreak(allSessions) {
  let streak = 0;
  const sessions = allSessions || Storage.allSessions();
  const loggedDays = new Set(sessions.map(s => startOfDay(new Date(s.end)).getTime()));

  let i = 0;
  while (true) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    
    if (loggedDays.has(dayStart)) {
      streak++;
      i++;
    } else if (i === 0) {
      // Don't break streak if today is empty but yesterday wasn't
      i++; 
    } else {
      break;
    }
  }
  return streak;
}

function computeQuestionStreak() {
  const goal = Storage.getGoals().questions;
  if (!goal || goal <= 0) return 0;

  let streak = 0;
  let i = 0;
  
  while (true) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);

    if (!Storage.dayExists(d)) {
      if (i === 0) { i++; continue; } 
      break;
    }
    
    const q = Storage.getQuestions(d);
    const total = (q.phy || 0) + (q.chem || 0) + (q.maths || 0);
    
    if (total >= goal) {
      streak++;
      i++;
    } else if (i === 0) {
      i++; // Grace day for today
    } else {
      break;
    }
  }
  return streak;
}


// -- DASHBOARD — RENDERING -- //
// [IMPROVEMENT] Pass cached allSessions to every render function to avoid repeated reads

function renderStats(dailyTotals, allSessions) {
  const sessions = allSessions || Storage.allSessions();
  const maxDay = Math.max(0, ...Object.values(dailyTotals));
  DOM.statMaxDay.textContent = formatDurationShort(maxDay);

  const thirtyDaysAgo = startOfDay(new Date()).getTime() - 29 * DAY_MS;
  const recent = sessions.filter(s => new Date(s.end).getTime() >= thirtyDaysAgo);
  const avgSes = recent.length > 0 ? recent.reduce((a, s) => a + s.duration, 0) / recent.length : 0;
  DOM.statAvgSession.textContent = formatDurationShort(avgSes);

  const weekTotal = Object.values(dailyTotals).reduce((a, b) => a + b, 0);
  DOM.statAvgHrsDay.textContent = formatDurationShort(weekTotal / 7);

  DOM.statTimeStreak.textContent = computeTimeStreak(sessions) + ' days';
  DOM.statQuestionStreak.textContent = computeQuestionStreak() + ' days';
}

function renderPieChart(allSessions) {
  const sessions = allSessions || Storage.allSessions();
  const sevenDaysAgo = startOfDay(new Date()).getTime() - 6 * DAY_MS;
  const pieData = {};
  SUBJECTS.forEach(s => { pieData[s.key] = 0; });

  for (const s of sessions) {
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
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', CX); circle.setAttribute('cy', CY); circle.setAttribute('r', R);
      circle.setAttribute('fill', subj.color); circle.setAttribute('opacity', '0.9');
      DOM.pieChart.appendChild(circle);
    } else {
      const endAngle = startAngle + pct * 360;
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;

      const x1 = CX + R * Math.cos(toRad(startAngle));
      const y1 = CY + R * Math.sin(toRad(startAngle));
      const x2 = CX + R * Math.cos(toRad(endAngle));
      const y2 = CY + R * Math.sin(toRad(endAngle));

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`);
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
    legend.innerHTML = `<span class="legend-dot" style="background:${subj.color}"></span> ${subj.name} (${Math.round(pct * 100)}%)`;
    DOM.pieLegend.appendChild(legend);
  }
}

function renderBarChart(dailyTotals, allSessions) {
  const sessions = allSessions || Storage.allSessions();
  const W = 400, H = 200, PAD = 40;
  const maxVal = Math.max(3600, ...Object.values(dailyTotals));
  const maxH   = H - PAD * 2;
  const stepX  = (W - PAD * 2) / 7;
  const barW   = stepX * 0.6;
  const parts = [];

  parts.push(`<line x1="${PAD}" y1="${PAD}" x2="${W-PAD}" y2="${PAD}" class="chart-grid-line"/>`);
  parts.push(`<line x1="${PAD}" y1="${H-PAD}" x2="${W-PAD}" y2="${H-PAD}" class="chart-grid-line"/>`);
  parts.push(`<text x="${PAD-5}" y="${PAD+4}" text-anchor="end" class="chart-axis-label">${formatDurationShort(maxVal)}</text>`);
  parts.push(`<text x="${PAD-5}" y="${H-PAD+4}" text-anchor="end" class="chart-axis-label">0m</text>`);

  for (let i = 6; i >= 0; i--) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    const dayEnd   = dayStart + DAY_MS;

    const x = PAD + (6 - i) * stepX + (stepX - barW) / 2;
    let currentY = H - PAD;

    for (const subj of SUBJECTS) {
      const subjDur = sessions
        .filter(s => s.subject === subj.key && new Date(s.end).getTime() >= dayStart && new Date(s.end).getTime() <  dayEnd)
        .reduce((sum, s) => sum + s.duration, 0);

      if (subjDur > 0) {
        const barH = (subjDur / maxVal) * maxH;
        currentY -= barH;
        parts.push(`<rect x="${x}" y="${currentY}" width="${barW}" height="${barH}" fill="${subj.color}" rx="2" class="bar-chart-bar"><title>${subj.name}: ${formatDurationShort(subjDur)}</title></rect>`);
      }
    }
    parts.push(`<text x="${x + barW/2}" y="${H - PAD + 15}" text-anchor="middle" class="chart-axis-label">${d.getMonth() + 1}/${d.getDate()}</text>`);
  }
  DOM.barChart.innerHTML = parts.join('');
}


// -- DASHBOARD: GOALS & QUESTIONS -- //

function renderGoalProgress(allSessions) {
  const goals    = Storage.getGoals();
  const q        = Storage.getQuestions(new Date());
  const goalSecs = goals.hours * 3600 + goals.minutes * 60;
  const todaySecs= getTodayTotalSeconds(allSessions);
  const totalQ   = (q.phy || 0) + (q.chem || 0) + (q.maths || 0);

  DOM.timeGoalText.textContent = `${formatDurationShort(todaySecs)} / ${formatDurationShort(goalSecs)}`;
  DOM.timeGoalText.classList.toggle('met', goalSecs > 0 && todaySecs >= goalSecs);

  DOM.questionsGoalText.textContent = `${totalQ} / ${goals.questions}`;
  DOM.questionsGoalText.classList.toggle('met', goals.questions > 0 && totalQ >= goals.questions);
}

function renderGoals(allSessions) {
  const goals = Storage.getGoals();
  const q     = Storage.getQuestions(new Date());

  DOM.goalHours.value     = goals.hours;
  DOM.goalMinutes.value   = goals.minutes;
  DOM.questionsGoal.value = goals.questions;
  DOM.qPhy.value          = q.phy;
  DOM.qChem.value         = q.chem;
  DOM.qMaths.value        = q.maths;

  renderGoalProgress(allSessions);
}

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

// Retrieve sessions once and pass to all render functions — avoids redundant allSessions() calls
function renderDashboard() {
  const allSessions = Storage.allSessions(); // Single fetch for entire dashboard
  const dailyTotals = computeDailyTotals(7, allSessions);
  renderStats(dailyTotals, allSessions);
  renderPieChart(allSessions);
  renderBarChart(dailyTotals, allSessions);
  renderGoals(allSessions);
}

// TEST DASHBOARD LOGIC
let errFilterSubject = 'all';
let errFilterType = 'all';


function renderTestDashboard() {
  const tests = Storage.getTests().slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  // 1. Stats Cards
  if (tests.length === 0) {
    DOM.testStatsCards.innerHTML = `
      <div class="stat-card"><div class="stat-icon"><i class="ph-fill ph-flag-checkered"></i></div><div class="stat-label">Last Test</div><div class="stat-value">N/A</div></div>
      <div class="stat-card"><div class="stat-icon"><i class="ph-fill ph-chart-line-up"></i></div><div class="stat-label">Predicted Score</div><div class="stat-value">N/A</div></div>
      <div class="stat-card"><div class="stat-icon"><i class="ph-fill ph-target"></i></div><div class="stat-label">Avg Accuracy</div><div class="stat-value">N/A</div></div>
    `;
  } else {
    const last = tests[tests.length - 1];
    const last3 = tests.slice(-3);
    
    // Calculate average obtained and total marks instead of percentage
    const avgObtained = last3.reduce((sum, t) => sum + t.obtainedMarks, 0) / last3.length;
    const avgTotal = last3.reduce((sum, t) => sum + t.totalMarks, 0) / last3.length;
    const avgAcc = last3.reduce((sum, t) => sum + t.accuracy, 0) / last3.length;
    
    DOM.testStatsCards.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><i class="ph-fill ph-flag-checkered"></i></div>
        <div class="stat-label">Last Test</div>
        <div class="stat-value">${last.obtainedMarks} / ${last.totalMarks}</div>
        <div class="stat-sub">${escapeHtml(last.name)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="ph-fill ph-chart-line-up"></i></div>
        <div class="stat-label">Predicted Score</div>
        <div class="stat-value">${Math.round(avgObtained)} / ${Math.round(avgTotal)}</div>
        <div class="stat-sub">Avg of last 3 tests</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="ph-fill ph-target"></i></div>
        <div class="stat-label">Avg Accuracy</div>
        <div class="stat-value">${avgAcc.toFixed(1)}%</div>
        <div class="stat-sub">Last 3 tests</div>
      </div>
    `;
  }

  // 2. Line Chart
  renderTestLineChart(tests);

  // 3. History List
  DOM.testHistoryList.innerHTML = '';
  if (tests.length === 0) {
    DOM.testHistoryList.innerHTML = '<div style="text-align:center;padding:2rem 1rem;color:var(--muted);font-size:0.85rem">No tests logged yet.</div>';
    return;
  }
  [...tests].reverse().forEach(t => {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-item-info">
        <div class="log-item-subject">${escapeHtml(t.name)}</div>
        <div class="log-item-desc">${new Date(t.date).toLocaleDateString()}</div>
      </div>
      <div class="log-item-duration" style="color: var(--info)">${t.obtainedMarks}/${t.totalMarks}</div>
      <div class="log-item-duration" style="color: var(--accent)">${t.accuracy}% Acc</div>
      <button class="log-item-delete" data-id="${t.id}"><i class="ph ph-x"></i></button>
    `;
    DOM.testHistoryList.appendChild(item);
  });
}

function renderTestLineChart(tests) {
  const W = 400, H = 200, PAD = 40;
  const maxMarks = Math.max(...tests.map(t => t.totalMarks), 100);
  const parts = [];

  parts.push(`<line x1="${PAD}" y1="${PAD}" x2="${W-PAD}" y2="${PAD}" class="chart-grid-line"/>`);
  parts.push(`<line x1="${PAD}" y1="${H-PAD}" x2="${W-PAD}" y2="${H-PAD}" class="chart-grid-line"/>`);
  parts.push(`<text x="${PAD-5}" y="${PAD+4}" text-anchor="end" class="chart-axis-label">${maxMarks}</text>`);
  parts.push(`<text x="${PAD-5}" y="${H-PAD+4}" text-anchor="end" class="chart-axis-label">0</text>`);

  if (tests.length === 0) {
    DOM.testLineChart.innerHTML = parts.join('') + `<text x="${W/2}" y="${H/2}" text-anchor="middle" class="chart-axis-label" style="font-size: 12px;">No test data to plot</text>`;
    return;
  }

  if (tests.length === 1) {
    const x = W / 2;
    const y = H - PAD - (tests[0].obtainedMarks / maxMarks) * (H - PAD * 2);
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="var(--accent)"/>`);
    DOM.testLineChart.innerHTML = parts.join('');
    return;
  }

  const stepX = (W - PAD * 2) / (tests.length - 1);
  const points = tests.map((t, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - (t.obtainedMarks / maxMarks) * (H - PAD * 2);
    return { x, y, val: t.obtainedMarks };
  });

  let pathD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  parts.push(`<path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
  const areaD = `${pathD} L ${points[points.length-1].x} ${H-PAD} L ${points[0].x} ${H-PAD} Z`;
  parts.push(`<path d="${areaD}" fill="var(--accent)" opacity="0.1"/>`);

  points.forEach(p => {
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--accent)"/>`);
    if (tests.length <= 8) {
      parts.push(`<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" class="chart-axis-label" style="fill: var(--fg);">${p.val}</text>`);
    }
  });

  DOM.testLineChart.innerHTML = parts.join('');
}

// Set default date to today on load
if (DOM.testDateInput) {
  DOM.testDateInput.value = new Date().toISOString().split('T')[0];
}

// Set default date to today on load
if (DOM.testDateInput) {
  DOM.testDateInput.value = new Date().toISOString().split('T')[0];
}

if (DOM.addTestForm) {
  DOM.addTestForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Safely parse the date string to avoid timezone off-by-one errors
    const dateStr = DOM.testDateInput.value;
    let testDate = new Date(); // fallback to now
    
    if (dateStr) {
      const parts = dateStr.split('-');
      // parts[0] = year, parts[1] = month (0-indexed), parts[2] = day
      testDate = new Date(parts[0], parts[1] - 1, parts[2]);
      testDate.setHours(new Date().getHours(), new Date().getMinutes()); // Add current time so it sorts correctly
    }

    const test = {
      id: generateId(),
      date: testDate.toISOString(),
      name: DOM.testNameInput.value.trim() || 'Mock Test',
      totalMarks: parseInt(DOM.testTotalInput.value, 10) || 300,
      obtainedMarks: parseInt(DOM.testObtainedInput.value, 10) || 0,
      accuracy: parseFloat(DOM.testAccuracyInput.value) || 0
    };
    Storage.addTest(test);
    showToast('Test logged successfully', 'success');
    DOM.addTestForm.reset();
    DOM.testTotalInput.value = 300;
    
    // Reset the date picker to today after submission
    DOM.testDateInput.value = new Date().toISOString().split('T')[0];
    
    renderTestDashboard();
  });
}

if (DOM.testHistoryList) {
  DOM.testHistoryList.addEventListener('click', (e) => {
    const btn = e.target.closest('.log-item-delete');
    if (!btn) return;
    Storage.removeTest(btn.dataset.id);
    showToast('Test removed', 'neutral');
    renderTestDashboard();
  });
}


// ERROR LOG LOGIC

function getErrorTypeColor(type) {
  switch (type) {
    case 'Conceptual Gap':   return 'rgb(244, 63, 94)'; // Physics Red
    case 'Silly Mistake':    return 'rgb(59, 130, 246)'; // Chem Blue
    case 'Calculation Error':return 'rgb(139, 92, 246)'; // Maths Purple
    case 'Others':           return 'rgb(107, 107, 107)'; // Muted Gray
    default: return 'var(--muted)';
  }
}

function initErrorFilters() {
  if (!DOM.errorSubjectFilters || !DOM.errorTypeFilters) return;

  const subjectFilters = [
    { key: 'all', name: 'All Subjects' },
    ...SUBJECTS.map(s => ({ key: s.key, name: s.name }))
  ];
  // Removed old tags, added Others
  const typeFilters = [
    { key: 'all', name: 'All Types' },
    { key: 'Conceptual Gap', name: 'Conceptual' },
    { key: 'Silly Mistake', name: 'Silly' },
    { key: 'Calculation Error', name: 'Calculation' },
    { key: 'Others', name: 'Others' }
  ];

  DOM.errorSubjectFilters.innerHTML = subjectFilters.map(f => 
    `<button class="filter-tab ${f.key === 'all' ? 'active' : ''}" data-filter="${f.key}">${f.name}</button>`
  ).join('');
  
  DOM.errorTypeFilters.innerHTML = typeFilters.map(f => 
    `<button class="filter-tab ${f.key === 'all' ? 'active' : ''}" data-filter="${f.key}">${f.name}</button>`
  ).join('');

  DOM.errorSubjectFilters.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.errorSubjectFilters.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      errFilterSubject = btn.dataset.filter;
      renderErrorLog();
    });
  });

  DOM.errorTypeFilters.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.errorTypeFilters.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      errFilterType = btn.dataset.filter;
      renderErrorLog();
    });
  });
}

let editingErrorId = null;

function renderErrorLog() {
  if (!DOM.errorLogList) return;
  
  let errors = Storage.getErrors().slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  if (errFilterSubject !== 'all') errors = errors.filter(e => e.subject === errFilterSubject);
  if (errFilterType !== 'all') errors = errors.filter(e => e.errorType === errFilterType);

  DOM.errorLogList.innerHTML = '';
  
  if (errors.length === 0) {
    DOM.errorLogList.innerHTML = '<div class="error-empty-state">No errors match your filters.</div>';
    return;
  }

  errors.forEach(e => {
    const subj = subjectByKey(e.subject);
    const typeColor = getErrorTypeColor(e.errorType);
    
    const dateObj = new Date(e.date);
    const formattedDate = dateObj.toLocaleDateString(undefined, { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    let takeawayHtml = '';
    let actionsHtml = '';

    if (editingErrorId === e.id) {
      // Edit Mode UI
      takeawayHtml = `
        <textarea class="error-edit-input" id="errorEditInput-${e.id}" rows="4" placeholder="Edit your takeaway...">${escapeHtml(e.takeaway)}</textarea>
        <div class="error-edit-actions">
          <button class="error-save-btn" data-id="${e.id}"><i class="ph ph-check"></i> Save</button>
          <button class="error-cancel-btn" data-id="${e.id}"><i class="ph ph-x"></i> Cancel</button>
        </div>
      `;
    } else {
      // Normal Mode UI
      let parsedTakeaway = escapeHtml(e.takeaway || "").replace(/\n/g, '<br>'); 
      if (typeof marked !== 'undefined') {
        try {
          marked.setOptions({ breaks: true, gfm: true });
          parsedTakeaway = marked.parse(e.takeaway || "");
        } catch (err) {
          console.error("Markdown parsing failed:", err);
        }
      }
      takeawayHtml = `<div class="error-takeaway markdown-body">${parsedTakeaway}</div>`;
      
      actionsHtml = `
        <button class="error-action-btn error-edit-btn" data-id="${e.id}" aria-label="Edit description">
          <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="error-action-btn error-delete-btn" data-id="${e.id}" aria-label="Delete error">
          <i class="ph ph-trash"></i>
        </button>
      `;
    }
    
    const card = document.createElement('div');
    card.className = 'error-card';
    card.dataset.errorId = e.id;
    card.innerHTML = `
      <div class="error-actions-top">
        ${actionsHtml}
      </div>
      <div class="error-content">
        <h3 class="error-chapter">${escapeHtml(e.chapter)}</h3>
        <p class="error-date">${formattedDate}</p>
        
        <div class="error-tags">
          <span class="error-tag" style="background:${subj.color}22;color:${subj.color}">
            <i class="ph-fill ${subj.icon}"></i> ${subj.name}
          </span>
          <span class="error-tag" style="background:${typeColor}22;color:${typeColor}">
            ${escapeHtml(e.errorType)}
          </span>
        </div>
        
        <div class="error-divider"></div>
        
        ${takeawayHtml}
      </div>
    `;
    DOM.errorLogList.appendChild(card);
  });

  // Focus the textarea if we are editing
  if (editingErrorId) {
    const ta = document.getElementById(`errorEditInput-${editingErrorId}`);
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }
}

if (DOM.errorLogList) {
  DOM.errorLogList.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.error-edit-btn');
    const cancelBtn = e.target.closest('.error-cancel-btn');
    const saveBtn = e.target.closest('.error-save-btn');
    const deleteBtn = e.target.closest('.error-delete-btn');

    if (editBtn) {
      editingErrorId = editBtn.dataset.id;
      renderErrorLog();
    } else if (cancelBtn) {
      editingErrorId = null;
      renderErrorLog();
    } else if (saveBtn) {
      const id = saveBtn.dataset.id;
      const textarea = document.getElementById(`errorEditInput-${id}`);
      if (textarea) {
        const newTakeaway = textarea.value.trim();
        Storage.updateErrorTakeaway(id, newTakeaway);
        editingErrorId = null;
        renderErrorLog();
        showToast('Error updated', 'success');
      }
    } else if (deleteBtn) {
      Storage.removeError(deleteBtn.dataset.id);
      showToast('Error removed', 'neutral');
      renderErrorLog();
    }
  });
}

// Initialize filters on load
initErrorFilters();

function renderAll() {
  renderSessionLog();
  renderDashboard();
  renderTestDashboard();
  renderErrorLog();
}


// BACKUP & RESTORE
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
  a.download = 'keystone-backup.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Backup exported to keystone-backup.json', 'success');
}

function isValidBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.data || typeof parsed.data !== 'object') return false;
  if (!parsed.data.tracker || typeof parsed.data.tracker !== 'object') return false;
  return true;
}

function handleImportFile(file) {
  if (!file) return;
  
  if (!file.name.toLowerCase().endsWith('.json')) {
    showToast('Please select a .json backup file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!isValidBackup(parsed)) {
        showToast("Invalid backup file format", "error");
        return;
      }
      saveNotesDebounced.cancel();
      Storage.replaceAll(parsed.data);
      checkStorageSize();
      showToast('Backup loaded successfully! Reloading…', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      console.error(err);
      showToast('Error reading JSON file', 'error');
    }
  };
  reader.onerror = () => showToast('Failed to read file', 'error');
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
  if ((e.ctrlKey || e.metaKey) && KEYBOARD_SHORTCUTS[e.key]) {
    e.preventDefault();
    switchSection(KEYBOARD_SHORTCUTS[e.key]);
    return;
  }

  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'ArrowLeft') {
    activeSection === 'taskflow' ? tfNavigateDay(-1) : navigateCalendar(-1);
  }
  if (e.key === 'ArrowRight') {
    activeSection === 'taskflow' ? tfNavigateDay(1) : navigateCalendar(1);
  }

  if (e.key === '/' && activeSection === 'taskflow' && !tfEditingId) {
    e.preventDefault();
    DOM.todoInput.focus();
  }
});

renderAll();
checkStorageSize();


// TASKFLOW FRONTEND LOGIC

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str)
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
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } 
    catch(e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playCompletionSfx() {
  try {
    const ctx = getAudioCtx();
    if(!ctx) return;
    const t = ctx.currentTime;
    const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain();
    osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
    osc1.type = 'sine'; osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, t); osc2.frequency.setValueAtTime(880, t);
    osc1.frequency.exponentialRampToValueAtTime(587.33, t + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc1.start(t); osc2.start(t); osc1.stop(t + 0.28); osc2.stop(t + 0.28);
  } catch (e) {}
}

function play100Sfx() {
  try {
    const ctx = getAudioCtx();
    if(!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      const start = t + i * 0.12;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.start(start); osc.stop(start + 0.32);
    });
  } catch (e) {}
}

// --- STATE --- //
let tfTodos = [];
let tfCurrentFilter = 'all';
let tfEditingId = null;
let tfSelectedYear = 0;
let tfSelectedMonth = 0;
let tfSelectedDay = 1;
let tfIsTransitioning = false;

function tfSelectedDate() { return new Date(tfSelectedYear, tfSelectedMonth, tfSelectedDay); }
function tfIsToday() {
  const now = new Date();
  return tfSelectedYear === now.getFullYear() && tfSelectedMonth === now.getMonth() && tfSelectedDay === now.getDate();
}
function tfGetOrdinalSuffix(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function tfNavigateDay(delta) {
  if (tfIsTransitioning) return;
  const d = new Date(tfSelectedYear, tfSelectedMonth, tfSelectedDay + delta);
  tfSelectedYear = d.getFullYear(); tfSelectedMonth = d.getMonth(); tfSelectedDay = d.getDate();
  tfSwitchDay();
}

function tfGoToToday() {
  if (tfIsTransitioning || tfIsToday()) return;
  const now = new Date();
  tfSelectedYear = now.getFullYear(); tfSelectedMonth = now.getMonth(); tfSelectedDay = now.getDate();
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
    tfEditingId = null; tfCurrentFilter = 'all';
    DOM.filterTabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    if (DOM.filterTabs[0]) { DOM.filterTabs[0].classList.add('active'); DOM.filterTabs[0].setAttribute('aria-selected', 'true'); }
    tfUpdateDateDisplay();
    tfRender();
    DOM.contentArea.classList.remove('transitioning');
    tfIsTransitioning = false;
  };

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion) {
    DOM.contentArea.classList.add('transitioning');
    setTimeout(finishTransition, 160);
    setTimeout(finishTransition, 500);
  } else {
    finishTransition();
  }
}

function tfUpdateDateDisplay() {
  const d = tfSelectedDate();
  DOM.dayNameEl.textContent = DAY_NAMES[d.getDay()];
  const suffix = tfGetOrdinalSuffix(tfSelectedDay);
  let dateStr = MONTH_NAMES[tfSelectedMonth] + ' ' + tfSelectedDay + suffix;
  if (tfSelectedYear !== new Date().getFullYear()) dateStr += ', ' + tfSelectedYear;
  
  DOM.dayDateEl.textContent = dateStr;
  DOM.todayChip.style.display = tfIsToday() ? 'none' : 'inline-flex';
  DOM.dayNameEl.classList.toggle('is-today', tfIsToday());
  DOM.dayDateEl.classList.toggle('is-today', tfIsToday());
}

function tfLoadTodos() { tfTodos = Storage.getTodos(tfSelectedDate()); }
function tfSaveTodos() { Storage.setTodos(tfSelectedDate(), tfTodos); }
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
      emptyTitle = 'No active tasks'; emptyMsg = 'Everything is done. Well played.'; emptyIcon = 'ph ph-smiley';
    } else if (tfCurrentFilter === 'completed' && total > 0) {
      emptyTitle = 'Nothing completed yet'; emptyMsg = 'Complete some tasks to see them here.'; emptyIcon = 'ph ph-check-circle';
    } else {
      emptyTitle = 'All clear'; emptyMsg = 'Add your first task to get started.'; emptyIcon = 'ph ph-clipboard-text';
    }
    DOM.todoList.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="${emptyIcon}"></i></div><p class="empty-title">${escapeHtml(emptyTitle)}</p><p class="empty-desc">${escapeHtml(emptyMsg)}</p></div>`;
    return;
  }

  filtered.forEach((todo, index) => {
    const item = document.createElement('div');
    item.className = 'todo-item' + (todo.completed ? ' completed' : '');
    item.style.animationDelay = Math.min(index * 0.04, 0.4) + 's';
    item.dataset.id = todo.id;

    if (tfEditingId === todo.id) {
      item.innerHTML = `
        <div class="checkbox-wrapper">
          <input type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="Mark task complete">
          <div class="checkbox-visual"><svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg></div>
        </div>
        <input type="text" class="edit-input" value="${escapeAttr(todo.text)}" maxlength="200" aria-label="Edit task">
        <div class="todo-actions" style="opacity:1">
          <button class="action-btn save-btn" aria-label="Save edit" title="Save"><i class="ph ph-check"></i></button>
          <button class="action-btn cancel-btn" aria-label="Cancel edit" title="Cancel"><i class="ph ph-x"></i></button>
        </div>`;
    } else {
      item.innerHTML = `
        <div class="checkbox-wrapper">
          <input type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="Mark task complete">
          <div class="checkbox-visual"><svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg></div>
        </div>
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <div class="todo-actions">
          <button class="action-btn edit-btn" aria-label="Edit task" title="Edit"><i class="ph ph-pencil-simple"></i></button>
          <button class="action-btn delete" aria-label="Delete task" title="Delete"><i class="ph ph-trash"></i></button>
        </div>`;
    }

    DOM.todoList.appendChild(item);

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => tfToggleTodo(todo.id));

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

      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { tfEditingId = null; tfRender(); }
      });

      saveBtn.addEventListener('click', save);
      cancelBtn.addEventListener('click', () => { tfEditingId = null; tfRender(); });
    } else {
      const editBtn = item.querySelector('.edit-btn');
      if (editBtn) editBtn.addEventListener('click', () => { tfEditingId = todo.id; tfRender(); });

      const deleteBtn = item.querySelector('.action-btn.delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          item.classList.add('removing');
          setTimeout(() => tfDeleteTodo(todo.id), 300);
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
    if (wrapper) {
      wrapper.style.animation = 'none';
      void wrapper.offsetHeight;
      wrapper.style.animation = 'shake 0.4s ease';
    }
    return;
  }

  const todo = {
    id: generateId(),
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
      if (allDone) setTimeout(play100Sfx, 250);
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
  showToast(`${count} task${count !== 1 ? 's' : ''} cleared`, 'neutral');
}

// --- INITIALIZATION --- //
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
if (DOM.todoInput) DOM.todoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tfAddTodo(); });
if (DOM.clearCompletedBtn) DOM.clearCompletedBtn.addEventListener('click', tfClearCompleted);

const prevDayEl = document.getElementById('prevDay');
const nextDayEl = document.getElementById('nextDay');
if (prevDayEl) prevDayEl.addEventListener('click', () => tfNavigateDay(-1));
if (nextDayEl) nextDayEl.addEventListener('click', () => tfNavigateDay(1));
if (DOM.todayChip) DOM.todayChip.addEventListener('click', tfGoToToday);

DOM.filterTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    DOM.filterTabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    tfCurrentFilter = tab.dataset.filter;
    tfRender();
  });
});

initTaskflow();

// TASKSET LOGIC (GLOBAL TODOS, CLOCK, ZEN)

let tsTodos = [];
let tsCurrentFilter = 'all';
let tsEditingId = null;
let isZenMode = false;

// --- Tab Switching ---
function tsSwitchTab(tabName) {
  if (tabName === 'daily') {
    DOM.tabDailyFlow.classList.add('active');
    DOM.tabDailyFlow.setAttribute('aria-selected', 'true');
    DOM.tabTaskset.classList.remove('active');
    DOM.tabTaskset.setAttribute('aria-selected', 'false');
    DOM.dailyFlowContainer.style.display = 'block';
    DOM.tasksetContainer.style.display = 'none';
  } else {
    DOM.tabTaskset.classList.add('active');
    DOM.tabTaskset.setAttribute('aria-selected', 'true');
    DOM.tabDailyFlow.classList.remove('active');
    DOM.tabDailyFlow.setAttribute('aria-selected', 'false');
    DOM.tasksetContainer.style.display = 'block';
    DOM.dailyFlowContainer.style.display = 'none';
    tsRender();
  }
}

DOM.tabDailyFlow.addEventListener('click', () => tsSwitchTab('daily'));
DOM.tabTaskset.addEventListener('click', () => tsSwitchTab('taskset'));

// --- Clock ---
function tsUpdateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  if (DOM.tasksetClockDisplay) {
    DOM.tasksetClockDisplay.textContent = `${hours}:${minutes}:${seconds}`;
  }
}

setInterval(tsUpdateClock, 1000);
tsUpdateClock();

// --- Zen Mode ---
function tsToggleZenMode() {
  isZenMode = !isZenMode;
  if (isZenMode) {
    document.body.classList.add('zen-mode');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        console.log("Fullscreen request denied");
      });
    }
  } else {
    document.body.classList.remove('zen-mode');
    if (document.exitFullscreen && document.fullscreenElement) {
      document.exitFullscreen();
    }
  }
}

if (DOM.tasksetClockSection) {
  DOM.tasksetClockSection.addEventListener('click', tsToggleZenMode);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isZenMode) {
    tsToggleZenMode();
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && isZenMode) {
    isZenMode = false;
    document.body.classList.remove('zen-mode');
  }
});

// --- Global Todo Logic ---
function tsLoadTodos() { tsTodos = Storage.getGlobalTodos(); }
function tsSaveTodos() { Storage.setGlobalTodos(tsTodos); }

function tsGetFilteredTodos() {
  switch (tsCurrentFilter) {
    case 'active': return tsTodos.filter(t => !t.completed);
    case 'completed': return tsTodos.filter(t => t.completed);
    default: return tsTodos;
  }
}

function tsRender() {
  const filtered = tsGetFilteredTodos();
  const activeTodos = tsTodos.filter(t => !t.completed);
  const completedTodos = tsTodos.filter(t => t.completed);
  const total = tsTodos.length;

  if (total > 0) {
    DOM.globalStatsBar.style.display = 'flex';
    DOM.globalProgressSection.style.display = 'block';
    DOM.globalActiveCount.textContent = activeTodos.length;
    const pct = Math.round((completedTodos.length / total) * 100);
    DOM.globalProgressFill.style.width = pct + '%';
    DOM.globalProgressPct.textContent = pct + '%';
  } else {
    DOM.globalStatsBar.style.display = 'none';
    DOM.globalProgressSection.style.display = 'none';
  }

  DOM.globalClearCompletedBtn.style.display = completedTodos.length > 0 ? 'inline-flex' : 'none';
  DOM.globalTodoList.innerHTML = '';

  if (filtered.length === 0) {
    let emptyMsg, emptyTitle, emptyIcon;
    if (tsCurrentFilter === 'active' && total > 0) {
      emptyTitle = 'No active tasks'; emptyMsg = 'Everything is done. Well played.'; emptyIcon = 'ph ph-smiley';
    } else if (tsCurrentFilter === 'completed' && total > 0) {
      emptyTitle = 'Nothing completed yet'; emptyMsg = 'Complete some tasks to see them here.'; emptyIcon = 'ph ph-check-circle';
    } else {
      emptyTitle = 'Global list clear'; emptyMsg = 'Capture ideas that don\'t belong to a specific day.'; emptyIcon = 'ph ph-clipboard-text';
    }
    DOM.globalTodoList.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="${emptyIcon}"></i></div><p class="empty-title">${escapeHtml(emptyTitle)}</p><p class="empty-desc">${escapeHtml(emptyMsg)}</p></div>`;
    return;
  }

  filtered.forEach((todo, index) => {
    const item = document.createElement('div');
    item.className = 'todo-item fade-in' + (todo.completed ? ' completed' : '');
    item.style.animationDelay = Math.min(index * 0.04, 0.4) + 's';
    item.dataset.id = todo.id;

    if (tsEditingId === todo.id) {
      item.innerHTML = `
        <div class="checkbox-wrapper">
          <input type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="Mark task complete">
          <div class="checkbox-visual"><svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg></div>
        </div>
        <input type="text" class="edit-input" value="${escapeAttr(todo.text)}" maxlength="200" aria-label="Edit global task">
        <div class="todo-actions" style="opacity:1">
          <button class="action-btn save-btn" aria-label="Save edit" title="Save"><i class="ph ph-check"></i></button>
          <button class="action-btn cancel-btn" aria-label="Cancel edit" title="Cancel"><i class="ph ph-x"></i></button>
        </div>`;
    } else {
      item.innerHTML = `
        <div class="checkbox-wrapper">
          <input type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="Mark task complete">
          <div class="checkbox-visual"><svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg></div>
        </div>
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <div class="todo-actions">
          <button class="action-btn edit-btn" aria-label="Edit task" title="Edit"><i class="ph ph-pencil-simple"></i></button>
          <button class="action-btn delete" aria-label="Delete task" title="Delete"><i class="ph ph-trash"></i></button>
        </div>`;
    }

    DOM.globalTodoList.appendChild(item);

    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => tsToggleTodo(todo.id));

    if (tsEditingId === todo.id) {
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
          const t = tsTodos.find(x => x.id === todo.id);
          if (t) t.text = newText;
          tsSaveTodos();
          showToast('Global task updated', 'success');
        }
        tsEditingId = null;
        tsRender();
      };

      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { tsEditingId = null; tsRender(); }
      });

      saveBtn.addEventListener('click', save);
      cancelBtn.addEventListener('click', () => { tsEditingId = null; tsRender(); });
    } else {
      const editBtn = item.querySelector('.edit-btn');
      if (editBtn) editBtn.addEventListener('click', () => { tsEditingId = todo.id; tsRender(); });

      const deleteBtn = item.querySelector('.action-btn.delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          item.classList.add('removing');
          setTimeout(() => tsDeleteTodo(todo.id), 300);
        });
      }
    }
  });
}

function tsAddTodo() {
  const text = DOM.globalTodoInput.value.trim();
  if (!text) {
    DOM.globalTodoInput.focus();
    return;
  }

  const todo = {
    id: generateId(),
    text: text,
    completed: false,
    createdAt: Date.now()
  };

  tsTodos.unshift(todo);
  tsSaveTodos();
  DOM.globalTodoInput.value = '';
  DOM.globalTodoInput.focus();
  tsRender();
  showToast('Global task added', 'success');
}

function tsToggleTodo(id) {
  const todo = tsTodos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    if (todo.completed) {
      playCompletionSfx();
    }
    tsSaveTodos();
    tsRender();
  }
}

function tsDeleteTodo(id) {
  tsTodos = tsTodos.filter(t => t.id !== id);
  tsSaveTodos();
  tsRender();
  showToast('Global task removed', 'neutral');
}

function tsClearCompleted() {
  const count = tsTodos.filter(t => t.completed).length;
  tsTodos = tsTodos.filter(t => !t.completed);
  tsSaveTodos();
  tsRender();
  showToast(`${count} global task${count !== 1 ? 's' : ''} cleared`, 'neutral');
}

// --- Initialization ---
function initTaskset() {
  tsLoadTodos();
  
  if (DOM.globalAddBtn) DOM.globalAddBtn.addEventListener('click', tsAddTodo);
  if (DOM.globalTodoInput) DOM.globalTodoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tsAddTodo(); });
  if (DOM.globalClearCompletedBtn) DOM.globalClearCompletedBtn.addEventListener('click', tsClearCompleted);

  DOM.globalFilterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      DOM.globalFilterTabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      tsCurrentFilter = tab.dataset.globalFilter;
      tsRender();
    });
  });
}

initTaskset();



// [IMPROVEMENT] CROSS-TAB SYNCHRONIZATION
window.addEventListener('storage', (e) => {
  // Only react to changes on our primary storage key (ignore _tmp backup operations)
  if (e.key !== STORAGE_KEY) return;

  // Invalidate all caches to force a fresh read from localStorage
  Storage._cache = null;
  Storage._invalidateSessionsCache();

  // Reload latest data
  Storage.read();

  // Restore active session if it was updated in another tab.
  const saved = Storage.getActiveSession();
  if (saved && (saved.startedAt || saved.isPaused)) {
    Object.assign(activeTracker, saved);
  } else {
    resetActiveTrackerFields(); // In-memory only
  }
  DOM.subjectSelect.value = activeTracker.subject;
  DOM.sessionDesc.value = activeTracker.description;
  updateTimerUI();

  // Update notes from other tab only if the user is not actively editing
  if (!saveNotesDebounced.isPending()) {
    DOM.notesInput.value = Storage.getNotes();
    DOM.notesSaveIndicator.textContent = 'All changes saved';
    DOM.notesSaveIndicator.classList.remove('saving');
    updateNotesCount();
  }

  // Reload todos for both task lists so they reflect cross-tab changes
  tfLoadTodos();
  tsLoadTodos();

  // Re-render everything
  renderAll();
  tfRender();
  tsRender();
});


// [IMPROVEMENT] SAVE BEFORE CLOSING
function flushBeforeClose() {
  // Flush any pending debounced note save immediately
  if (typeof saveNotesDebounced.flush === 'function') {
    saveNotesDebounced.flush();
  }

  // Extra safety: directly save notes if content differs from what's stored
  // (covers edge cases where the debounce timer wasn't running but input changed)
  if (DOM.notesInput && DOM.notesInput.value !== Storage.getNotes()) {
    Storage.setNotes(DOM.notesInput.value);
  }

  // Persist the current active timer session so it survives page reload
  if (activeTracker.startedAt || activeTracker.pausedAccumulated > 0) {
    Storage.setActiveSession({ ...activeTracker });
  }
}

window.addEventListener('beforeunload', flushBeforeClose);
window.addEventListener('pagehide', flushBeforeClose);