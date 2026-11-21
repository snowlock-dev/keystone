const APP_NAME    = "Keystone";
const APP_VERSION = "1";
const STORAGE_KEY = "keystone";

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

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const KEYBOARD_SHORTCUTS = {
  '1':'home', 
  '2':'taskflow', 
  '3':'notes',
  '4':'tests',
  '5':'errors'
};


if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}



// --- UTILITY FUNCTIONS --- //

// Unified ID generator to prevent collisions
function generateId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
}

function getLevenshteinDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  if (s1.length < s2.length) [s1, s2] = [s2, s1];
  let costs = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    let last = i;
    for (let j = 0; j < s2.length; j++) {
      let temp = costs[j + 1];
      costs[j + 1] = Math.min(
        costs[j + 1] + 1,
        costs[j] + 1,
        last + (s1[i] === s2[j] ? 0 : 1)
      );
      last = temp;
    }
  }
  return costs[s2.length];
}

// Deep clone helper for transactional updates
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

function getBackupFilename() {
  const now = new Date();
  const monthShort = MONTH_NAMES_SHORT[now.getMonth()];
  const day = String(now.getDate()).padStart(2, '0');
  return `keystone-backup-${monthShort}-${day}.json`;
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
    showToast(warningMsg, 'error');
  }
}

// debounce with flush() and isPending() for safe cleanup on unload
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
  // Immediately invoke pending callback
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
  // [Check if a debounced call is pending (used to avoid overwriting local edits during cross-tab sync)
  wrapped.isPending = () => pending;
  return wrapped;
}

function subjectByKey(key) {
  return SUBJECTS.find(s => s.key === key) || SUBJECTS[0];
}

function validateData(data) {
  if (!data) return false;
  if (!data.tracker) return false;
  if (!data.tracker.days || typeof data.tracker.days !== "object") return false;

  for (const day of Object.values(data.tracker.days)) {
    if (!day || typeof day !== "object") return false;
    if (!Array.isArray(day.todos)) return false;
  }

  if (!Array.isArray(data.tests)) return false;
  if (!Array.isArray(data.errors)) return false;

  return true;
}


// --- STORAGE LAYER --- //

const Storage = {
  _cache: null,

  _defaultData() {
    return {
      version: 1,
      notes: { content: "" },
      tracker: { days: {} },
      deadline: { date: null, label: 'Until deadline' },
      globalTodos: [],
      tests: [],
      errors: []
    };
  },

  // Transactional update: clone --> modify --> validate --> atomic swap.
  // If anything fails the original _cache is left untouched.
  transaction(fn) {
    const current = this.read();
    const draft = deepClone(current);

    try {
      const result = fn(draft);

      // Validate the entire draft before committing
      if (!validateData(draft)) {
        console.error("Keystone: transaction validation failed; keeping original state");
        showToast('Failed to save data. Please try again.', 'error');
        return false;
      }

      // Atomically replace cache only after validation passes
      this._cache = draft;

      // Persist to localStorage
      const saved = this.write();
      if (!saved) {
        this._cache = current;
        return false;
      }

      return result !== undefined ? result : true;
    } catch (err) {
      console.error("Keystone: transaction failed; keeping original state", err);
      showToast('Storage full! Please export and clear old data.', 'error');
      this._cache = current;
      return false;
    }
  },

  _normalizeData(data) {
    const normalized = this._defaultData();

    if (!data || typeof data !== "object") {
      return normalized;
    }

    // Notes
    if (data.notes && typeof data.notes === "object") {
      normalized.notes = {
        content:
          typeof data.notes.content === "string"
            ? data.notes.content
            : ""
      };
    }

    // Deadline
    if (data.deadline && typeof data.deadline === "object") {
      normalized.deadline = {
        date: typeof data.deadline.date === "string" ? data.deadline.date : null,
        label: typeof data.deadline.label === "string" ? data.deadline.label : 'Until deadline'
      };
    }

    // Tracker
    // Only daily todos are kept; legacy session/question data is ignored.
    if (data.tracker && typeof data.tracker === "object") {
      if (data.tracker.days && typeof data.tracker.days === "object") {
        normalized.tracker.days = {};

        for (const [dayKey, day] of Object.entries(data.tracker.days)) {
          normalized.tracker.days[dayKey] = { todos: [] };

          // Todos
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

    // Global Todos (Taskset)
    normalized.globalTodos = [];
    if (data && Array.isArray(data.globalTodos)) {
      normalized.globalTodos = data.globalTodos
        .filter(t => t && typeof t === "object")
        .map(t => {
          let status = 'todo';
          if (t.status && ['todo', 'doing', 'done'].includes(t.status)) {
            status = t.status;
          } else if (t.completed === true) {
            status = 'done';
          }
          return {
            id:       typeof t.id === "string" ? t.id : generateId(),
            text:     typeof t.text === "string" ? t.text : "",
            status:   status,
            createdAt: Number.isSafeInteger(t.createdAt) ? t.createdAt : Date.now()
          };
        })
        .filter(t => t.text.trim() !== "");
    } else {
      normalized.globalTodos = [];
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
          accuracy: Number.isFinite(t.accuracy) ? t.accuracy : 0,
          rank: Number.isFinite(Number(t.rank)) && Number(t.rank) >= 1 ? Number(t.rank) : (parseInt(t.rank, 10) >= 1 ? parseInt(t.rank, 10) : null)
        }));
    }

    // Normalize Errors
    normalized.errors = [];
    if (Array.isArray(data.errors)) {
      normalized.errors = data.errors
        .filter(e => e && typeof e === "object")
        .map(e => ({
          id: typeof e.id === "string" && e.id.trim() !== "" ? e.id : generateId(),
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
      // Write to temp first, then overwrite real, then clean up
      localStorage.setItem(STORAGE_KEY + "_tmp", json);
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.removeItem(STORAGE_KEY + "_tmp");
      return true;
    } catch (err) {
      if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        console.error("Keystone: Storage limit exceeded.", err);
        showToast('Storage full! Please export your data and clear old data.', 'error');
      } else {
        console.error("Keystone: storage write error", err);
      }
      return false;
    }
  },

  replaceAll(data) {
    // Normalize and validate before replacing cache
    const normalized = this._normalizeData(data);
    if (!validateData(normalized)) {
      console.error("Refusing to replace with invalid data");
      return false;
    }
    this._cache = normalized;
    return this.write();
  },

  // -- Global Todos ------
  getGlobalTodos() { return deepClone(this.read().globalTodos || []); },
  setGlobalTodos(todos) {
    return this.transaction(draft => { draft.globalTodos = todos; });
  },

  // -- Notes ------
  getNotes()       { return this.read().notes.content; },
  setNotes(text)   { return this.transaction(draft => { draft.notes.content = text; }); },
  clearNotes()     { return this.transaction(draft => { draft.notes.content = ''; }); },

  // Ensure a day exists inside a transaction draft: never mutates _cache directly
  _ensureDayInDraft(draft, date) {
    const key  = dayKey(date);
    if (!draft.tracker.days[key]) {
      draft.tracker.days[key] = { todos: [] };
    }
    // Safety fallbacks for older save formats
    if (!draft.tracker.days[key].todos) draft.tracker.days[key].todos = [];
    return draft.tracker.days[key];
  },

  // -- Todos/Tasks ------
  getTodos(date) {
    const day = this.read().tracker.days[dayKey(date)];
    return day ? deepClone(day.todos || []) : [];
  },
  setTodos(date, todos) {
    return this.transaction(draft => { this._ensureDayInDraft(draft, date).todos = todos; });
  },

  // -- Tests ----
  getTests() { return deepClone(this.read().tests || []); },
  addTest(test) { return this.transaction(draft => { draft.tests.push(test); }); },
  removeTest(id) {
    return this.transaction(draft => {
      const before = draft.tests.length;
      draft.tests = draft.tests.filter(t => t.id !== id);
      return draft.tests.length !== before;
    });
  },
  updateTest(id, testData) {
    return this.transaction(draft => {
      const t = draft.tests.find(item => item.id === id);
      if (t) {
        if (testData.name !== undefined) t.name = testData.name;
        if (testData.totalMarks !== undefined) t.totalMarks = testData.totalMarks;
        if (testData.obtainedMarks !== undefined) t.obtainedMarks = testData.obtainedMarks;
        if (testData.date !== undefined) t.date = testData.date;
        if (testData.accuracy !== undefined) t.accuracy = testData.accuracy;
        if (testData.rank !== undefined) t.rank = testData.rank;
        return true;
      }
      return false;
    });
  },

  // -- Errors ----
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
  notesPreview:       $('notesPreview'),
  notesCount:         $('notesCount'),
  notesClearBtn:      $('notesClearBtn'),

  exportBtn:       $('exportBtn'),
  importBtn:       $('importBtn'),
  importFileInput: $('importFileInput'),
  globalSearchBtn: $('globalSearchBtn'),

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

  tabDailyFlow:       $('tabDailyFlow'),
  tabTaskset:         $('tabTaskset'),
  dailyFlowContainer: $('dailyFlowContainer'),
  tasksetContainer:   $('tasksetContainer'),
  tasksetClockSection: $('tasksetClockSection'),
  tasksetClockDisplay: $('tasksetClockDisplay'),

  globalTodoInput:         $('globalTodoInput'),
  globalAddBtn:            $('globalAddBtn'),
  kanbanTodoList:          $('kanbanTodoList'),
  kanbanDoingList:         $('kanbanDoingList'),
  kanbanDoneList:          $('kanbanDoneList'),
  kanbanTodoCount:         $('kanbanTodoCount'),
  kanbanDoingCount:        $('kanbanDoingCount'),
  kanbanDoneCount:         $('kanbanDoneCount'),
  globalStatsBar:          $('globalStatsBar'),
  globalActiveCount:       $('globalActiveCount'),
  globalProgressSection:   $('globalProgressSection'),
  globalProgressFill:      $('globalProgressFill'),
  globalProgressPct:       $('globalProgressPct'),
  globalClearCompletedBtn: $('globalClearCompletedBtn'),

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
  testRankInput:     $('testRankInput'),

  // Error Log
  addErrorForm:      $('addErrorForm'),
  errorLogList:      $('errorLogList'),
  errorSubjectSelect:$('errorSubjectSelect'),
  errorSubjectTrigger: $('errorSubjectTrigger'),
  errorChapterInput: $('errorChapterInput'),
  errorTypeSelect:   $('errorTypeSelect'),
  errorTypeTrigger:  $('errorTypeTrigger'),
  errorTakeawayInput:$('errorTakeawayInput'),
  errorSubjectFilters: $('errorSubjectFilters'),
  errorTypeFilters:    $('errorTypeFilters'),

  // Global Search
  gsOverlay:           $('gsOverlay'),
  gsInput:             $('gsInput'),
  gsResults:           $('gsResults'),
  gsModeBadge:         $('gsModeBadge'),
  daysTillCard:        $('daysTillCard'),
  daysTillHeader:      $('daysTillHeader'),
  daysTillInputs:      $('daysTillInputs'),
  daysTillValue:       $('daysTillValue'),
  daysTillLabel:       $('daysTillLabel'),
  deadlineDate:        $('deadlineDate'),
  deadlineLabel:       $('deadlineLabel'),
  saveDeadlineBtn:     $('saveDeadlineBtn'),
  clearDeadlineBtn:    $('clearDeadlineBtn')
};

// --- DAYS TILL CARD --- //

function calculateDaysTill(deadline) {
  if (!deadline) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffTime = new Date(deadline).getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function renderDaysTill() {
  const data = Storage.read();
  const deadline = data.deadline || { date: null, label: 'Until deadline' };
  
  const daysLeft = calculateDaysTill(deadline.date);
  
  if (daysLeft !== null) {
    if (daysLeft > 0) {
      DOM.daysTillValue.textContent = `${daysLeft} days`;
    } else if (daysLeft === 0) {
      DOM.daysTillValue.textContent = `Today!`;
    } else {
      DOM.daysTillValue.textContent = `${Math.abs(daysLeft)} days ago`;
    }
  } else {
    DOM.daysTillValue.textContent = '--';
  }
  
  DOM.daysTillLabel.textContent = deadline.label || 'Until deadline';
}

DOM.daysTillCard.addEventListener('click', (e) => {
  if (e.target.closest('input, button')) return;
  DOM.daysTillHeader.style.display = 'none';
  DOM.daysTillInputs.style.display = 'flex';
  
  const data = Storage.read();
  DOM.deadlineDate.value = data.deadline?.date || '';
  DOM.deadlineLabel.value = data.deadline?.label || '';
});

// Close edit mode when clicking outside the card
document.addEventListener('click', (e) => {
  if (!DOM.daysTillCard.contains(e.target)) {
    DOM.daysTillHeader.style.display = 'flex';
    DOM.daysTillInputs.style.display = 'none';
  }
});

DOM.saveDeadlineBtn.addEventListener('click', () => {
  const date = DOM.deadlineDate.value;
  let label = DOM.deadlineLabel.value.trim() || 'Until deadline';
  
  if (!date) {
    showToast("Please select a date", 'error');
    return;
  }
  
  if (label.length > 20) {
    label = label.substring(0, 20);
    showToast("Label limited to 20 characters", 'neutral');
  }
  
  Storage.transaction(draft => {
    draft.deadline = { date, label };
  });
  
  DOM.daysTillHeader.style.display = 'flex';
  DOM.daysTillInputs.style.display = 'none';
  renderDaysTill();
});

DOM.clearDeadlineBtn.addEventListener('click', () => {
  Storage.transaction(draft => {
    draft.deadline = { date: null, label: 'Until deadline' };
  });

  DOM.deadlineDate.value = '';
  DOM.deadlineLabel.value = '';

  DOM.daysTillHeader.style.display = 'flex';
  DOM.daysTillInputs.style.display = 'none';

  renderDaysTill();
});

renderDaysTill();

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

  // Resize charts after their section becomes visible
  requestAnimationFrame(() => {
    try {
      if (name === 'tests') {
        if (chartInstances.testLineChart) chartInstances.testLineChart.resize();
      }
    } catch (e) { console.error("Chart resize error:", e); }
  });
}

DOM.navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchSection(item.dataset.section);
  });
});

if (DOM.globalSearchBtn) {
  DOM.globalSearchBtn.addEventListener('click', () => GlobalSearch.open());
}

// --- CALENDAR --- //
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function navigateCalendar(delta) {
  calMonth += delta;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  renderCalendar();
}

function renderCalendar() {
  DOM.calMonthYear.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  
  const fragment = document.createDocumentFragment();

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const tests = Storage.getTests();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(calYear, calMonth, d);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.style.cursor = 'pointer';
    
    if (isSameDay(dateObj, today)) cell.classList.add('today');

    const dayTests = tests.filter(t => dayKey(new Date(t.date)) === dayKey(dateObj));
    let examHtml = '';
    if (dayTests.length > 0) {
      const test = dayTests[0];
      examHtml = `
        <div class="exam-card" data-id="${test.id}">
          <span class="exam-name">${escapeHtml(test.name)}</span>
          <span class="exam-marks">${test.obtainedMarks}/${test.totalMarks}</span>
        </div>
      `;
    }

    cell.innerHTML = `
      <span class="cal-dow">${DAY_NAMES_SHORT[dateObj.getDay()]}</span>
      <span class="cal-date">${d}</span>
      ${examHtml}
    `;
    
    cell.addEventListener('click', () => {
      tfSelectedYear = calYear;
      tfSelectedMonth = calMonth;
      tfSelectedDay = d;
      switchSection('taskflow');
      tsSwitchTab('daily');
      tfSwitchDay();
    });

    const examCard = cell.querySelector('.exam-card');
    if (examCard) {
      examCard.addEventListener('click', (e) => {
        e.stopPropagation();
        switchSection('tests');
      });
    }

    fragment.appendChild(cell);
  }
  
  DOM.calendarGrid.innerHTML = '';
  DOM.calendarGrid.appendChild(fragment);
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

// Render markdown into the preview div
function renderNotesMarkdown() {
  const text = DOM.notesInput.value;
  if (typeof marked !== 'undefined') {
    try {
      DOM.notesPreview.innerHTML = marked.parse(text);
    } catch (err) {
      console.error("Notes markdown parsing failed:", err);
      DOM.notesPreview.textContent = text;
    }
  } else {
    DOM.notesPreview.textContent = text;
  }
}

let notesClearConfirm = false;
let notesClearTimer   = null;

function handleNotesClear() {
  if (!DOM.notesInput.value.trim()) {
    showToast('Notes are already empty', 'neutral');
    return;
  }

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
  renderNotesMarkdown();
  showToast('Notes cleared', 'success');
}

DOM.notesInput.value = Storage.getNotes();
DOM.notesSaveIndicator.textContent = 'All changes saved';
DOM.notesSaveIndicator.classList.remove('saving');
updateNotesCount();
renderNotesMarkdown();

DOM.notesInput.addEventListener('input', handleNotesChange);
DOM.notesClearBtn.addEventListener('click', handleNotesClear);

const notesWrapper = document.querySelector('.notes-wrapper');

DOM.notesInput.addEventListener('focus', () => {
  notesWrapper.classList.add('editing');
});

DOM.notesInput.addEventListener('blur', () => {
  notesWrapper.classList.remove('editing');
  renderNotesMarkdown();
});

// Clicking the markdown preview should focus the textarea
DOM.notesPreview.addEventListener('click', () => {
  notesWrapper.classList.add('editing');
  requestAnimationFrame(() => {
    DOM.notesInput.focus();
  });
});

DOM.notesInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = DOM.notesInput;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + 2;
  handleNotesChange();
});


// --- CHART.JS SETUP --- //
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#6b6b6b';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
  Chart.defaults.font.family = "'Space Grotesk', sans-serif";
}

// TEST DASHBOARD LOGIC
let errFilterSubject = 'all';
let errFilterType = 'all';
let editingTestId = null;

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
  const fragment = document.createDocumentFragment();

  if (tests.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style = 'grid-column: 1 / -1;text-align:center;padding:2rem 1rem;color:var(--muted);font-size:0.85rem';
    emptyMsg.textContent = 'No tests logged yet.';
    fragment.appendChild(emptyMsg);
  } else {
    [...tests].reverse().forEach(t => {
      const item = document.createElement('div');
      item.className = 'test-card'; 

      let actionsHtml = '';
      let contentHtml = '';

      if (editingTestId === t.id) {
        const dateVal = t.date ? t.date.split('T')[0] : '';
        contentHtml = `
          <div style="display:flex; flex-direction:column; gap:1rem;">
            <div class="form-group" style="margin-bottom:0; min-width:0;">
              <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Date Taken</label>
              <input type="date" class="form-input" id="testEditDate-${t.id}" value="${dateVal}">
            </div>
            <div class="form-group" style="margin-bottom:0; min-width:0;">
              <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Test Name</label>
              <input type="text" class="form-input" id="testEditName-${t.id}" value="${escapeAttr(t.name)}">
            </div>
            <div class="form-row" style="margin-bottom:0; display:flex; gap:1rem;">
              <div class="form-group" style="flex:1; margin-bottom:0; min-width:0;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Total Marks</label>
                <input type="number" class="form-input" id="testEditTotal-${t.id}" value="${t.totalMarks}">
              </div>
              <div class="form-group" style="flex:1; margin-bottom:0; min-width:0;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Obtained</label>
                <input type="number" class="form-input" id="testEditObtained-${t.id}" value="${t.obtainedMarks}">
              </div>
            </div>
            <div class="form-row" style="margin-bottom:0; display:flex; gap:1rem;">
              <div class="form-group" style="flex:1; margin-bottom:0; min-width:0;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Accuracy (%)</label>
                <input type="number" class="form-input" id="testEditAccuracy-${t.id}" step="0.1" value="${t.accuracy}">
              </div>
              <div class="form-group" style="flex:1; margin-bottom:0; min-width:0;">
                <label class="form-label" style="font-size: 0.85rem; margin-bottom: 0.3rem;">Rank (Opt)</label>
                <input type="number" class="form-input" id="testEditRank-${t.id}" value="${t.rank !== null && t.rank !== undefined ? t.rank : ''}" placeholder="e.g. 42" min="1">
              </div>
            </div>
            <div class="error-edit-actions" style="margin-top: 0.5rem;">
              <button class="error-save-btn test-save-btn" data-id="${t.id}"><i class="ph ph-check"></i> Save</button>
              <button class="error-cancel-btn test-cancel-btn" data-id="${t.id}"><i class="ph ph-x"></i> Cancel</button>
            </div>
          </div>
        `;
      } else {
        actionsHtml = `
          <div class="error-actions-top">
            <button class="error-action-btn error-edit-btn test-edit-btn" data-id="${t.id}" aria-label="Edit test">
              <i class="ph ph-pencil-simple"></i>
            </button>
            <button class="error-action-btn error-delete-btn test-delete-btn" data-id="${t.id}" aria-label="Delete test">
              <i class="ph ph-trash"></i>
            </button>
          </div>
        `;
        const rankTag = t.rank !== null && t.rank !== undefined ? `<span class="test-tag" style="background: rgba(139, 92, 246, 0.15);color: rgb(139, 92, 246)">Rank #${t.rank}</span>` : '';
        contentHtml = `
          <div class="test-content">
            <div class="test-tags">
                <span class="test-tag" style="background: rgba(92, 155, 212, 0.15);color: var(--info)">${t.obtainedMarks}/${t.totalMarks}</span>
                <span class="test-tag" style="background: rgba(212, 134, 76, 0.15);color: var(--accent)">${t.accuracy}% Acc</span>
                ${rankTag}
            </div>
            <div class="test-name">${escapeHtml(t.name)}</div>
            <div class="test-date">${new Date(t.date).toLocaleDateString()}</div>
          </div>
        `;
      }

      item.innerHTML = actionsHtml + contentHtml;
      fragment.appendChild(item);
    });
  }
  
  DOM.testHistoryList.innerHTML = '';
  DOM.testHistoryList.appendChild(fragment);

  if (editingTestId) {
    const nameInput = document.getElementById(`testEditName-${editingTestId}`);
    if (nameInput) {
      nameInput.focus();
      nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
    }
  }
}

function renderTestLineChart(tests) {
  try {
    destroyChart('testLineChart');

    if (typeof Chart === 'undefined') return;

    const ctx = DOM.testLineChart.getContext('2d');
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim() || '#d4864c';
    const infoColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--info').trim() || '#5c9bd4';

    if (tests.length === 0) {
      chartInstances.testLineChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ data: [] }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b6b' } },
            y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b6b' } }
          },
          plugins: { legend: { display: false } }
        },
        plugins: [{
          id: 'emptyMessage',
          afterDraw: (chart) => {
            const { ctx: c, width, height } = chart;
            c.save();
            c.font = '12px "Space Grotesk"';
            c.fillStyle = '#6b6b6b';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText('No test data to plot', width / 2, height / 2);
            c.restore();
          }
        }]
      });
      return;
    }

    const maxMarks = Math.max(...tests.map(t => t.totalMarks), 100);
    const labels = tests.map(t => new Date(t.date).toLocaleDateString());
    const dataMarks = tests.map(t => t.obtainedMarks);
    const dataRanks = tests.map(t => (t.rank !== null && t.rank !== undefined ? t.rank : null));

    chartInstances.testLineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Obtained Marks',
            data: dataMarks,
            yAxisID: 'y',
            borderColor: accentColor,
            backgroundColor: accentColor + '1a',
            fill: true,
            tension: 0.4,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBackgroundColor: accentColor,
            pointBorderColor: accentColor,
            hitRadius: 32,
            borderWidth: 4,
          },
          {
            label: 'Rank',
            data: dataRanks,
            yAxisID: 'y1',
            borderColor: infoColor,
            backgroundColor: infoColor + '1a',
            fill: false,
            tension: 0.4,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBackgroundColor: infoColor,
            pointBorderColor: infoColor,
            hitRadius: 32,
            borderWidth: 3,
            spanGaps: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: 3,
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b6b6b', font: { size: 10 } } },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            max: maxMarks,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#6b6b6b', font: { size: 10 } }
          },
          y1: {
            type: 'linear',
            display: tests.some(t => t.rank !== null && t.rank !== undefined),
            position: 'right',
            reverse: true, // Rank 1 at top, lower rank goes to bottom
            beginAtZero: false,
            min: 1,
            grid: { drawOnChartArea: false },
            ticks: { color: '#6b6b6b', font: { size: 10 } }
          }
        },
        plugins: {
          legend: { display: true, labels: { color: '#b0b0b0', font: { family: 'Space Grotesk' } } },
          tooltip: {
            callbacks: {
              title: (items) => tests[items[0].dataIndex].name,
              label: (ctx) => {
                const t = tests[ctx.dataIndex];
                if (ctx.dataset.label === 'Obtained Marks') {
                  return ` Score: ${ctx.raw} / ${t.totalMarks} (${t.accuracy}%)`;
                } else if (ctx.dataset.label === 'Rank') {
                  return t.rank !== null && t.rank !== undefined ? ` Rank: #${t.rank}` : null;
                }
                return '';
              }
            }
          }
        }
      }
    });
  } catch (e) {
    console.error("Test line chart render error:", e);
    showToast('Error rendering Test Line Chart', 'error');
  }
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

    const rankVal = DOM.testRankInput.value.trim();
    const rank = rankVal !== '' ? Math.max(1, parseInt(rankVal, 10) || 1) : null;
    const totalMarks = parseInt(DOM.testTotalInput.value, 10) || 300;
    const obtainedMarks = parseInt(DOM.testObtainedInput.value, 10) || 0;

    if (obtainedMarks > totalMarks) {
      showToast('Obtained marks cannot exceed total marks', 'error');
      return;
    }

    const test = {
      id: generateId(),
      date: testDate.toISOString(),
      name: DOM.testNameInput.value.trim() || 'Mock Test',
      totalMarks,
      obtainedMarks,
      accuracy: parseFloat(DOM.testAccuracyInput.value) || 0,
      rank
    };
    Storage.addTest(test);
    showToast('Test logged successfully', 'success');
    DOM.addTestForm.reset();
    DOM.testTotalInput.value = 300;
    DOM.testRankInput.value = '';
    
    // Reset the date picker to today after submission
    DOM.testDateInput.value = new Date().toISOString().split('T')[0];
    
    renderTestDashboard();
  });
}

if (DOM.testHistoryList) {
  DOM.testHistoryList.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.test-edit-btn');
    const cancelBtn = e.target.closest('.test-cancel-btn');
    const saveBtn = e.target.closest('.test-save-btn');
    const deleteBtn = e.target.closest('.test-delete-btn');

    if (editBtn) {
      editingTestId = editBtn.dataset.id;
      renderTestDashboard();
    } else if (cancelBtn) {
      editingTestId = null;
      renderTestDashboard();
    } else if (saveBtn) {
      const id = saveBtn.dataset.id;
      const dateInput = document.getElementById(`testEditDate-${id}`);
      const nameInput = document.getElementById(`testEditName-${id}`);
      const totalInput = document.getElementById(`testEditTotal-${id}`);
      const obtainedInput = document.getElementById(`testEditObtained-${id}`);
      const accuracyInput = document.getElementById(`testEditAccuracy-${id}`);
      const rankInput = document.getElementById(`testEditRank-${id}`);

      if (nameInput && totalInput && obtainedInput) {
        const dateStr = dateInput ? dateInput.value : '';
        let testDate = new Date();
        if (dateStr) {
          const parts = dateStr.split('-');
          testDate = new Date(parts[0], parts[1] - 1, parts[2]);
          testDate.setHours(new Date().getHours(), new Date().getMinutes());
        }

        const name = nameInput.value.trim() || 'Mock Test';
        const totalMarks = parseInt(totalInput.value, 10) || 300;
        const obtainedMarks = parseInt(obtainedInput.value, 10) || 0;
        const accuracy = accuracyInput ? (parseFloat(accuracyInput.value) || 0) : 0;
        const rankVal = rankInput ? rankInput.value.trim() : '';
        const rank = rankVal !== '' ? Math.max(1, parseInt(rankVal, 10) || 1) : null;

        Storage.updateTest(id, {
          name,
          date: testDate.toISOString(),
          totalMarks,
          obtainedMarks,
          accuracy,
          rank
        });

        editingTestId = null;
        renderTestDashboard();
        showToast('Test updated', 'success');
      }
    } else if (deleteBtn) {
      Storage.removeTest(deleteBtn.dataset.id);
      showToast('Test removed', 'neutral');
      renderTestDashboard();
    }
  });
}


// ERROR LOG LOGIC

function getErrorTypeColor(type) {
  switch (type) {
    case 'Conceptual Gap':   return 'rgb(244, 63, 94)';
    case 'Silly Mistake':    return 'rgb(59, 130, 246)';
    case 'Calculation Error':return 'rgb(139, 92, 246)';
    case 'Others':           return 'rgb(107, 107, 107)';
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

  // MISSING EVENT LISTENER: Enable adding errors to the log
  if (DOM.addErrorForm) {
    DOM.addErrorForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const subject = DOM.errorSubjectSelect.value;
      const chapter = DOM.errorChapterInput.value.trim();
      const errorType = DOM.errorTypeSelect.value;
      const takeaway = DOM.errorTakeawayInput.value.trim();
    
      if (!chapter) {
        showToast('Please enter a chapter or topic', 'error');
        return;
      }
    
      Storage.addError({
        id: generateId(),
        date: new Date().toISOString(),
        subject,
        chapter,
        errorType,
        takeaway
      });
    
      showToast('Error logged successfully', 'success');
      DOM.addErrorForm.reset();
      if (DOM.errorSubjectSelect) DOM.errorSubjectSelect.value = 'physics';
      renderErrorLog();
    });
  }

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

function createErrorCard(e) {
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
        parsedTakeaway = marked.parse(e.takeaway || "");
      } catch (err) {
        console.error("Markdown parsing failed:", err);
        showToast('Markdown Parsing Failed!', 'error')
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
  return card;
}

function renderErrorLog() {
  if (!DOM.errorLogList) return;
  
  let errors = Storage.getErrors();
  if (errFilterSubject !== 'all') errors = errors.filter(e => e.subject === errFilterSubject);
  if (errFilterType !== 'all') errors = errors.filter(e => e.errorType === errFilterType);

  DOM.errorLogList.innerHTML = '';
  
  if (errors.length === 0) {
    DOM.errorLogList.innerHTML = '<div class="error-empty-state">No errors match your filters.</div>';
    return;
  }

  // 1. Group by Subject
  const subjectOrder = ['physics', 'chem', 'maths'];
  const groupedBySubject = {};
  SUBJECTS.forEach(s => groupedBySubject[s.key] = []);
  
  errors.forEach(e => {
    if (!groupedBySubject[e.subject]) groupedBySubject[e.subject] = [];
    groupedBySubject[e.subject].push(e);
  });

  // Render
  const subjectKeys = [...subjectOrder, ...Object.keys(groupedBySubject).filter(k => !subjectOrder.includes(k))];
  
  subjectKeys.forEach(sKey => {
    const sGroup = groupedBySubject[sKey];
    if (!sGroup || sGroup.length === 0) return;

    // Render Subject Header
    const subj = subjectByKey(sKey);
    const subjHeader = document.createElement('h2');
    subjHeader.className = 'error-subject-header';
    subjHeader.textContent = subj.name;
    DOM.errorLogList.appendChild(subjHeader);

    // 2. Cluster by Chapter Similarity
    const clusters = [];
    sGroup.forEach(err => {
      let found = false;
      for (const cluster of clusters) {
        if (getLevenshteinDistance(err.chapter, cluster.representative) <= 3) {
          cluster.errors.push(err);
          found = true;
          break;
        }
      }
      if (!found) {
        clusters.push({ representative: err.chapter, errors: [err] });
      }
    });

    // Sort clusters by latest date of oldest member (Newest first)
    clusters.sort((a, b) => {
      const minA = Math.min(...a.errors.map(e => new Date(e.date).getTime()));
      const minB = Math.min(...b.errors.map(e => new Date(e.date).getTime()));
      return minB - minA;
    });

    // Render clusters
    clusters.forEach(cluster => {
      const clusterEl = document.createElement('div');
      clusterEl.className = 'error-chapter-subgroup';
      
      const clusterHeader = document.createElement('h3');
      clusterHeader.className = 'error-chapter-header';
      clusterHeader.textContent = cluster.representative;
      clusterEl.appendChild(clusterHeader);
      
      const gridEl = document.createElement('div');
      gridEl.className = 'error-chapter-grid';
      clusterEl.appendChild(gridEl);
      
      // Sort errors in subgroup (Earliest first)
      cluster.errors.sort((a, b) => new Date(a.date) - new Date(b.date));

      cluster.errors.forEach(e => {
        gridEl.appendChild(createErrorCard(e));
      });
      DOM.errorLogList.appendChild(clusterEl);
    });
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
  const filename = getBackupFilename();
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Backup exported to ${filename}`, 'success');
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
  return String(str || '')
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

function initCustomDropdowns() {
    // 1. Accessibility for existing popovers
    document.querySelectorAll('[popovertarget]').forEach(trigger => {
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        
        trigger.addEventListener('toggle', (e) => {
            trigger.setAttribute('aria-expanded', e.newState === 'open');
        });
    });

    // 2. Selection Logic
    document.querySelectorAll('.select-menu').forEach(menu => {
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            
            const trigger = document.querySelector(`[popovertarget="${menu.id}"]`);
            const input = document.getElementById(trigger.getAttribute('data-input-id'));
            
            if (input) {
                input.value = btn.dataset.value;
                trigger.textContent = btn.textContent;
                menu.hidePopover();
            }
        });
    });
}

// Ensure this is called properly
initCustomDropdowns();

// --- INITIALIZATION --- //
function initTaskflow() {
  initCustomDropdowns();
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

let clockInterval = setInterval(tsUpdateClock, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(clockInterval);
  } else {
    clearInterval(clockInterval); // Clear any existing interval just to be safe.
    tsUpdateClock();
    clockInterval = setInterval(tsUpdateClock, 1000);
  }
});

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

// --- Global Todo / Kanban Logic ---
function tsLoadTodos() { tsTodos = Storage.getGlobalTodos(); }
function tsSaveTodos() { Storage.setGlobalTodos(tsTodos); }

function tsRender() {
  const todoItems = tsTodos.filter(t => t.status === 'todo');
  const doingItems = tsTodos.filter(t => t.status === 'doing');
  const doneItems = tsTodos.filter(t => t.status === 'done');
  const total = tsTodos.length;
  const doneCount = doneItems.length;

  if (total > 0) {
    DOM.globalStatsBar.style.display = 'flex';
    DOM.globalProgressSection.style.display = 'block';
    DOM.globalActiveCount.textContent = (todoItems.length + doingItems.length);
    const pct = Math.round((doneCount / total) * 100);
    DOM.globalProgressFill.style.width = pct + '%';
    DOM.globalProgressPct.textContent = pct + '%';
  } else {
    DOM.globalStatsBar.style.display = 'none';
    DOM.globalProgressSection.style.display = 'none';
  }

  DOM.globalClearCompletedBtn.style.display = doneCount > 0 ? 'inline-flex' : 'none';

  DOM.kanbanTodoCount.textContent = todoItems.length;
  DOM.kanbanDoingCount.textContent = doingItems.length;
  DOM.kanbanDoneCount.textContent = doneItems.length;

  const renderList = (listEl, items, status) => {
    listEl.innerHTML = '';
    if (items.length === 0) {
      let emptyMsg, emptyTitle, emptyIcon;
      if (status === 'todo') {
        emptyTitle = 'No todo tasks'; emptyMsg = 'Add tasks to get started.'; emptyIcon = 'ph ph-clipboard-text';
      } else if (status === 'doing') {
        emptyTitle = 'Nothing in progress'; emptyMsg = 'Drag tasks here when working on them.'; emptyIcon = 'ph ph-spinner';
      } else {
        emptyTitle = 'Nothing completed'; emptyMsg = 'Drag tasks here when done.'; emptyIcon = 'ph ph-check-circle';
      }
      listEl.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem;"><div class="empty-icon" style="font-size:1.5rem"><i class="${emptyIcon}"></i></div><p class="empty-title" style="font-size:0.9rem">${escapeHtml(emptyTitle)}</p><p class="empty-desc" style="font-size:0.8rem">${escapeHtml(emptyMsg)}</p></div>`;
      return;
    }

    items.forEach((todo, index) => {
      const item = document.createElement('div');
      item.className = 'todo-item kanban-item' + (status === 'done' ? ' completed' : '');
      item.dataset.id = todo.id;
      item.draggable = true;

      if (tsEditingId === todo.id) {
        item.innerHTML = `
          <input type="text" class="edit-input" value="${escapeAttr(todo.text)}" maxlength="200" aria-label="Edit global task">
          <div class="todo-actions" style="opacity:1">
            <button class="action-btn save-btn" aria-label="Save edit" title="Save"><i class="ph ph-check"></i></button>
            <button class="action-btn cancel-btn" aria-label="Cancel edit" title="Cancel"><i class="ph ph-x"></i></button>
          </div>`;
      } else {
        item.innerHTML = `
          <div class="drag-handle" title="Drag to move"><i class="ph ph-dots-six-vertical"></i></div>
          <span class="todo-text">${escapeHtml(todo.text)}</span>
          <div class="todo-actions">
            <button class="action-btn edit-btn" aria-label="Edit task" title="Edit"><i class="ph ph-pencil-simple"></i></button>
            <button class="action-btn delete" aria-label="Delete task" title="Delete"><i class="ph ph-trash"></i></button>
          </div>`;
      }

      listEl.appendChild(item);

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', todo.id);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
      });

      // Touch Drag and Drop Support
      let touchGhost = null;
      let startX = 0, startY = 0;

      item.addEventListener('touchstart', (e) => {
        if (e.target.closest('.todo-actions') || e.target.closest('input')) return;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        if (!touchGhost && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          item.classList.add('dragging');
          touchGhost = item.cloneNode(true);
          touchGhost.style.position = 'fixed';
          touchGhost.style.zIndex = '9999';
          touchGhost.style.pointerEvents = 'none';
          touchGhost.style.opacity = '0.85';
          touchGhost.style.width = item.offsetWidth + 'px';
          document.body.appendChild(touchGhost);
        }

        if (touchGhost) {
          e.preventDefault();
          touchGhost.style.left = (touch.clientX - touchGhost.offsetWidth / 2) + 'px';
          touchGhost.style.top = (touch.clientY - 30) + 'px';

          document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
          const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
          const colBelow = elemBelow ? elemBelow.closest('.kanban-column') : null;
          if (colBelow) {
            colBelow.classList.add('drag-over');
          }
        }
      }, { passive: false });

      item.addEventListener('touchend', (e) => {
        item.classList.remove('dragging');
        document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));

        if (touchGhost) {
          const touch = e.changedTouches[0];
          const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
          const colBelow = elemBelow ? elemBelow.closest('.kanban-column') : null;

          if (colBelow) {
            const dropzone = colBelow.querySelector('.kanban-dropzone');
            const newStatus = dropzone ? dropzone.dataset.status : null;
            if (newStatus) {
              const draggedIndex = tsTodos.findIndex(t => t.id === todo.id);
              if (draggedIndex !== -1) {
                const [draggedTodo] = tsTodos.splice(draggedIndex, 1);
                const oldStatus = draggedTodo.status;
                draggedTodo.status = newStatus;

                const targetItemEl = elemBelow ? elemBelow.closest('.todo-item') : null;
                if (targetItemEl && targetItemEl.dataset.id !== todo.id) {
                  const targetId = targetItemEl.dataset.id;
                  const targetIndex = tsTodos.findIndex(t => t.id === targetId);
                  if (targetIndex !== -1) {
                    tsTodos.splice(targetIndex, 0, draggedTodo);
                  } else {
                    tsTodos.push(draggedTodo);
                  }
                } else {
                  tsTodos.push(draggedTodo);
                }

                if (newStatus === 'done' && oldStatus !== 'done') {
                  playCompletionSfx();
                  showToast('Task completed & reordered', 'success');
                } else {
                  showToast('Task reordered', 'success');
                }

                tsSaveTodos();
                tsRender();
              }
            }
          }

          touchGhost.remove();
          touchGhost = null;
        }
      });

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
  };

  renderList(DOM.kanbanTodoList, todoItems, 'todo');
  renderList(DOM.kanbanDoingList, doingItems, 'doing');
  renderList(DOM.kanbanDoneList, doneItems, 'done');
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
    status: 'todo',
    createdAt: Date.now()
  };

  tsTodos.unshift(todo);
  tsSaveTodos();
  DOM.globalTodoInput.value = '';
  DOM.globalTodoInput.focus();
  tsRender();
  showToast('Global task added', 'success');
}

function tsUpdateTodoStatus(id, newStatus) {
  const todo = tsTodos.find(t => t.id === id);
  if (todo && todo.status !== newStatus) {
    const oldStatus = todo.status;
    todo.status = newStatus;
    if (newStatus === 'done' && oldStatus !== 'done') {
      playCompletionSfx();
      showToast('Task completed', 'success');
    } else {
      showToast(`Moved to ${newStatus}`, 'neutral');
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

function tsClearDone() {
  const count = tsTodos.filter(t => t.status === 'done').length;
  tsTodos = tsTodos.filter(t => t.status !== 'done');
  tsSaveTodos();
  tsRender();
  showToast(`${count} completed task${count !== 1 ? 's' : ''} cleared`, 'neutral');
}

// --- Initialization ---
function initTaskset() {
  tsLoadTodos();
  
  if (DOM.globalAddBtn) DOM.globalAddBtn.addEventListener('click', tsAddTodo);
  if (DOM.globalTodoInput) DOM.globalTodoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tsAddTodo(); });
  if (DOM.globalClearCompletedBtn) DOM.globalClearCompletedBtn.addEventListener('click', tsClearDone);

  const kanbanBoard = document.getElementById('kanbanBoard');
  const prevBtn = document.querySelector('.kanban-prev-btn');
  const nextBtn = document.querySelector('.kanban-next-btn');

  if (kanbanBoard && prevBtn && nextBtn) {
    prevBtn.addEventListener('click', () => {
      const colWidth = kanbanBoard.querySelector('.kanban-column')?.offsetWidth || 320;
      kanbanBoard.scrollBy({ left: -(colWidth + 24), behavior: 'smooth' });
    });
    nextBtn.addEventListener('click', () => {
      const colWidth = kanbanBoard.querySelector('.kanban-column')?.offsetWidth || 320;
      kanbanBoard.scrollBy({ left: colWidth + 24, behavior: 'smooth' });
    });

    kanbanBoard.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = kanbanBoard.getBoundingClientRect();
      const threshold = 60;
      const speed = 10;
      if (e.clientX - rect.left < threshold) {
        kanbanBoard.scrollLeft -= speed;
      } else if (rect.right - e.clientX < threshold) {
        kanbanBoard.scrollLeft += speed;
      }
    });
  }

  const dropzones = [DOM.kanbanTodoList, DOM.kanbanDoingList, DOM.kanbanDoneList];
  dropzones.forEach(zone => {
    const column = zone.closest('.kanban-column');
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (column) column.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        if (column) column.classList.remove('drag-over');
      }
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (column) column.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = zone.dataset.status;
      if (!id || !newStatus) return;

      const draggedIndex = tsTodos.findIndex(t => t.id === id);
      if (draggedIndex === -1) return;

      const [draggedTodo] = tsTodos.splice(draggedIndex, 1);
      const oldStatus = draggedTodo.status;
      draggedTodo.status = newStatus;

      const targetItemEl = e.target.closest('.todo-item');
      if (targetItemEl && targetItemEl.dataset.id !== id) {
        const targetId = targetItemEl.dataset.id;
        const targetIndex = tsTodos.findIndex(t => t.id === targetId);
        if (targetIndex !== -1) {
          tsTodos.splice(targetIndex, 0, draggedTodo);
        } else {
          tsTodos.push(draggedTodo);
        }
      } else {
        tsTodos.push(draggedTodo);
      }

      if (newStatus === 'done' && oldStatus !== 'done') {
        playCompletionSfx();
        showToast('Task completed & reordered', 'success');
      } else {
        showToast('Task reordered', 'success');
      }

      tsSaveTodos();
      tsRender();
    });
  });
}

initTaskset();



// GLOBAL SEARCH (inspired by fuzzel!)


const GlobalSearch = {
  overlay: null,
  input: null,
  results: null,
  modeBadge: null,
  isOpen: false,
  selectedIndex: 0,
  currentResults: [],

  init() {
    // Bind events to the elements from the central DOM object
    DOM.gsInput.addEventListener('input', () => this.handleInput());
    DOM.gsInput.addEventListener('keydown', (e) => this.handleKeydown(e));
    DOM.gsOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.gsOverlay) this.close();
    });
  },

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    DOM.gsOverlay.classList.add('active');
    DOM.gsInput.value = '';
    this.selectedIndex = 0;
    this.currentResults = [];
    this.renderResults();
    
    requestAnimationFrame(() => {
      setTimeout(() => {
        DOM.gsInput.focus({ preventScroll: true });
      }, 20);
    });
  },

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    DOM.gsOverlay.classList.remove('active');
    DOM.gsInput.blur();
  },

  toggle() {
    this.isOpen ? this.close() : this.open();
  },

  // --- Fuzzy match: substring or subsequence ---
  fuzzyMatch(haystack, needle) {
    if (!needle) return true;
    if (haystack.includes(needle)) return true;
    let ni = 0;
    for (let i = 0; i < haystack.length && ni < needle.length; i++) {
      if (haystack[i] === needle[ni]) ni++;
    }
    return ni === needle.length;
  },

  // --- Highlight the matched portion of text ---
  highlight(text, query) {
    if (!query) return escapeHtml(text);
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.substring(0, idx)) +
      '<mark style="background:rgba(139,92,246,.3);color:inherit;border-radius:2px;padding:0 1px">' +
      escapeHtml(text.substring(idx, idx + query.length)) +
      '</mark>' +
      escapeHtml(text.substring(idx + query.length));
  },

  handleInput() {
    const raw = DOM.gsInput.value.trim();
    const query = raw.toLowerCase();

    // Parse bangs: !t --> tasks only, !e --> errors only
    let mode = 'all';
    let searchText = query;

    const bangMatch = query.match(/^!(t|e)\s*(.*)/);
    if (bangMatch) {
      mode = bangMatch[1] === 't' ? 'tasks' : 'errors';
      searchText = bangMatch[2];
    }

    // Update mode badge
    DOM.gsModeBadge.classList.remove('active');
    if (mode === 'tasks') {
      DOM.gsModeBadge.textContent = 'Tasks';
      DOM.gsModeBadge.style.background = 'rgba(139,92,246,.15)';
      DOM.gsModeBadge.style.color = 'rgb(139,92,246)';
      DOM.gsModeBadge.classList.add('active');
    } else if (mode === 'errors') {
      DOM.gsModeBadge.textContent = 'Errors';
      DOM.gsModeBadge.style.background = 'rgba(244,63,94,.15)';
      DOM.gsModeBadge.style.color = 'rgb(244,63,94)';
      DOM.gsModeBadge.classList.add('active');
    }

    const needle = searchText.toLowerCase();
    const results = [];

    // -- Search Tasks (daily + global) --
    if (mode === 'all' || mode === 'tasks') {
      // Global todos
      const globalTodos = Storage.getGlobalTodos();
      for (const todo of globalTodos) {
        if (this.fuzzyMatch(todo.text.toLowerCase(), needle)) {
          const statusLabel = todo.status === 'done' ? ' · ✓ Done' : todo.status === 'doing' ? ' · In Progress' : ' · Todo';
          results.push({
            type: 'task',
            title: todo.text,
            subtitle: 'Global Task' + statusLabel,
            icon: todo.status === 'done' ? 'ph-fill ph-check-circle' : todo.status === 'doing' ? 'ph ph-spinner' : 'ph ph-list-checks',
            color: 'rgb(139,92,246)',
            searchText,
            action: () => {
              switchSection('taskflow');
              tsSwitchTab('taskset');
            }
          });
        }
      }

      // Daily todos across ALL days
      const days = Storage.read().tracker.days;
      for (const [dKey, day] of Object.entries(days)) {
        if (!Array.isArray(day.todos)) continue;
        const parts = dKey.split('-').map(Number);
        const y = parts[0], m = parts[1] - 1, d = parts[2];
        const dateObj = new Date(y, m, d);
        const dateLabel = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const isToday = dayKey(new Date()) === dKey;

        for (const todo of day.todos) {
          if (this.fuzzyMatch(todo.text.toLowerCase(), needle)) {
            results.push({
              type: 'task',
              title: todo.text,
              subtitle: (isToday ? 'Today · ' : dateLabel + ' · ') + 'Daily Task' +
                        (todo.completed ? ' · ✓ Completed' : ''),
              icon: todo.completed ? 'ph-fill ph-check-circle' : 'ph ph-clipboard-text',
              color: 'rgb(59,130,246)',
              searchText,
              action: () => {
                tfSelectedYear = y;
                tfSelectedMonth = m;
                tfSelectedDay = d;
                switchSection('taskflow');
                tsSwitchTab('daily');
                tfSwitchDay();
              }
            });
          }
        }
      }
    }

    // -- Search Chapters --
    if (mode === 'all' || mode === 'errors') {
      const errors = Storage.getErrors();
      const uniqueChapters = [...new Set(errors.map(e => e.chapter))];
      
      for (const chapter of uniqueChapters) {
        if (!needle || getLevenshteinDistance(chapter, needle) <= 3) {
          const chapterErrors = errors
            .filter(e => e.chapter === chapter)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
          const latestError = chapterErrors[0];
          
          results.push({
            type: 'chapter',
            title: chapter,
            subtitle: `${chapterErrors.length} error${chapterErrors.length !== 1 ? 's' : ''}`,
            icon: 'ph-book-bookmark',
            color: 'rgb(107, 107, 107)',
            searchText,
            action: () => {
              switchSection('errors');
              errFilterSubject = 'all';
              errFilterType = 'all';
              renderErrorLog();
              
              setTimeout(() => {
                const card = document.querySelector('[data-error-id="' + latestError.id + '"]');
                if (card) {
                  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  card.style.transition = 'box-shadow .3s ease';
                  card.style.boxShadow = '0 0 0 2px rgb(107, 107, 107)';
                  setTimeout(() => { card.style.boxShadow = ''; }, 2000);
                }
              }, 350);
            }
          });
        }
      }
    }

    // -- Search Errors --
    if (mode === 'all' || mode === 'errors') {
      const errors = Storage.getErrors().sort((a, b) => new Date(b.date) - new Date(a.date));
      for (const err of errors) {
        const haystack = (err.chapter + ' ' + err.errorType + ' ' + err.takeaway).toLowerCase();
        if (this.fuzzyMatch(haystack, needle)) {
          const subj = subjectByKey(err.subject);
          const dateObj = new Date(err.date);
          const dateLabel = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          results.push({
            type: 'error',
            title: err.chapter,
            subtitle: subj.name + ' · ' + err.errorType + ' · ' + dateLabel,
            icon: subj.icon,
            color: subj.color,
            searchText,
            action: () => {
              switchSection('errors');
              errFilterSubject = 'all';
              errFilterType = 'all';
              renderErrorLog();
              
              setTimeout(() => {
                const card = document.querySelector('[data-error-id="' + err.id + '"]');
                if (card) {
                  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  card.style.transition = 'box-shadow .3s ease';
                  card.style.boxShadow = '0 0 0 2px ' + subj.color;
                  setTimeout(() => { card.style.boxShadow = ''; }, 2000);
                }
              }, 350);
            }
          });
        }
      }
    }

    this.currentResults = results.slice(0, 50);
    this.selectedIndex = 0;
    this.renderResults();
  },

  renderResults() {
    DOM.gsResults.innerHTML = '';

    if (this.currentResults.length === 0) {
      const query = DOM.gsInput.value.trim();
      if (!query) {
        DOM.gsResults.innerHTML = `
          <div class="gs-empty">
            <i class="ph ph-magnifying-glass"></i>
            <p>Search across all your tasks and error logs</p>
            <div class="gs-empty-hints">
              <span class="gs-hint">!t tasks only</span>
              <span class="gs-hint">!e errors only</span>
            </div>
          </div>`;
      } else {
        DOM.gsResults.innerHTML = `
          <div class="gs-empty">
            <i class="ph ph-binocular"></i>
            <p>No results for "${escapeHtml(query)}"</p>
          </div>`;
      }
      return;
    }

    // Group results by type when in "all" mode
    const tasks = this.currentResults.filter(r => r.type === 'task');
    const errors = this.currentResults.filter(r => r.type === 'error');
    const chapters = this.currentResults.filter(r => r.type === 'chapter');
    const showHeaders = (tasks.length > 0 && errors.length > 0) || (tasks.length > 0 && chapters.length > 0) || (errors.length > 0 && chapters.length > 0);

    let globalIndex = 0;

    const renderItem = (result) => {
      const item = document.createElement('div');
      item.className = 'gs-item' + (globalIndex === this.selectedIndex ? ' selected' : '');
      item.dataset.index = globalIndex;
      item.innerHTML = `
        <div class="gs-item-icon" style="background:${result.color}22;color:${result.color}">
          <i class="ph-fill ${result.icon}"></i>
        </div>
        <div class="gs-item-info">
          <div class="gs-item-title">${this.highlight(result.title, result.searchText)}</div>
          <div class="gs-item-subtitle">${escapeHtml(result.subtitle)}</div>
        </div>
        <div class="gs-item-badge">${result.type === 'task' ? 'Task' : result.type === 'chapter' ? 'Chapter' : 'Error'}</div>
      `;
      item.addEventListener('click', () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.selectResult();
      });
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.updateSelectionVisual();
      });
      DOM.gsResults.appendChild(item);
      globalIndex++;
    };

    if (showHeaders && tasks.length > 0) {
      const hdr = document.createElement('div');
      hdr.className = 'gs-section-header';
      hdr.textContent = 'Tasks · ' + tasks.length;
      DOM.gsResults.appendChild(hdr);
    }
    tasks.forEach(renderItem);

    if (showHeaders && chapters.length > 0) {
      const hdr = document.createElement('div');
      hdr.className = 'gs-section-header';
      hdr.textContent = 'Chapters · ' + chapters.length;
      DOM.gsResults.appendChild(hdr);
    }
    chapters.forEach(renderItem);

    if (showHeaders && errors.length > 0) {
      const hdr = document.createElement('div');
      hdr.className = 'gs-section-header';
      hdr.textContent = 'Errors · ' + errors.length;
      DOM.gsResults.appendChild(hdr);
    }
    errors.forEach(renderItem);

    this.updateSelectionVisual();
  },

  updateSelectionVisual() {
    const items = DOM.gsResults.querySelectorAll('.gs-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  },

  handleKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.currentResults.length === 0) return;
      this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
      this.updateSelectionVisual();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.currentResults.length === 0) return;
      this.selectedIndex = (this.selectedIndex - 1 + this.currentResults.length) % this.currentResults.length;
      this.updateSelectionVisual();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.selectResult();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  },

  selectResult() {
    const result = this.currentResults[this.selectedIndex];
    if (!result) return;
    this.close();
    if (typeof result.action === 'function') {
      result.action();
    }
  }
};

// Initialize
GlobalSearch.init();

// Ctrl+K / Cmd+K shortcut
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    e.stopPropagation(); // Prevents browser from stealing focus after executing
    GlobalSearch.toggle();
  }
});

window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;

  if (GlobalSearch.isOpen) {
    GlobalSearch.handleInput();
  }

  // Invalidate the cache to force a fresh read from localStorage
  Storage._cache = null;

  Storage.read();

  // Update notes from other tab only if the user is not actively editing
  if (!saveNotesDebounced.isPending()) {
    DOM.notesInput.value = Storage.getNotes();
    DOM.notesSaveIndicator.textContent = 'All changes saved';
    DOM.notesSaveIndicator.classList.remove('saving');
    updateNotesCount();
    renderNotesMarkdown();
  }

  // Reload todos for both task lists so they reflect cross-tab changes
  tfLoadTodos();
  tsLoadTodos();

  // Re-render everything
  renderAll();
  tfRender();
  tsRender();
});


// SAVE BEFORE CLOSING
function flushBeforeClose() {
  // Flush any pending debounced note save immediately
  if (typeof saveNotesDebounced.flush === 'function') {
    saveNotesDebounced.flush();
  }

  if (DOM.notesInput && DOM.notesInput.value !== Storage.getNotes()) {
    Storage.setNotes(DOM.notesInput.value);
  }
}

window.addEventListener('beforeunload', flushBeforeClose);
window.addEventListener('pagehide', flushBeforeClose);
