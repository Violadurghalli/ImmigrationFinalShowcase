# Snap Clone — Starter Project

A minimal Snapchat-look-alike starter fullstack mobile dev.
It ships with exactly two things working end-to-end:

1. A Snapchat-styled **login/sign-up screen** (Supabase Auth, email + password)
2. A **full-screen camera** that opens right after login (Expo Camera —
   capture photo, flip camera, toggle flash, preview + retake)

Everything else — Stories, chat, friends, disappearing snaps, sending a
snap to someone — is left as an exercise. There's a `TODO (students)` comment
in `src/screens/CameraScreen.tsx` and `src/lib/supabase.ts` marking the two
places you'll extend first.

## Tech stack

- Expo **SDK 54** (pinned — required for this to work in current Expo Go)
- React Native 0.81 / React 19
- Written in Javascript but is scaffolded to be refactor in TypeScript
- Supabase (`@supabase/supabase-js`) for auth + database
- `expo-camera` for the camera
- `@react-navigation/native` + `native-stack` are pre-installed (not wired up
  yet) — you'll want these once you add more screens (chat, stories, profile)

## 1. Set up Supabase

1. Create a free project at https://supabase.com
2. In your project, go to **Settings → API** and copy the **Project URL**
   and the **anon/public key**
3. Copy `.env.example` to `.env.local`, then fill in your own values. This file
   is ignored by Git. Use the Supabase **anon/public** key only — never a
   service-role key.

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=YOUR-ANON-KEY
```

## External API security

The mobile app calls `EXPO_PUBLIC_CHAT_API_URL` and
`EXPO_PUBLIC_ASTROLOGY_API_URL`. These are public backend endpoint URLs, not
credentials. Your backend must keep the `OPENAI_API_KEY` and RapidAPI key in
its own private environment variables and attach them when it calls those
providers. Do not add either key to an `EXPO_PUBLIC_*` variable: Expo embeds
those values in the app binary.

4. In Supabase, go to **Authentication → Providers** and make sure
   **Email** is `not` enabled. Under **Authentication →
   Settings** you may want to turn **off** "Confirm email" so users can
   sign up and log straight in without checking an inbox.

## 2. Install & run

```bash
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (SDK 54 build) on your phone.
Camera access requires a physical device or a simulator with camera
support — it will not work in the web preview. Please allow Expo Go to access your camera

## 3. Project structure

```
App.jsx                    -- auth listener: shows LoginScreen or CameraScreen
src/lib/supabase.js         -- Supabase client (put your keys here)
src/screens/LoginScreen.jsx  -- Snapchat-styled auth screen
src/screens/CameraScreen.jsx -- full-screen camera + capture/preview
```
