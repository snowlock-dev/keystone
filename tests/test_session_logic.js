const assert = require('assert');

// Mocking for local testing
const dayKey = (date) => { const d = date instanceof Date ? date : new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Function under test
function calculateSessionDates(durationMin, endTimeStr, isYesterday) {
  const durationSec = durationMin * 60;
  const end = new Date();
  
  if (isYesterday) {
    end.setDate(end.getDate() - 1);
  }

  if (endTimeStr) {
    const [h, m] = endTimeStr.split(':').map(Number);
    // Simple robustness check for NaN hours/minutes
    if (!isNaN(h) && !isNaN(m)) {
        end.setHours(h, m, 0, 0);
    }
  }

  const start = new Date(end.getTime() - durationSec * 1000);
  return { start, end };
}


function runTest(name, fn) {
  try {
    fn();
    // ansi ftw
    console.log(`\x1b[32m[+] Passed:\x1b[0m ${name}`);
  } catch (err) {
    console.error(`\x1b[31m[!] Failed:\x1b[0m ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log("Running tests...\n");

// Standard Tests
runTest("Default today session", () => {
  const { end } = calculateSessionDates(30, '', false);
  assert.strictEqual(dayKey(end), dayKey(new Date()));
});

runTest("Default yesterday session", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { end } = calculateSessionDates(30, '', true);
  assert.strictEqual(dayKey(end), dayKey(yesterday));
});

runTest("Today with specific end time", () => {
  const { end } = calculateSessionDates(30, '14:30', false);
  assert.strictEqual(end.getHours(), 14);
  assert.strictEqual(end.getMinutes(), 30);
});

// Boundary/Edge Case Tests
runTest("Yesterday with early morning end time", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const { end } = calculateSessionDates(60, '01:00', true);
  assert.strictEqual(dayKey(end), dayKey(yesterday));
  assert.strictEqual(end.getHours(), 1);
});

runTest("End time at midnight (00:00)", () => {
  const { end } = calculateSessionDates(15, '00:00', false);
  assert.strictEqual(end.getHours(), 0);
  assert.strictEqual(end.getMinutes(), 0);
});

runTest("End time at end of day (23:59)", () => {
  const { end } = calculateSessionDates(15, '23:59', false);
  assert.strictEqual(end.getHours(), 23);
  assert.strictEqual(end.getMinutes(), 59);
});

runTest("Long duration spanning across days", () => {
    // 25 hours duration
    const { start, end } = calculateSessionDates(25 * 60, '12:00', false);
    const expectedStart = new Date(end.getTime() - (25 * 60 * 60 * 1000));
    assert.strictEqual(start.getTime(), expectedStart.getTime());
});

runTest("Robustness: Invalid end time string", () => {
    // Should fall back to 'now' if parsing fails
    const before = new Date();
    const { end } = calculateSessionDates(30, 'invalid', false);
    // End should be roughly now
    assert.ok(Math.abs(end.getTime() - before.getTime()) < 1000);
});

console.log("\nAll logic tests passed!");
