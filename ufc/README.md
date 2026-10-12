# UFC Hub — GitHub to APK

Standalone export of the UFC Hub app (from perchance.org/6ngw0k46d1),
wrapped with Capacitor so GitHub Actions builds the APK in the cloud.

## Files
- `www/` — the app (open `www/index.html` in a browser to smoke-test)
- `capacitor.config.json`, `package.json` — Capacitor wrapper
- `assets/icon.png`, `assets/splash.png` — generated from the app's UFC badge
- `.github/workflows/build-apk.yml` — the cloud build

## Steps (detail in chat)
1. New GitHub repo, upload everything here (or push this folder).
2. Actions tab -> "Build UFC Hub APK" -> Run workflow.
3. Download the `ufc-hub-debug-apk` artifact -> install on your phone.
