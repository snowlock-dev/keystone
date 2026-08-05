console.log("Keystone initialized!");

// State object to hold app data
const state = {
  activeSection: 'home',
  todos: [],
  trackerSessions: []
};

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const sectionViews = document.querySelectorAll('.section-view');

// Core Routing Function
function switchSection(sectionName) {
  state.activeSection = sectionName;

  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionName);
  });

  sectionViews.forEach(view => {
    view.classList.toggle('active', view.dataset.section === sectionName);
  });
}

// Event Listeners for Sidebar
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent default anchor link behavior
    const section = item.dataset.section;
    switchSection(section);
  });
});

// === Calendar Logic ===
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let calYear = 0, calMonth = 0;

const calendarGrid = document.getElementById('calendarGrid');
const calMonthYear = document.getElementById('calMonthYear');
const calPrev = document.getElementById('calPrev');
const calNext = document.getElementById('calNext');

function isToday(dateObj) {
  const now = new Date();
  return dateObj.getFullYear() === now.getFullYear() && 
          dateObj.getMonth() === now.getMonth() && 
          dateObj.getDate() === now.getDate();
}

function navigateCalendar(delta) {
  calendarGrid.classList.add('fade-out');

  setTimeout(() => {
    calMonth += delta;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }

    renderCalendar();
    calendarGrid.classList.remove('fade-out');
  }, 200); 
}

function renderCalendar() {
  calMonthYear.textContent = MONTH_NAMES[calMonth] + ' ' + calYear;
  calendarGrid.innerHTML = ''; 

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    const dateObj = new Date(calYear, calMonth, d);
    const dayNameShort = DAY_NAMES_SHORT[dateObj.getDay()];
    
    dayCell.innerHTML = `
      <span class="cal-dow">${dayNameShort}</span>
      <span class="cal-date">${d}</span>
    `;
    
    if (isToday(dateObj)) dayCell.classList.add('today');

    calendarGrid.appendChild(dayCell);
  }
}

const currentNow = new Date();
calYear = currentNow.getFullYear(); calMonth = currentNow.getMonth();
renderCalendar();

// Hook up navigation arrows
calPrev.addEventListener('click', () => navigateCalendar(-1));
calNext.addEventListener('click', () => navigateCalendar(1));

// this is more modular, because I plan to add a few more shortcuts later
window.addEventListener('keydown', (event) => {
  const isModifierPressed = event.ctrlKey || event.metaKey;

  if (isModifierPressed) {
    const shortcuts = {
      '1': 'home',
      '2': 'tasks',
      '3': 'tracker',
      '4': 'notes'
    };

    if (shortcuts[event.key]) {
      event.preventDefault();
      switchSection(shortcuts[event.key]);
    }
  }

  if (event.key === 'ArrowLeft') {
    navigateCalendar(-1);
  } else if (event.key === 'ArrowRight') {
    navigateCalendar(1);
  }
});


const STORAGE_PREFIX = 'keystone';
const toastContainer = document.getElementById('toastContainer');

function showToast(message, state = 'neutral') {
  const toast = document.createElement('div');
  toast.className = 'toast ' + state;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// === Backup & Restore Pipeline ===
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');

function exportData() {
  const data = { app: "Keystone", version: "0.1", localStorage: {} };
  
  // Grab only keystone_ items
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      data.localStorage[key] = localStorage.getItem(key);
    }
  }
  
  // Download as keystone.json
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url; 
  a.download = "keystone.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast("Backup exported to keystone.json!", "success");
}

function handleFile(file) {
  if (!file || !file.name.endsWith('.json')) {
    showToast("Please select a keystone.json file", "error");
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.localStorage) {
        // Inject into localStorage
        Object.keys(parsed.localStorage).forEach(function(key) {
          if (key.startsWith(STORAGE_PREFIX)) {
            localStorage.setItem(key, parsed.localStorage[key]);
          }
        });
        showToast("keystone.json loaded! Reloading app...", "success");
        setTimeout(() => location.reload(), 1000); // this is iffy
      } else {
        showToast("Invalid backup format", "error");
      }
    } catch (err) {
      showToast("Error reading JSON file", "error");
    }
  };
  reader.readAsText(file);
}

// Wire up the buttons
exportBtn.addEventListener('click', exportData);
importBtn.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFile(e.target.files[0]);
    e.target.value = ''; // Reset input
  }
});


// === Notes Logic ===
const notesInput = document.getElementById('notesInput');
const notesSaveIndicator = document.getElementById('notesSaveIndicator');
const notesCount = document.getElementById('notesCount');
const notesClearBtn = document.getElementById('notesClearBtn');

let notesSaveTimeout = 2;

function loadNotes() {
  notesInput.value = localStorage.getItem(STORAGE_PREFIX + 'notes') || '';
  updateNotesCount();
}

function saveNotes() {
  try {
    localStorage.setItem(STORAGE_PREFIX + 'notes', notesInput.value);
    notesSaveIndicator.textContent = 'All changes saved';
    notesSaveIndicator.classList.remove('saving');
  } catch (e) {
    notesSaveIndicator.textContent = 'Save failed';
    notesSaveIndicator.classList.add('saving');
  }
}

function handleNotesChange() {
  // Show saving indicator immediately
  notesSaveIndicator.textContent = 'Saving...';
  notesSaveIndicator.classList.add('saving');
  
  // Debounce the actual save by 500ms
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(saveNotes, 500);
  
  updateNotesCount();
}

function updateNotesCount() {
  const text = notesInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  notesCount.textContent = words + ' word' + (words !== 1 ? 's' : '') + ' · ' + chars + ' char' + (chars !== 1 ? 's' : '');
}

// 2-click confirmation to clear
let notesClearConfirm = false;
let notesClearTimeout = null;

function handleNotesClear() {
  if (!notesInput.value.trim()) return;
  
  if (!notesClearConfirm) {
    // FIRST CLICK: Turn into checkmark, wait for second click
    notesClearConfirm = true;
    notesClearBtn.classList.add('confirm');
    showToast('Are you sure? (Click Again to Confirm', 'neutral');
    notesClearBtn.innerHTML = '<i class="ph-fill ph-check-fat"></i>';
    clearTimeout(notesClearTimeout);
    notesClearTimeout = setTimeout(() => {
      // If they wait too long, turn back into a trashcan
      notesClearConfirm = false;
      notesClearBtn.classList.remove('confirm');
      notesClearBtn.innerHTML = '<i class="ph ph-trash"></i>';
    }, 3000);
    return;
  }
  
  // SECOND CLICK: Actually delete
  clearTimeout(notesClearTimeout);
  notesClearConfirm = false;
  notesClearBtn.classList.remove('confirm');
  notesClearBtn.innerHTML = '<i class="ph ph-trash"></i>';
  notesInput.value = '';
  localStorage.removeItem(STORAGE_PREFIX + 'notes');
  
  // Update UI
  notesSaveIndicator.textContent = 'All changes saved';
  notesSaveIndicator.classList.remove('saving');
  updateNotesCount();
  showToast('Notes cleared', 'success');
}

// Event Listeners
notesInput.addEventListener('input', handleNotesChange);
notesClearBtn.addEventListener('click', handleNotesClear);

// Tab key indent inside textarea
notesInput.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    var start = this.selectionStart, end = this.selectionEnd;
    this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
    this.selectionStart = this.selectionEnd = start + 2;
    handleNotesChange();
  }
});

// Initialize Notes on load
loadNotes();

// === Tracker State ===
const SUBJECTS = [
  { key: 'physics', name: 'Physics', icon: 'ph-magnet', color: 'rgb(244, 63, 94)' },
  { key: 'chem', name: 'Chemistry', icon: 'ph-atom', color: 'rgb(59, 130, 246)' },
  { key: 'maths', name: 'Maths', icon: 'ph-calculator', color: 'rgb(139, 92, 246)' },
  { key: 'mock', name: 'Mock Tests', icon: 'ph-exam', color: 'rgb(255, 143, 63)' }
];

let activeTracker = { subject: 'physics', description: '', startedAt: null, pausedAccumulated: 0, isPaused: false };
let trackerSessions = [];
let dailyGoals = { hours: 4, minutes: 0, questions: 50 };
let dailyQuestions = { phy: 0, chem: 0, maths: 0 };

// Tracker DOM
const subjectSelect = document.getElementById('subjectSelect');
const sessionDesc = document.getElementById('sessionDesc');
const activeTimerDisplay = document.getElementById('activeTimerDisplay');
const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const sessionLog = document.getElementById('sessionLog');

function loadTrackerData() {
  try {
    const sData = localStorage.getItem(STORAGE_PREFIX + 'sessions');
    if (sData) trackerSessions = JSON.parse(sData) || [];
    
    const gData = localStorage.getItem(STORAGE_PREFIX + 'goals');
    if (gData) dailyGoals = JSON.parse(gData);
    
    const todayKey = STORAGE_PREFIX + 'questions_' + new Date().toDateString();
    const qData = localStorage.getItem(todayKey);
    if (qData) dailyQuestions = JSON.parse(qData);
  } catch (e) { console.error("Tracker load error", e); }
}

function saveTrackerData() {
  try {
    localStorage.setItem(STORAGE_PREFIX + 'sessions', JSON.stringify(trackerSessions));
    localStorage.setItem(STORAGE_PREFIX + 'goals', JSON.stringify(dailyGoals));
    const todayKey = STORAGE_PREFIX + 'questions_' + new Date().toDateString();
    localStorage.setItem(todayKey, JSON.stringify(dailyQuestions));
  } catch (e) {}
}

function getActiveElapsedSec() {
  if (!activeTracker.startedAt) return activeTracker.pausedAccumulated;
  return activeTracker.pausedAccumulated + Math.floor((Date.now() - activeTracker.startedAt) / 1000);
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function formatDurationShort(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function updateTimerUI() {
  const elapsed = getActiveElapsedSec();
  activeTimerDisplay.textContent = formatTime(elapsed);
  
  const isRunning = !!activeTracker.startedAt;
  if (isRunning) {
    activeTimerDisplay.classList.add('running');
    startBtn.innerHTML = '<i class="ph-fill ph-pause"></i>';
    startBtn.classList.remove('start');
    startBtn.classList.add('pause');
  } else {
    activeTimerDisplay.classList.remove('running');
    startBtn.innerHTML = '<i class="ph-fill ph-play"></i>';
    startBtn.classList.remove('pause');
    startBtn.classList.add('start');
  }
  endBtn.disabled = !isRunning && !activeTracker.isPaused;
  subjectSelect.disabled = isRunning;
  sessionDesc.disabled = isRunning;
}

// Timer Controls
startBtn.addEventListener('click', () => {
  if (activeTracker.startedAt) {
    // Pause
    activeTracker.pausedAccumulated = getActiveElapsedSec();
    activeTracker.startedAt = null;
    activeTracker.isPaused = true;
  } else {
    // Start/Resume
    if (!activeTracker.isPaused) {
      activeTracker.subject = subjectSelect.value;
      activeTracker.description = sessionDesc.value.trim();
      activeTracker.pausedAccumulated = 0;
    }
    activeTracker.startedAt = Date.now();
    activeTracker.isPaused = false;
  }
  updateTimerUI();
  saveTrackerData();
});

endBtn.addEventListener('click', () => {
  const duration = getActiveElapsedSec();
  if (duration > 5) {
    trackerSessions.push({
      id: Date.now().toString(36),
      subject: activeTracker.subject,
      description: activeTracker.description,
      startTs: Date.now() - (duration * 1000),
      endTs: Date.now(),
      duration: duration
    });
    showToast('Session logged: ' + formatDurationShort(duration), 'success');
  }
  
  // Reset
  activeTracker = { subject: 'physics', description: '', startedAt: null, pausedAccumulated: 0, isPaused: false };
  sessionDesc.value = ''; // Clear description
  subjectSelect.value = 'physics'; // Reset subject
  
  updateTimerUI();
  saveTrackerData();
  renderSessionLog();
});

// Init Timer
loadTrackerData();
updateTimerUI();
setInterval(() => { if (activeTracker.startedAt) updateTimerUI(); }, 1000);
renderSessionLog()

// === Session Log & Modal ===
const openModalBtn = document.getElementById('openModalBtn');
const sessionModal = document.getElementById('sessionModal');
const modalSubject = document.getElementById('modalSubject');
const modalDuration = document.getElementById('modalDuration');
const modalDesc = document.getElementById('modalDesc');
const discardModalBtn = document.getElementById('discardModalBtn');
const saveModalBtn = document.getElementById('saveModalBtn');

function renderSessionLog() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  // Get today's sessions in reverse chronological order
  const todaySessions = trackerSessions
    .filter(s => s.endTs >= todayStart.getTime())
    .sort((a, b) => b.endTs - a.endTs);

  sessionLog.innerHTML = '';
  
  if (todaySessions.length === 0) {
    sessionLog.innerHTML = '<div style="text-align: center; padding: 2rem 1rem; color: var(--muted); font-size: 0.85rem;">No sessions logged today. Get started!</div>';
    return;
  }

  todaySessions.forEach(s => {
    const subj = SUBJECTS.find(x => x.key === s.subject) || SUBJECTS[0];
    const d = new Date(s.endTs);
    const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-item-icon" style="background: ${subj.color}22; color: ${subj.color};">
        <i class="ph-fill ${subj.icon}"></i>
      </div>
      <div class="log-item-info">
        <div class="log-item-subject">${subj.name}</div>
        <div class="log-item-desc">${s.description || 'Ended at ' + timeStr}</div>
      </div>
      <div class="log-item-duration">${formatDurationShort(s.duration)}</div>
      <button class="log-item-delete" data-id="${s.id}" aria-label="Delete session">
        <i class="ph ph-x"></i>
      </button>
    `;
    sessionLog.appendChild(item);
  });
}

// Delete Session Logic (Event Delegation)
sessionLog.addEventListener('click', (e) => {
  const btn = e.target.closest('.log-item-delete');
  if (btn) {
    const id = btn.dataset.id;
    trackerSessions = trackerSessions.filter(s => s.id !== id);
    saveTrackerData();
    renderSessionLog();
    showToast('Session deleted', 'success');
  }
});

// Modal Logic
openModalBtn.addEventListener('click', () => {
  // Reset fields on open
  modalSubject.value = 'physics';
  modalDuration.value = 30;
  modalDesc.value = '';
  sessionModal.classList.add('active');
});

discardModalBtn.addEventListener('click', () => {
  sessionModal.classList.remove('active');
});

// Close modal if clicking outside the card
sessionModal.addEventListener('click', (e) => {
  if (e.target === sessionModal) {
    sessionModal.classList.remove('active');
  }
});

saveModalBtn.addEventListener('click', () => {
  const subject = modalSubject.value;
  const durationMin = parseInt(modalDuration.value, 10);
  const desc = modalDesc.value.trim();
  
  if (isNaN(durationMin) || durationMin <= 0) {
    showToast('Please enter a valid duration', 'error');
    return;
  }
  
  const durationSec = durationMin * 60;
  const now = Date.now();
  
  trackerSessions.push({
    id: now.toString(36),
    subject: subject,
    description: desc,
    startTs: now - (durationSec * 1000),
    endTs: now,
    duration: durationSec
  });
  
  saveTrackerData();
  renderSessionLog();
  sessionModal.classList.remove('active');
  showToast('Manual session added', 'success');
});

// === Tracker Math & Charts ===
const statMaxDay = document.getElementById('statMaxDay');
const statAvgSession = document.getElementById('statAvgSession');
const statAvgHrsDay = document.getElementById('statAvgHrsDay');
const statTimeStreak = document.getElementById('statTimeStreak');
const pieChart = document.getElementById('pieChart');
const pieTotal = document.getElementById('pieTotal');
const pieLegend = document.getElementById('pieLegend');
const barChart = document.getElementById('barChart');

function startOfDay(d) {
  var r = new Date(d); r.setHours(0,0,0,0); return r;
}

function getDayKey(d) {
  return STORAGE_PREFIX + 'questions_' + d.toDateString();
}

function getTodayTotalSeconds() {
  var todayStart = startOfDay(new Date()).getTime();
  return trackerSessions
    .filter(s => s.endTs >= todayStart)
    .reduce((sum, s) => sum + s.duration, 0);
}

function renderTrackerDashboard() {
  renderSessionLog();
  
  var now = new Date();
  var todayStart = startOfDay(now).getTime();
  var sevenDaysAgo = todayStart - (6 * 24 * 60 * 60 * 1000);
  var thirtyDaysAgo = todayStart - (29 * 24 * 60 * 60 * 1000);
  
  // 1. Most hrs in 1 day (7d)
  var dailyTotals = {};
  for (var i = 0; i < 7; i++) {
    var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    dailyTotals[d.getTime()] = 0;
  }
  
  trackerSessions.filter(s => s.endTs >= sevenDaysAgo).forEach(s => {
    var dayStart = startOfDay(new Date(s.endTs)).getTime();
    if (dailyTotals[dayStart] !== undefined) dailyTotals[dayStart] += s.duration;
  });
  
  var maxDay = Math.max.apply(null, Object.values(dailyTotals));
  statMaxDay.textContent = formatDurationShort(maxDay);
  
  // 2. Avg session (30d)
  var last30 = trackerSessions.filter(s => s.endTs >= thirtyDaysAgo);
  var avgSes = last30.length > 0 ? last30.reduce((a,s) => a+s.duration, 0) / last30.length : 0;
  statAvgSession.textContent = formatDurationShort(avgSes);
  
  // 3. 7-day daily avg
  var avgDay = Object.values(dailyTotals).reduce((a,b) => a+b, 0) / 7;
  statAvgHrsDay.textContent = formatDurationShort(avgDay);
  
  // 4. Time Streak (any session logged)
  var tStreak = 0;
  for (var i = 0; ; i++) {
    var checkDate = new Date(); checkDate.setHours(0,0,0,0); checkDate.setDate(checkDate.getDate() - i);
    var checkStart = checkDate.getTime();
    var checkEnd = checkStart + 86400000;
    var hasLogged = trackerSessions.some(s => s.endTs >= checkStart && s.endTs < checkEnd);
    if (hasLogged) tStreak++; else break;
    if (i > 365) break; // Safety break
  }
  statTimeStreak.textContent = tStreak + ' days';
  
  renderCharts(dailyTotals);
  renderGoals();
}

function renderCharts(dailyTotals) {
  // Pie Chart Data
  var sevenDaysAgo = startOfDay(new Date()).getTime() - (6 * 24 * 60 * 60 * 1000);
  var pieData = {};
  SUBJECTS.forEach(s => pieData[s.key] = 0);
  
  trackerSessions.filter(s => s.endTs >= sevenDaysAgo).forEach(s => {
    pieData[s.subject] = (pieData[s.subject] || 0) + s.duration;
  });
  
  var totalPieTime = Object.values(pieData).reduce((a,b) => a+b, 0);
  pieTotal.textContent = formatDurationShort(totalPieTime);
  
  // Draw Pie
  pieChart.innerHTML = '';
  pieLegend.innerHTML = '';
  
  if (totalPieTime > 0) {
    var startAngle = 0;
    
    SUBJECTS.forEach(s => {
      if (pieData[s.key] > 0) {
        var pct = pieData[s.key] / totalPieTime;
        
        // If it's 100% of the pie, draw a full circle to avoid 360deg path math issues
        if (pct === 1) {
          var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', 100);
          circle.setAttribute('cy', 100);
          circle.setAttribute('r', 80);
          circle.setAttribute('fill', s.color);
          circle.setAttribute('opacity', '0.9');
          pieChart.appendChild(circle);
        } else {
          var endAngle = startAngle + (pct * 360);
          var largeArc = endAngle - startAngle > 180 ? 1 : 0;
          
          var r = 80;
          var x1 = 100 + r * Math.cos((startAngle - 90) * Math.PI / 180);
          var y1 = 100 + r * Math.sin((startAngle - 90) * Math.PI / 180);
          var x2 = 100 + r * Math.cos((endAngle - 90) * Math.PI / 180);
          var y2 = 100 + r * Math.sin((endAngle - 90) * Math.PI / 180);
          
          var pathData = 'M 100 100 L ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z';
          var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathData);
          path.setAttribute('fill', s.color);
          path.setAttribute('opacity', '0.9');
          path.setAttribute('stroke', 'var(--card)'); 
          path.setAttribute('stroke-width', '2');
          path.setAttribute('stroke-linejoin', 'round'); // Prevents sharp spike artifacts at the center
          pieChart.appendChild(path);
          
          startAngle = endAngle; // No gap added, perfectly contiguous
        }

        var legend = document.createElement('div');
        legend.className = 'legend-item';
        legend.innerHTML = '<span class="legend-dot" style="background:' + s.color + '"></span> ' + s.name + ' (' + Math.round(pct*100) + '%)';
        pieLegend.appendChild(legend);
      }
    });
  } else {
    var legend = document.createElement('div');
    legend.className = 'legend-item';
    legend.style.color = 'var(--muted)';
    legend.textContent = 'No data yet';
    pieLegend.appendChild(legend);
  }
  
  // Bar Chart (Stacked)
  var w = 400, h = 200, pad = 40;
  var maxVal = Math.max.apply(null, Object.values(dailyTotals));
  if (maxVal === 0) maxVal = 3600; // Default 1hr scale
  
  var chartSvgContent = '';
  var maxH = h - pad * 2;
  var stepX = (w - pad * 2) / 7;
  var barWidth = stepX * 0.6;
  
  // Grid lines
  chartSvgContent += '<line x1="' + pad + '" y1="' + pad + '" x2="' + (w-pad) + '" y2="' + pad + '" class="chart-grid-line"/>';
  chartSvgContent += '<line x1="' + pad + '" y1="' + (h-pad) + '" x2="' + (w-pad) + '" y2="' + (h-pad) + '" class="chart-grid-line"/>';
  chartSvgContent += '<text x="' + (pad-5) + '" y="' + (pad+4) + '" text-anchor="end" class="chart-axis-label">' + formatDurationShort(maxVal) + '</text>';
  chartSvgContent += '<text x="' + (pad-5) + '" y="' + (h-pad+4) + '" text-anchor="end" class="chart-axis-label">0m</text>';
  
  // Stacked Bars
  for (var i = 6; i >= 0; i--) {
    var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    var dayStart = d.getTime();
    var dayEnd = dayStart + 86400000;
    
    var x = pad + ((6-i) * stepX) + (stepX - barWidth)/2;
    var currentY = h - pad;
    
    SUBJECTS.forEach(s => {
      var subjDur = trackerSessions
        .filter(sess => sess.subject === s.key && sess.endTs >= dayStart && sess.endTs < dayEnd)
        .reduce((a, sess) => a + sess.duration, 0);
        
      if (subjDur > 0) {
        var barH = (subjDur / maxVal) * maxH;
        currentY -= barH;
        chartSvgContent += '<rect x="' + x + '" y="' + currentY + '" width="' + barWidth + '" height="' + barH + '" fill="' + s.color + '" rx="2" class="bar-chart-bar"><title>' + s.name + ': ' + formatDurationShort(subjDur) + '</title></rect>';
      }
    });
    
    var label = (d.getMonth()+1) + '/' + d.getDate();
    chartSvgContent += '<text x="' + (x + barWidth/2) + '" y="' + (h - pad + 15) + '" text-anchor="middle" class="chart-axis-label">' + label + '</text>';
  }
  
  barChart.innerHTML = chartSvgContent;
}

// === Goals & Questions Logic ===
const goalHours = document.getElementById('goalHours');
const goalMinutes = document.getElementById('goalMinutes');
const questionsGoal = document.getElementById('questionsGoal');
const qPhy = document.getElementById('qPhy');
const qChem = document.getElementById('qChem');
const qMaths = document.getElementById('qMaths');
const timeGoalText = document.getElementById('timeGoalText');
const questionsGoalText = document.getElementById('questionsGoalText');
const statQuestionStreak = document.getElementById('statQuestionStreak');

function renderGoals() {
  // Sync UI inputs with state
  goalHours.value = dailyGoals.hours;
  goalMinutes.value = dailyGoals.minutes;
  questionsGoal.value = dailyGoals.questions;
  qPhy.value = dailyQuestions.phy;
  qChem.value = dailyQuestions.chem;
  qMaths.value = dailyQuestions.maths;
  
  // Time Goal Progress
  var goalSecs = (dailyGoals.hours * 3600) + (dailyGoals.minutes * 60);
  var todaySecs = getTodayTotalSeconds();
  timeGoalText.textContent = formatDurationShort(todaySecs) + ' / ' + formatDurationShort(goalSecs);
  timeGoalText.classList.toggle('met', goalSecs > 0 && todaySecs >= goalSecs);
  
  // Question Goal Progress
  var totalQ = dailyQuestions.phy + dailyQuestions.chem + dailyQuestions.maths;
  questionsGoalText.textContent = totalQ + ' / ' + dailyGoals.questions;
  questionsGoalText.classList.toggle('met', dailyGoals.questions > 0 && totalQ >= dailyGoals.questions);
  
  // Question Streak Logic
  var qStreak = 0;
  for (var i = 0; ; i++) {
    var checkDate = new Date(); checkDate.setHours(0,0,0,0); checkDate.setDate(checkDate.getDate() - i);
    var key = getDayKey(checkDate);
    var data = localStorage.getItem(key);
    
    if (data) {
      try {
        var parsed = JSON.parse(data);
        var total = (parsed.phy || 0) + (parsed.chem || 0) + (parsed.maths || 0);
        // We need to know the goal for THAT day. Since we only store current goal, 
        // we assume the goal was the same as today's goal for past days.
        if (total >= dailyGoals.questions && dailyGoals.questions > 0) {
          qStreak++;
        } else {
          break;
        }
      } catch(e) { break; }
    } else {
      // If today has no data yet, don't break the streak immediately, check yesterday
      if (i === 0) continue; 
      break;
    }
    if (i > 365) break;
  }
  statQuestionStreak.textContent = qStreak + ' days';
}

// Goal Input Listeners
[goalHours, goalMinutes, questionsGoal].forEach(input => {
  input.addEventListener('input', () => {
    dailyGoals.hours = parseInt(goalHours.value, 10) || 0;
    dailyGoals.minutes = parseInt(goalMinutes.value, 10) || 0;
    dailyGoals.questions = parseInt(questionsGoal.value, 10) || 0;
    saveTrackerData();
    renderGoals();
  });
});

// Question Input Listeners
[qPhy, qChem, qMaths].forEach(input => {
  input.addEventListener('input', () => {
    dailyQuestions.phy = parseInt(qPhy.value, 10) || 0;
    dailyQuestions.chem = parseInt(qChem.value, 10) || 0;
    dailyQuestions.maths = parseInt(qMaths.value, 10) || 0;
    saveTrackerData();
    renderGoals();
  });
});

// Initial Dashboard Render
renderTrackerDashboard();