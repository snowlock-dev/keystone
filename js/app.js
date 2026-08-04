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


const STORAGE_PREFIX = 'keystone0.1_';
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