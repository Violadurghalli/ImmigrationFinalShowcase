# Immigration Snap Clone — Language Bridge

A Snapchat-style Expo app built for the **SEA Immigration Final Showcase**. The goal is to help Spanish- and English-speaking immigrants talk more easily by putting **live chat translation** and **video voice dubbing** inside a familiar Snap-like experience.

This project started from a Snapchat clone starter (auth + camera) and was extended with AI language features for the showcase.

---

## Features

### 1. Snapchat-style mobile app
- Email/password **sign up & login** (Supabase Auth)
- Bottom tabs: **Map**, **Chat**, **Camera**, **Stories**, **Spotlight**
- Full-screen **camera** — photos, video recording, flip camera, flash, preview/retake

### 2. Live chat translation (text)
Open a chat and talk like you would on Snapchat. The conversation bot replies in **Spanish**, and the UI shows **English translations** under each message (and translates your English into Spanish for the thread).

- Built in `ConversationScreen` with OpenAI (`gpt-4o-mini`)
- Bot is prompted to return JSON: user translation, Spanish reply, English reply translation
- Green “TRANSLATION IN BETA” rows mirror Snapchat’s translation UI

### 3. Video snap dubbing (audio)
Record a video snap, pick **English** or **Spanish**, and dub the spoken audio into the other language while keeping the video.

Flow:
1. Upload the snap to **Supabase Storage** (`snaps` bucket)
2. Call the **`dub-snap` Edge Function**
3. Edge Function sends the file to **ElevenLabs Dubbing API**, polls until ready
4. Dubbed MP4 is stored back in Supabase and played in the camera preview

Implementation lives in:
- `src/screens/CameraScreen.tsx` — record + dub UI
- `utils/snaps.js` — upload + invoke edge function
- `supabase/functions/dub-snap/` — server-side ElevenLabs integration

### 4. Chatbots & extra screens
- Chat list with bot contacts (opens the translation conversation)
- Supporting Snap-clone screens (stories, map, profile, etc.) for the full demo look

---

## How I made it

### Stack
| Layer | Tech |
|--------|------|
| App | Expo SDK 54, React Native, React Navigation |
| Auth / DB / Storage | Supabase |
| Chat AI | OpenAI Chat Completions |
| Voice dubbing | ElevenLabs Dubbing API via Supabase Edge Function |
| Local dubbing (optional) | Express server in `server/` for LAN testing |

### Build path
1. **Starter Snap clone** — login + camera working end-to-end with Supabase and Expo Camera.
2. **Chat translation** — wired OpenAI into `ConversationScreen` so a Spanish-speaking friend bot replies with bilingual bubbles.
3. **Audio / video translation** — recorded snaps upload to Supabase Storage; `dub-snap` Edge Function talks to ElevenLabs (API key stays in Supabase secrets, not in the app).
4. **Polish** — language chips (EN/ES), dub status steps, dubbed preview playback, and Snap-like chat translation styling.

### Architecture (dubbing)

```
Phone (Expo Go)
  → upload video → Supabase Storage (snaps)
  → invoke dub-snap Edge Function
       → ElevenLabs Dubbing API
       → poll until dubbed MP4 ready
       → upload result to Storage
  ← signed/public dubbed video URL → play in preview
```

Chat translation is client → OpenAI → JSON reply rendered as original + translation rows.

---

## Share the app (public link)

This is a **mobile** Expo app (camera/mic). Others open it with **Expo Go**, not a normal website.

### Option A — Tunnel (best for demos)
Anyone on the internet can load the project while your machine is running:

```bash
npm install
npx expo start --tunnel
```

Expo prints a QR code and a shareable URL (often `exp://…` or an Expo link).  
Have people install **Expo Go** (SDK 54), then scan the QR or open the link.

> Tunnel needs your laptop online. When you stop Expo, the link dies.

### Option B — Same Wi‑Fi (LAN)
```bash
npx expo start
```
Scan the QR on a phone on the **same network**. Faster, but not reachable off-campus.

### Optional local dubbing server
Dubbing in production/demo uses the **cloud Edge Function**. The Express app in `server/` is only for local LAN experiments:

```bash
npm run dubbing-server
# set EXPO_PUBLIC_DUBBING_API_URL to your Mac LAN IP if you use this path
```

---

## Setup

### 1. Environment
Create `.env.local` in the project root (gitignored):

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY

# Chat / translation (use a backend proxy in production — do not ship secret keys in the app)
EXPO_PUBLIC_CHAT_API_URL=YOUR_CHAT_BACKEND_OR_TOKEN_SETUP
```

### 2. Supabase
- Enable Email auth (turn off “Confirm email” for easier demos if you want)
- Create the `snaps` storage bucket + policies (`supabase/sql/setup_snaps_storage.sql` if present)
- Deploy dubbing:

```bash
npx supabase secrets set ELEVENLABS_API_KEY=sk_...
npx supabase functions deploy dub-snap
```

### 3. Run

```bash
npm install
npx expo start --tunnel   # public share
# or
npx expo start            # local / LAN
```

Use a **physical phone** with Expo Go for camera and microphone.

---

## Project structure

```
App.jsx                          # Root → navigation
src/navigation/                  # Auth stack + user tabs
src/screens/CameraScreen.tsx     # Capture + ElevenLabs dub UI
src/screens/ConversationScreen.js# Spanish chat + OpenAI translations
src/screens/ChatScreen.js        # Chat list
utils/snaps.js                   # Storage upload + dub-snap invoke
utils/hooks/supabase.js          # Supabase client
supabase/functions/dub-snap/     # Edge Function → ElevenLabs
server/                          # Optional local Express dubbing API
```

---

## Showcase notes

**Problem:** Immigrants often chat across languages; typing translations and re-recording audio is slow.

**Solution:** Keep the Snapchat interaction model, add:
- bilingual **text chat** (OpenAI)
- one-tap **video dubbing** EN ↔ ES (ElevenLabs + Supabase)

**What to demo:** Sign in → open Chat → bilingual conversation → Camera → record a short clip → Dub to Spanish/English → play the dubbed snap.
