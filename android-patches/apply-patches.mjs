#!/usr/bin/env node
/**
 * Runs AFTER `npx cap add android` (and BEFORE `npx cap sync`).
 * Splices our custom SMS plugin into the generated Android project.
 *
 * Steps:
 *   1. Replace MainActivity.java with our version that registers the plugin
 *   2. Copy SmsReaderPlugin.kt into the same package folder
 *   3. Add SMS permissions to AndroidManifest.xml (idempotent)
 *   4. Add Kotlin support to app/build.gradle if missing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');
const PACKAGE_PATH = path.join(ANDROID, 'app', 'src', 'main', 'java', 'com', 'finsight', 'app');
const MANIFEST = path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml');
const APP_GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const PROJECT_GRADLE = path.join(ANDROID, 'build.gradle');

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

function log(msg) { console.log('[apply-patches] ' + msg); }

// 0. Sanity
if (!fs.existsSync(ANDROID)) {
  console.error('[apply-patches] android/ folder not found. Run `npx cap add android` first.');
  process.exit(1);
}

// 1. MainActivity.java
ensure(PACKAGE_PATH);
const mainSrc = fs.readFileSync(path.join(__dirname, 'MainActivity.java'), 'utf8');
fs.writeFileSync(path.join(PACKAGE_PATH, 'MainActivity.java'), mainSrc);
log('Wrote MainActivity.java');

// 2. SmsReaderPlugin.kt
const kotlinSrc = fs.readFileSync(path.join(__dirname, 'SmsReaderPlugin.kt'), 'utf8');
fs.writeFileSync(path.join(PACKAGE_PATH, 'SmsReaderPlugin.kt'), kotlinSrc);
log('Wrote SmsReaderPlugin.kt');

// 3. AndroidManifest.xml — add SMS permissions + OAuth deep-link intent-filter
let manifest = fs.readFileSync(MANIFEST, 'utf8');
const permsToAdd = [
  '<uses-permission android:name="android.permission.READ_SMS" />',
  '<uses-permission android:name="android.permission.RECEIVE_SMS" />'
];
let changed = false;
for (const p of permsToAdd) {
  if (!manifest.includes(p)) {
    manifest = manifest.replace(
      /<manifest([^>]*)>/,
      `<manifest$1>\n    ${p}`
    );
    changed = true;
  }
}

// OAuth deep-link: handles com.finsight.app://oauth-success
const oauthFilter = `
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.finsight.app" android:host="oauth-success" />
            </intent-filter>`;
if (!manifest.includes('com.finsight.app') || !manifest.includes('oauth-success')) {
  // Insert inside the MainActivity <activity> block, after the existing intent-filter
  manifest = manifest.replace(
    /(<activity[^>]*android:name="\.MainActivity"[\s\S]*?)(<\/activity>)/,
    (m, head, tail) => head + oauthFilter + '\n        ' + tail
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(MANIFEST, manifest);
  log('Updated AndroidManifest.xml (permissions + OAuth deep link)');
} else {
  log('AndroidManifest.xml already up to date');
}

// 4. Project-level build.gradle — add Kotlin plugin classpath if missing
let projectGradle = fs.readFileSync(PROJECT_GRADLE, 'utf8');
if (!projectGradle.includes('kotlin-gradle-plugin')) {
  // Find the dependencies block under buildscript and append
  projectGradle = projectGradle.replace(
    /(buildscript\s*\{[\s\S]*?dependencies\s*\{)([\s\S]*?)(\n\s*\})/,
    (m, head, body, tail) => {
      if (body.includes('kotlin-gradle-plugin')) return m;
      const kotlinDep = `\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25"`;
      return head + body + kotlinDep + tail;
    }
  );
  fs.writeFileSync(PROJECT_GRADLE, projectGradle);
  log('Added Kotlin gradle plugin to project build.gradle');
}

// 5. App-level build.gradle — apply kotlin-android plugin
let appGradle = fs.readFileSync(APP_GRADLE, 'utf8');
if (!appGradle.includes("apply plugin: 'kotlin-android'") && !appGradle.includes('id("org.jetbrains.kotlin.android")')) {
  // Insert after the com.android.application plugin line
  appGradle = appGradle.replace(
    /(apply plugin: ['"]com\.android\.application['"])/,
    `$1\napply plugin: 'kotlin-android'`
  );
  fs.writeFileSync(APP_GRADLE, appGradle);
  log('Applied kotlin-android plugin in app/build.gradle');
}

log('Patches applied successfully ✓');
