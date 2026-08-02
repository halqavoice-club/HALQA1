# HALQA — Build APK Guide

Two options: **EAS Cloud** (recommended, no Android Studio needed) or **Local** (needs Android Studio).

---

## OPTION A — EAS Cloud Build (Recommended)

### What you need
- Free account at https://expo.dev/signup
- ngrok for backend tunneling (so APK can reach your local backend)

---

### Step 1 — Expose your backend via ngrok

Download ngrok from https://ngrok.com/download, then:

```powershell
ngrok http 5000
```

You'll see output like:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:5000
```

Copy that `https://abc123.ngrok-free.app` URL.

---

### Step 2 — Update .env with ngrok URL

Open `mobile/.env` and set:
```
EXPO_PUBLIC_API_URL=https://abc123.ngrok-free.app/api/v1
EXPO_PUBLIC_SOCKET_URL=https://abc123.ngrok-free.app
```

---

### Step 3 — Login to EAS

```powershell
cd "c:\Users\Public\class management\nurul yaqin class ms\mobile"
eas login
```

---

### Step 4 — Link project

```powershell
eas init
```

Say **Yes** when asked to create a new project. This adds your projectId to app.json.

---

### Step 5 — Build APK

```powershell
eas build --platform android --profile preview
```

- Upload takes ~1 min
- Build runs in cloud ~10-15 min
- You get a download URL when done

Track progress at: https://expo.dev/accounts/[your-username]/projects/halqa-mobile/builds

---

### Step 6 — Install APK on phone

1. Open the build URL on your phone browser
2. Tap **Download**
3. Open the downloaded `.apk` file
4. Allow "Install unknown apps" if prompted
5. Launch **HALQA** app

---

## OPTION B — Local Build (needs Android Studio)

If you have Android Studio + Java 17 installed:

```powershell
cd "c:\Users\Public\class management\nurul yaqin class ms\mobile"
npx expo run:android
```

This builds and installs directly to a connected Android device or emulator.

---

## What the APK Unlocks

| Feature | Expo Go | APK |
|---------|---------|-----|
| Social Feed | ✅ | ✅ |
| Voice rooms list | ✅ | ✅ |
| Voice room AUDIO (LiveKit mic) | ❌ | ✅ |
| Live class VIDEO (LiveKit camera) | ❌ | ✅ |
| Stripe payment sheet | ❌ | ✅ |
| Push notifications | ❌ | ✅ |
| No Expo Go dependency | ❌ | ✅ |
| Share APK with anyone | ❌ | ✅ |

---

## APK vs Play Store

The `preview` build produces a debug APK you can share directly.

For Play Store submission, use the `production` profile which produces an AAB:
```powershell
eas build --platform android --profile production
eas submit --platform android
```

---

## Troubleshooting

**APK can't connect to backend**
→ You must use ngrok URL in .env, not LAN IP (10.x.x.x)
→ LAN IPs are only reachable on the same WiFi network

**"eas: command not found"**
→ Run: `npm install -g eas-cli`

**Build fails**
→ Check build logs at https://expo.dev
→ Common fix: run `eas build --clear-cache --platform android --profile preview`

**"Install blocked" on phone**
→ Settings → Security → Install unknown apps → Files → Allow
