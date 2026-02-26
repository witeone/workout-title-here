# Workout Log Web App

A lightweight web app for logging your gym workouts, powered by **Firebase Authentication** and **Cloud Firestore**.  
You can log exercises with **date, exercise name, weight, reps, superset ID (S#)** and optional notes.

This project is built as a simple static site (no bundler required) so it should work even on older Node setups — you only need a browser and a way to serve static files.

## Features

- **Email/password login & signup** using Firebase Authentication.
- **Per-user workout storage** in Firestore (each entry is tied to your user ID).
- Log sets with:
  - Date
  - Exercise name
  - Weight
  - Reps
  - Superset tag (e.g. `S1`, `S2`)
  - Notes
- **Recent workouts table** with optional **date filter**.
- Clean, responsive UI using [Pico.css](https://picocss.com) and a small custom stylesheet.

## Project structure

- `index.html` – main page and layout.
- `styles.css` – custom styles on top of Pico.css.
- `main.js` – all app logic (Firebase init, auth, workout CRUD).
- `firebase-config.example.js` – example Firebase config (copy this to `firebase-config.js` and fill in your own keys).

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. In **Build → Authentication → Get started**, enable **Email/Password** provider.
3. In **Build → Firestore Database**, create a new Firestore database (start in *test mode* while developing).
4. In **Project settings → General → Your apps**, add a **Web app** and copy the Firebase config snippet.

The config snippet will look similar to:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
};
```

## 2. Configure `firebase-config.js`

1. Copy the example file:

```bash
cp firebase-config.example.js firebase-config.js
```

2. Edit `firebase-config.js` and replace the placeholder values with your real Firebase config:

```js
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
};
```

> **Note:** Avoid committing real Firebase keys to a public repo. Use `.gitignore` for `firebase-config.js` if you initialize git.

## 3. Firestore data model

All workouts are stored in a `workouts` collection.  
Each document has (at least) these fields:

- `userId` – string, authenticated user ID.
- `date` – string, formatted as `YYYY-MM-DD`.
- `exerciseName` – string, e.g. `"Lat pulldown"`.
- `weight` – number, e.g. `59` (kg).
- `reps` – number, e.g. `10`.
- `superset` – string or `null`, e.g. `"S1"`.
- `notes` – string or `null`, free text.
- `createdAt` – Firestore `serverTimestamp()` for sorting.

This matches your notebook style (date + exercise + weight + reps + superset group).

## 4. Running the app locally

Because the app uses ES modules and Firebase’s CDN, you should open it via **HTTP**, not `file://`.

### Option A – Simple Python server (no Node required)

From the project directory:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173` in your browser.

### Option B – Any static file server

You can use any tool you like, for example:

- `npx serve .`
- `npx http-server .`

## 5. Using the app

1. Open the app in your browser (via a local HTTP server).
2. **Sign up** with an email and password (at least 6 characters).
3. After login you’ll see the workout form:
   - Pick a date (defaults to today).
   - Enter exercise name, weight, reps, optional `S#` and notes.
   - Click **Add set**.
4. Your sets appear in the **Recent workouts** table, ordered by date and time.
5. Use the **Filter by date** input to see only one session/day at a time.

## 6. Optional improvements

Ideas you might want to add later:

- Group sets into named sessions (e.g. “Back & Biceps”).
- Import historical data from your notebook (CSV/manual entry).
- Edit/delete logged sets.
- Analytics: volume per muscle group, PR tracking, etc.

