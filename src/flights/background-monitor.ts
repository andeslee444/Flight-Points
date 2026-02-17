/**
 * Background Flight Monitor
 * Runs continuously, checking all active signups every 30 minutes
 * 
 * Usage: npx tsx src/flights/background-monitor.ts
 * 
 * Created: 2026-02-16
 */

import * as fs from 'fs';
import * as path from 'path';
import { searchFlights, signupToSearchParams, type FlightSignup, type FlightResult } from './monitor';

const DATA_DIR = path.join(__dirname, '../../data');
const SIGNUPS_PATH = path.join(DATA_DIR, 'flight-signups.json');
const AVAILABILITY_DIR = path.join(DATA_DIR, 'flight-availability');
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================
// NOTIFICATION
// ============================================================

function notify(message: string) {
  console.log(`📢 ${message}`);
  // Try WhatsApp notification
  try {
    const { execSync } = require('child_process');
    execSync(`/opt/homebrew/bin/openclaw message send --channel whatsapp --to "+14255336828" --message "${message.replace(/"/g, '\\"')}"`, { timeout: 10000 });
  } catch {
    // Log to file as fallback
    const logPath = path.join(DATA_DIR, 'flight-notifications.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  }
}

// ============================================================
// LOAD SIGNUPS
// ============================================================

function loadSignups(): FlightSignup[] {
  if (!fs.existsSync(SIGNUPS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SIGNUPS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// ============================================================
// PREVIOUS RESULTS (for diff detection)
// ============================================================

function loadPreviousResults(signupId: string): FlightResult[] {
  const file = path.join(AVAILABILITY_DIR, `${signupId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return data.results || [];
  } catch {
    return [];
  }
}

function saveResults(signupId: string, results: FlightResult[]): void {
  if (!fs.existsSync(AVAILABILITY_DIR)) fs.mkdirSync(AVAILABILITY_DIR, { recursive: true });
  const file = path.join(AVAILABILITY_DIR, `${signupId}.json`);
  fs.writeFileSync(file, JSON.stringify({
    signupId,
    lastChecked: new Date().toISOString(),
    count: results.length,
    results,
  }, null, 2));
}

// ============================================================
// DIFF & ALERT
// ============================================================

function detectNewAvailability(previous: FlightResult[], current: FlightResult[]): FlightResult[] {
  const prevIds = new Set(previous.map(r => r.id));
  return current.filter(r => !prevIds.has(r.id));
}

function formatAlert(signup: FlightSignup, newResults: FlightResult[]): string {
  const hotDeals = newResults.filter(r => r.dealRating === 'hot');
  const goodDeals = newResults.filter(r => r.dealRating === 'good');
  
  let msg = `✈️ New award availability: ${signup.from} → ${signup.to}\n`;
  msg += `Found ${newResults.length} new option(s)`;
  
  if (hotDeals.length > 0) {
    msg += `\n\n🔥 HOT DEAL${hotDeals.length > 1 ? 'S' : ''}:\n`;
    for (const deal of hotDeals.slice(0, 3)) {
      msg += `• ${deal.cabinDisplay} on ${deal.airline} — ${deal.points.toLocaleString()} pts`;
      if (deal.cpp) msg += ` (${deal.cpp} cpp)`;
      msg += ` — ${deal.departureDate}\n`;
      msg += `  ${deal.transferPath}\n`;
    }
  }
  
  if (goodDeals.length > 0 && hotDeals.length === 0) {
    msg += `\n\n✅ Good deals:\n`;
    for (const deal of goodDeals.slice(0, 3)) {
      msg += `• ${deal.cabinDisplay} on ${deal.airline} — ${deal.points.toLocaleString()} pts`;
      if (deal.cpp) msg += ` (${deal.cpp} cpp)`;
      msg += ` — ${deal.departureDate}\n`;
    }
  }
  
  return msg;
}

// ============================================================
// MAIN CHECK LOOP
// ============================================================

async function checkAllSignups() {
  const signups = loadSignups();
  if (signups.length === 0) {
    console.log('📭 No active signups to monitor');
    return;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 Checking ${signups.length} signup(s) at ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  
  for (let i = 0; i < signups.length; i++) {
    const signup = signups[i];
    if (!signup.continuous && signup.endDate && new Date(signup.endDate) < new Date()) {
      console.log(`⏭️  Skipping expired signup: ${signup.from} → ${signup.to}`);
      continue;
    }
    
    const signupId = `signup-${i}`;
    console.log(`\n🔍 [${i + 1}/${signups.length}] ${signup.from} → ${signup.to} (${signup.class}, ${signup.program})`);
    
    try {
      const params = signupToSearchParams(signup);
      const results = await searchFlights(params);
      
      console.log(`   Found ${results.length} result(s)`);
      
      // Compare with previous
      const previous = loadPreviousResults(signupId);
      const newResults = detectNewAvailability(previous, results);
      
      if (newResults.length > 0) {
        console.log(`   🆕 ${newResults.length} NEW result(s)!`);
        const alert = formatAlert(signup, newResults);
        notify(alert);
      } else {
        console.log(`   No new results since last check`);
      }
      
      // Save current results
      saveResults(signupId, results);
      
      // Log hot deals
      const hotDeals = results.filter(r => r.dealRating === 'hot');
      if (hotDeals.length > 0) {
        console.log(`   🔥 ${hotDeals.length} hot deal(s) available`);
      }
      
    } catch (err: any) {
      console.error(`   ❌ Error: ${err.message}`);
    }
    
    // Delay between signups
    if (i < signups.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log(`\n✅ Check complete. Next check in ${CHECK_INTERVAL_MS / 60000} minutes.`);
}

// ============================================================
// RUN
// ============================================================

async function main() {
  console.log('🐙✈️  Harbor Flights — Background Monitor');
  console.log(`Check interval: ${CHECK_INTERVAL_MS / 60000} minutes`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log('');
  
  // Initial check
  await checkAllSignups();
  
  // Schedule recurring checks
  setInterval(async () => {
    try {
      await checkAllSignups();
    } catch (err: any) {
      console.error(`Fatal error in check loop: ${err.message}`);
    }
  }, CHECK_INTERVAL_MS);
  
  // Keep process alive
  console.log('\n🟢 Monitor running. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('Failed to start monitor:', err);
  process.exit(1);
});
