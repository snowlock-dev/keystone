console.log("Keystone initialized!");

// State object to hold app data
const state = {
  activeSection: 'home',
  todos: [],
  trackerSessions: []
};

// Basic section switching function (to be expanded later)
function switchSection(sectionName) {
  console.log(`Switching to: ${sectionName}`);
  state.activeSection = sectionName;
  // Toggling UI classes will go here
}
