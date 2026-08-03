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
  // 1. Update state
  state.activeSection = sectionName;
  
  // 2. Toggle nav button active states
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionName);
  });
  
  // 3. Toggle view visibility
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