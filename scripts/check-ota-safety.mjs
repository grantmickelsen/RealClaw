#!/usr/bin/env node
/**
 * OTA Safety Gate — blocks EAS OTA updates that require App Store review.
 *
 * Usage: node scripts/check-ota-safety.mjs <bundle-dir>
 *
 * Exit 0: bundle is safe to publish via EAS Update (JS/asset-only changes).
 * Exit 1: bundle contains changes that require App Store review.
 *
 * Apple Guideline 2.5.2 prohibits using hot-code-push to "fundamentally alter"
 * the app or add native functionality without review. This script enforces the
 * boundary by pattern-scanning the JS bundle for disallowed content.
 *
 * OTA-safe:   Bug fixes, copy changes, color/theme tweaks, logic improvements
 * App Store:  New NativeModules, new permissions, new native components, eval()
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const bundleDir = process.argv[2];
if (!bundleDir) {
  console.error('Usage: node scripts/check-ota-safety.mjs <bundle-dir>');
  process.exit(1);
}

// Patterns that indicate the bundle requires App Store review, not OTA.
const DISALLOWED = [
  {
    pattern: /NativeModules\.\w+/g,
    reason: 'New NativeModules access (requires native code review)',
  },
  {
    pattern: /requireNativeComponent\s*\(/g,
    reason: 'New native component registration',
  },
  {
    pattern: /TurboModuleRegistry\.get\s*\(/g,
    reason: 'New TurboModule access',
  },
  {
    pattern: /NSCameraUsageDescription/g,
    reason: 'Camera permission string (new permission requires App Store review)',
  },
  {
    pattern: /NSMicrophoneUsageDescription/g,
    reason: 'Microphone permission string',
  },
  {
    pattern: /NSContactsUsageDescription/g,
    reason: 'Contacts permission string',
  },
  {
    pattern: /NSLocationAlwaysUsageDescription|NSLocationWhenInUseUsageDescription/g,
    reason: 'Location permission string',
  },
  {
    pattern: /NSPhotoLibraryUsageDescription|NSPhotoLibraryAddUsageDescription/g,
    reason: 'Photo library permission string',
  },
  {
    pattern: /android\.permission\.\w+/g,
    reason: 'Android permission declaration',
  },
  {
    // Blocks eval() — Apple Guideline 2.5.6 prohibits downloading and executing code
    pattern: /\beval\s*\(/g,
    reason: 'eval() — Guideline 2.5.6 violation (prohibited executable code)',
  },
  {
    pattern: /new Function\s*\(/g,
    reason: 'new Function() — Guideline 2.5.6 violation',
  },
  {
    // New integrations need OAuth review and new App Store permission disclosures
    // This list is the approved set known to the App Store reviewer.
    // Add new IDs here only AFTER completing App Store review for them.
    pattern: /"integration_id"\s*:\s*"(?!gmail|google_calendar|hubspot|twilio|rentcast|docusign|buffer|canva)\w+"/g,
    reason: 'Unapproved integration ID (complete App Store review before OTA-ing this)',
  },
];

/** @type {Array<{file: string, reason: string, examples: string[]}>} */
const violations = [];

/** @param {string} filePath */
function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return; // Skip unreadable files
  }

  for (const { pattern, reason } of DISALLOWED) {
    // Reset regex state between calls (global flag carries lastIndex)
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) {
      violations.push({
        file: relative(bundleDir, filePath),
        reason,
        examples: [...new Set(matches)].slice(0, 3),
      });
    }
  }
}

/** @param {string} dir */
function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else if (entry.endsWith('.js') || entry.endsWith('.hbc')) {
      scanFile(full);
    }
  }
}

console.log(`[OTA Gate] Scanning bundle: ${bundleDir}`);
scanDir(bundleDir);

if (violations.length === 0) {
  console.log('[OTA Gate] PASSED — bundle is safe to publish via EAS Update');
  process.exit(0);
} else {
  console.error('[OTA Gate] FAILED — bundle requires App Store review:\n');
  for (const v of violations) {
    console.error(`  [${v.reason}]`);
    console.error(`    File: ${v.file}`);
    console.error(`    Examples: ${v.examples.join(', ')}`);
    console.error('');
  }
  console.error('Submit through full App Store review:');
  console.error('  eas build --platform all --profile production');
  console.error('  eas submit --platform all --profile production');
  process.exit(1);
}
