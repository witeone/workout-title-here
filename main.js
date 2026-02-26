import { firebaseConfig } from "./firebase-config.js";

import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

// ----- Firebase setup -----

if (!firebaseConfig || firebaseConfig.apiKey === "REPLACE_ME") {
  console.warn(
    "[Workout Log] firebaseConfig is not configured. " +
      "Copy firebase-config.example.js to firebase-config.js and fill in your keys.",
  );
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----- DOM helpers -----

const $ = (selector) => document.querySelector(selector);

const authSection = $("#auth-section");
const appSection = $("#app-section");
const authError = $("#auth-error");
const workoutError = $("#workout-error");
const userInfo = $("#user-info");
const userEmailEl = $("#user-email");

const workoutForm = $("#workout-form");
const workoutSubmitBtn = document.getElementById("workout-submit-btn");
const workoutCancelEditBtn = document.getElementById("workout-cancel-edit-btn");
const editIndicator = document.getElementById("edit-indicator");
const workoutDateInput = document.getElementById("workout-date");
const supersetSelect = document.getElementById("superset-with");
const comparisonMessageEl = document.getElementById("comparison-message");
const startWorkoutWrap = document.getElementById("start-workout-wrap");
const activeWorkoutWrap = document.getElementById("active-workout-wrap");
const activeWorkoutBody = document.getElementById("active-workout-body");
const activeWorkoutDateLabel = document.getElementById("active-workout-date-label");
const finishWorkoutBtn = document.getElementById("finish-workout-btn");
const recentDatesList = document.getElementById("recent-dates-list");
const recentDatesView = document.getElementById("recent-dates-view");
const recentDetailView = document.getElementById("recent-detail-view");
const detailBackBtn = document.getElementById("detail-back-btn");
const detailDateLabel = document.getElementById("detail-date-label");
const detailWorkoutBody = document.getElementById("detail-workout-body");
const detailWorkoutForm = document.getElementById("detail-workout-form");
const detailWorkoutDate = document.getElementById("detail-workout-date");
const detailExerciseName = document.getElementById("detail-exercise-name");
const detailWeight = document.getElementById("detail-weight");
const detailReps = document.getElementById("detail-reps");
const detailSupersetWith = document.getElementById("detail-superset-with");
const detailNotes = document.getElementById("detail-notes");
const detailWorkoutError = document.getElementById("detail-workout-error");
const detailSessionMeta = document.getElementById("detail-session-meta");

const loginTab = $("#login-tab");
const signupTab = $("#signup-tab");
const loginForm = $("#login-form");
const signupForm = $("#signup-form");
const logoutBtn = $("#logout-btn");

let unsubscribeWorkouts = null;
let unsubscribeSession = null;
let currentUser = null;
let editingWorkoutId = null;
let detailEditingId = null;
let currentWorkouts = new Map();
let highlightedSupersetRowId = null;
let activeSessionId = null;
let selectedSessionId = null;
let selectedDateForDetail = null;
let currentSessions = new Map();
let unsubscribeWorkoutSessions = null;

// ----- Auth UI -----

function setAuthError(message) {
  if (!message) {
    authError.textContent = "";
    authError.classList.add("hidden");
    return;
  }
  authError.textContent = message;
  authError.classList.remove("hidden");
}

function setWorkoutError(message) {
  if (!message) {
    workoutError.textContent = "";
    workoutError.classList.add("hidden");
    return;
  }
  workoutError.textContent = message;
  workoutError.classList.remove("hidden");
}

function switchAuthTab(target) {
  if (target === "login-form") {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    loginForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
  } else {
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    signupForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
  }
  setAuthError("");
}

loginTab.addEventListener("click", () => switchAuthTab("login-form"));
signupTab.addEventListener("click", () => switchAuthTab("signup-form"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthError("");

  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    setAuthError(prettyAuthError(error));
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthError("");

  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;

  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    setAuthError(prettyAuthError(error));
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  }
});

function prettyAuthError(error) {
  if (!error || !error.code) return "Something went wrong. Please try again.";

  switch (error.code) {
    case "auth/invalid-email":
      return "The email address is not valid.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "This email is already registered.";
    case "auth/weak-password":
      return "Password is too weak (min 6 characters).";
    default:
      return error.message || "Authentication error. Please try again.";
  }
}

// ----- Auth state handling -----

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (user) {
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    userInfo.classList.remove("hidden");
    userEmailEl.textContent = user.email ?? "";

    subscribeToWorkouts(user.uid);
    subscribeToWorkoutSessions(user.uid);
    subscribeToSession(user.uid);
  } else {
    appSection.classList.add("hidden");
    authSection.classList.remove("hidden");
    userInfo.classList.add("hidden");
    userEmailEl.textContent = "";
    activeSessionId = null;
    selectedSessionId = null;
    selectedDateForDetail = null;
    currentSessions = new Map();

    if (unsubscribeWorkouts) {
      unsubscribeWorkouts();
      unsubscribeWorkouts = null;
    }
    if (unsubscribeWorkoutSessions) {
      unsubscribeWorkoutSessions();
      unsubscribeWorkoutSessions = null;
    }
    if (unsubscribeSession) {
      unsubscribeSession();
      unsubscribeSession = null;
    }
    if (activeWorkoutBody) activeWorkoutBody.innerHTML = "";
    if (recentDatesList) recentDatesList.innerHTML = "";
    if (detailWorkoutBody) detailWorkoutBody.innerHTML = "";
  }
});

// ----- Exercise key normalization (so "Lat Pulldown" / "lat pdown" = same exercise) -----

const EXERCISE_ABBREVIATIONS = {
  pdown: "pulldown",
  pd: "pulldown",
  ld: "pulldown",
  rows: "rows",
  ext: "extension",
  extn: "extension",
  curl: "curl",
  press: "press",
  dec: "deck",
  fly: "fly",
  flye: "fly",
  pull: "pull",
  pul: "pull",
  tri: "triceps",
  bi: "biceps",
  lat: "lat",
  unilat: "unilateral",
  uni: "unilateral",
};

function normalizeExerciseKey(name) {
  if (typeof name !== "string") return "";
  let s = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  const words = s.split(" ");
  const expanded = words.map((w) => EXERCISE_ABBREVIATIONS[w] ?? w);
  return expanded.join(" ").trim();
}

// ----- Workouts -----

function setDefaultDate() {
  if (!workoutDateInput) return;
  const date = activeSessionId ? currentSessions.get(activeSessionId)?.date : null;
  workoutDateInput.value = date || getTodayString();
  refreshSupersetOptions();
}

workoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setWorkoutError("");

  if (!currentUser) {
    setWorkoutError("You must be logged in to add workouts.");
    return;
  }

  const date = workoutDateInput.value;
  const exerciseName = document.getElementById("exercise-name").value.trim();
  const weight = parseFloat(document.getElementById("weight").value);
  const reps = parseInt(document.getElementById("reps").value, 10);
  const supersetWithId = supersetSelect.value || null;
  const notes = document.getElementById("notes").value.trim();

  if (!date || !exerciseName || Number.isNaN(weight) || Number.isNaN(reps)) {
    setWorkoutError("Please fill in date, exercise, weight and reps.");
    return;
  }

  const exerciseKey = normalizeExerciseKey(exerciseName);

  try {
    const payload = {
      userId: currentUser.uid,
      date,
      exerciseName,
      exerciseKey,
      weight,
      reps,
      supersetWithId,
      notes: notes || null,
      ...(activeSessionId ? { sessionId: activeSessionId } : {}),
    };

    if (editingWorkoutId) {
      const ref = doc(db, "workouts", editingWorkoutId);
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      exitEditMode();
    } else {
      const ref = await addDoc(collection(db, "workouts"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      exitEditMode();
      showComparisonAfterAdd(ref.id, exerciseKey, weight, reps);
    }
  } catch (error) {
    console.error(error);
    setWorkoutError("Failed to save workout. Please try again.");
  }
});

workoutCancelEditBtn.addEventListener("click", () => {
  exitEditMode();
});

workoutDateInput.addEventListener("change", () => {
  if (!currentUser) return;
  refreshSupersetOptions();
});

function subscribeToWorkoutSessions(userId) {
  if (unsubscribeWorkoutSessions) {
    unsubscribeWorkoutSessions();
    unsubscribeWorkoutSessions = null;
  }
  const q = query(
    collection(db, "workoutSessions"),
    where("userId", "==", userId),
  );
  unsubscribeWorkoutSessions = onSnapshot(q, (snapshot) => {
    currentSessions = new Map();
    snapshot.forEach((docSnap) => {
      currentSessions.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    });
    renderLogSection();
    renderRecentSection();
    renderStatsSection();
  });
}

function subscribeToSession(userId) {
  if (unsubscribeSession) {
    unsubscribeSession();
    unsubscribeSession = null;
  }
  const sessionRef = doc(db, "sessions", userId);
  unsubscribeSession = onSnapshot(
    sessionRef,
    (snap) => {
      activeSessionId = snap.exists() ? snap.data().activeSessionId ?? null : null;
      renderLogSection();
      if (activeSessionId && workoutDateInput) {
        const sess = currentSessions.get(activeSessionId);
        if (sess?.date) workoutDateInput.value = sess.date;
        refreshSupersetOptions();
      }
    },
    () => {
      activeSessionId = null;
      renderLogSection();
    },
  );
}

document.getElementById("start-workout-btn")?.addEventListener("click", async () => {
  if (!currentUser) return;
  const today = getTodayString();
  setWorkoutError("");
  try {
    const ref = await addDoc(collection(db, "workoutSessions"), {
      userId: currentUser.uid,
      date: today,
      startedAt: serverTimestamp(),
      endedAt: null,
      durationMinutes: null,
    });
    await setDoc(doc(db, "sessions", currentUser.uid), {
      activeSessionId: ref.id,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e);
    setWorkoutError("Failed to start workout.");
  }
});

finishWorkoutBtn?.addEventListener("click", async () => {
  if (!currentUser || !activeSessionId) return;
  setWorkoutError("");
  const sessionRef = doc(db, "workoutSessions", activeSessionId);
  try {
    const snap = await getDoc(sessionRef);
    const startedAt = snap.exists() ? snap.data().startedAt?.toDate?.() : null;
    const endTime = new Date();
    const durationMinutes = startedAt
      ? Math.max(0, Math.round((endTime.getTime() - startedAt.getTime()) / 60000))
      : 0;
    await updateDoc(sessionRef, {
      endedAt: Timestamp.fromDate(endTime),
      durationMinutes,
    });
    await setDoc(doc(db, "sessions", currentUser.uid), {
      activeSessionId: null,
      updatedAt: serverTimestamp(),
    });
    exitEditMode();
  } catch (e) {
    console.error(e);
    setWorkoutError("Failed to finish workout.");
  }
});

function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

detailBackBtn?.addEventListener("click", () => {
  selectedSessionId = null;
  selectedDateForDetail = null;
  detailEditingId = null;
  renderRecentSection();
});

detailWorkoutForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const date = selectedSessionId
    ? currentSessions.get(selectedSessionId)?.date
    : selectedDateForDetail;
  if (!date) return;
  if (detailWorkoutError) {
    detailWorkoutError.textContent = "";
    detailWorkoutError.classList.add("hidden");
  }
  const exerciseName = detailExerciseName?.value?.trim() ?? "";
  const weight = parseFloat(detailWeight?.value);
  const reps = parseInt(detailReps?.value, 10);
  const supersetWithId = detailSupersetWith?.value || null;
  const notes = detailNotes?.value?.trim() || null;
  if (!exerciseName || Number.isNaN(weight) || Number.isNaN(reps)) return;
  const exerciseKey = normalizeExerciseKey(exerciseName);
  const payload = {
    userId: currentUser.uid,
    date,
    exerciseName,
    exerciseKey,
    weight,
    reps,
    supersetWithId,
    notes,
    ...(selectedSessionId ? { sessionId: selectedSessionId } : {}),
  };
  try {
    if (detailEditingId) {
      await updateDoc(doc(db, "workouts", detailEditingId), { ...payload, updatedAt: serverTimestamp() });
      detailEditingId = null;
      detailWorkoutForm.reset();
      const detailAddSetBtn = document.getElementById("detail-add-set-btn");
      if (detailAddSetBtn) detailAddSetBtn.textContent = "Add set";
    } else {
      await addDoc(collection(db, "workouts"), { ...payload, createdAt: serverTimestamp() });
      detailWorkoutForm.reset();
    }
    refreshDetailSupersetOptions();
    renderDetailBody();
  } catch (err) {
    console.error(err);
    if (detailWorkoutError) {
      detailWorkoutError.textContent = "Failed to save.";
      detailWorkoutError.classList.remove("hidden");
    }
  }
});

function subscribeToWorkouts(userId) {
  if (unsubscribeWorkouts) {
    unsubscribeWorkouts();
    unsubscribeWorkouts = null;
  }

  const q = query(
    collection(db, "workouts"),
    where("userId", "==", userId),
  );

  unsubscribeWorkouts = onSnapshot(
    q,
    (snapshot) => {
      currentWorkouts = new Map();
      snapshot.forEach((docSnap) => {
        currentWorkouts.set(docSnap.id, docSnap.data());
      });
      renderLogSection();
      renderRecentSection();
      renderStatsSection();
      highlightedSupersetRowId = null;
    },
    (error) => {
      console.error(error);
      setWorkoutError("Failed to load workouts.");
    },
  );
}

function renderLogSection() {
  if (!startWorkoutWrap || !activeWorkoutWrap) return;
  const session = activeSessionId ? currentSessions.get(activeSessionId) : null;
  if (activeSessionId && session) {
    startWorkoutWrap.classList.add("hidden");
    activeWorkoutWrap.classList.remove("hidden");
    const date = session.date;
    if (workoutDateInput) workoutDateInput.value = date;
    if (activeWorkoutDateLabel) activeWorkoutDateLabel.textContent = "Workout: " + formatDateLabel(date);
    renderActiveBody();
    refreshSupersetOptions();
  } else {
    startWorkoutWrap.classList.remove("hidden");
    activeWorkoutWrap.classList.add("hidden");
  }
}

function renderActiveBody() {
  if (!activeWorkoutBody || !activeSessionId) return;
  const sets = getSetsForSession(activeSessionId);
  activeWorkoutBody.innerHTML = sets.map(({ id, data }) => renderWorkoutRow(id, data)).join("");
}

function getSetsForSession(sessionId) {
  const list = [];
  currentWorkouts.forEach((data, id) => {
    if (data.sessionId === sessionId) list.push({ id, data });
  });
  list.sort((a, b) => {
    const tA = a.data.createdAt?.toMillis?.() ?? 0;
    const tB = b.data.createdAt?.toMillis?.() ?? 0;
    return tA - tB;
  });
  return list;
}

function getSetsForLegacyDate(date) {
  const list = [];
  currentWorkouts.forEach((data, id) => {
    if (data.date === date && !data.sessionId) list.push({ id, data });
  });
  list.sort((a, b) => {
    const tA = a.data.createdAt?.toMillis?.() ?? 0;
    const tB = b.data.createdAt?.toMillis?.() ?? 0;
    return tA - tB;
  });
  return list;
}

function renderRecentSection() {
  if (!recentDatesView || !recentDetailView) return;
  if (selectedSessionId || selectedDateForDetail) {
    recentDatesView.classList.add("hidden");
    recentDetailView.classList.remove("hidden");
    const dateLabel = selectedSessionId
      ? currentSessions.get(selectedSessionId)?.date
      : selectedDateForDetail;
    if (detailDateLabel) detailDateLabel.textContent = "Workout: " + formatDateLabel(dateLabel || "");
    if (detailWorkoutDate) detailWorkoutDate.value = dateLabel || "";
    if (detailSessionMeta) {
      if (selectedSessionId) {
        const s = currentSessions.get(selectedSessionId);
        const endLabel = s?.endedAt?.toDate?.()
          ? formatTime(s.endedAt.toDate())
          : "";
        const dur = s?.durationMinutes != null ? `${s.durationMinutes} min` : "";
        detailSessionMeta.textContent = [endLabel, dur].filter(Boolean).join(" · ") || "—";
      } else {
        detailSessionMeta.textContent = "Legacy (no time/duration)";
      }
    }
    const detailAddSetBtn = document.getElementById("detail-add-set-btn");
    if (detailAddSetBtn) detailAddSetBtn.textContent = "Add set";
    renderDetailBody();
    refreshDetailSupersetOptions();
  } else {
    recentDatesView.classList.remove("hidden");
    recentDetailView.classList.add("hidden");
    renderRecentSessionsList();
  }
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderStatsSection() {
  const overviewEl = document.getElementById("stats-overview");
  const activityEl = document.getElementById("stats-activity");
  const exercisesEl = document.getElementById("stats-exercises");
  const volumeEl = document.getElementById("stats-volume");
  if (!overviewEl || !activityEl || !exercisesEl || !volumeEl) return;

  const now = new Date();
  const today = getTodayString();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const toDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const sevenDaysAgoStr = toDateStr(sevenDaysAgo);
  const thirtyDaysAgoStr = toDateStr(thirtyDaysAgo);

  const finishedSessions = [...currentSessions.values()].filter((s) => s.endedAt != null);
  const legacyDates = new Set(
    [...currentWorkouts.values()].filter((d) => d.date && !d.sessionId).map((d) => d.date),
  );
  const totalSessions = finishedSessions.length + legacyDates.size;
  const totalSets = currentWorkouts.size;
  let totalVolume = 0;
  const exerciseCounts = new Map();
  const exerciseVolume = new Map();
  currentWorkouts.forEach((data) => {
    const w = data.weight != null ? Number(data.weight) : 0;
    const r = data.reps != null ? Number(data.reps) : 0;
    totalVolume += w * r;
    const key = data.exerciseKey || data.exerciseName || "—";
    const name = data.exerciseName || "—";
    exerciseCounts.set(key, (exerciseCounts.get(key) || 0) + 1);
    const vol = (exerciseVolume.get(key) || { name, volume: 0 });
    vol.volume += w * r;
    vol.name = name;
    exerciseVolume.set(key, vol);
  });

  const sessionsThisWeek = finishedSessions.filter((s) => s.date >= sevenDaysAgoStr).length;
  const sessionsThisMonth = finishedSessions.filter((s) => s.date >= thirtyDaysAgoStr).length;
  const legacyThisWeek = [...legacyDates].filter((d) => d >= sevenDaysAgoStr).length;
  const legacyThisMonth = [...legacyDates].filter((d) => d >= thirtyDaysAgoStr).length;

  overviewEl.innerHTML = `
    <div class="stats-card"><div class="value">${totalSessions}</div><div class="label">Total workouts</div></div>
    <div class="stats-card"><div class="value">${totalSets}</div><div class="label">Total sets</div></div>
    <div class="stats-card"><div class="value">${totalVolume.toLocaleString()}</div><div class="label">Total volume (kg×reps)</div></div>
  `;

  activityEl.innerHTML = `
    <p class="muted">Last 7 days: ${sessionsThisWeek + legacyThisWeek} workout(s) · Last 30 days: ${sessionsThisMonth + legacyThisMonth} workout(s)</p>
  `;

  const topExercises = [...exerciseCounts.entries()]
    .map(([key, count]) => ({ count, name: exerciseVolume.get(key)?.name || key }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  exercisesEl.innerHTML = `
    <ul>${topExercises.map((e) => `<li><span>${escapeHtml(e.name)}</span><strong>${e.count}</strong></li>`).join("")}</ul>
  `;

  const topVolume = [...exerciseVolume.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 15);
  volumeEl.innerHTML = `
    <ul>${topVolume.map((v) => `<li><span>${escapeHtml(v.name)}</span><strong>${v.volume.toLocaleString()}</strong></li>`).join("")}</ul>
  `;
}

function renderRecentSessionsList() {
  if (!recentDatesList) return;
  const items = [];
  const endedSessions = [...currentSessions.values()]
    .filter((s) => s.endedAt != null)
    .sort((a, b) => {
      const tA = a.endedAt?.toMillis?.() ?? 0;
      const tB = b.endedAt?.toMillis?.() ?? 0;
      return tB - tA;
    });
  endedSessions.forEach((s) => {
    const endStr = s.endedAt?.toDate?.() ? formatTime(s.endedAt.toDate()) : "";
    const durStr = s.durationMinutes != null ? `${s.durationMinutes} min` : "";
    const label = [formatDateLabel(s.date), endStr, durStr].filter(Boolean).join(" — ");
    items.push(`<li><button type="button" data-view-session="${escapeHtml(s.id)}">${escapeHtml(label)}</button></li>`);
  });
  const legacyDates = [...new Set(
    [...currentWorkouts.values()].filter((d) => d.date && !d.sessionId).map((d) => d.date),
  )].sort((a, b) => (a < b ? 1 : -1));
  legacyDates.forEach((d) => {
    items.push(`<li><button type="button" data-view-date="${escapeHtml(d)}">${escapeHtml(formatDateLabel(d))} (legacy)</button></li>`);
  });
  recentDatesList.innerHTML = items.join("");
}

function renderDetailBody() {
  if (!detailWorkoutBody) return;
  const sets = selectedSessionId
    ? getSetsForSession(selectedSessionId)
    : selectedDateForDetail
      ? getSetsForLegacyDate(selectedDateForDetail)
      : [];
  detailWorkoutBody.innerHTML = sets.map(({ id, data }) => renderWorkoutRow(id, data)).join("");
}

function refreshDetailSupersetOptions() {
  if (!detailSupersetWith) return;
  const options = ['<option value="">No superset</option>'];
  const sets = selectedSessionId
    ? getSetsForSession(selectedSessionId)
    : selectedDateForDetail
      ? getSetsForLegacyDate(selectedDateForDetail)
      : [];
  sets.forEach(({ id, data }) => {
    if (id === detailEditingId) return;
    const name = data.exerciseName || "Exercise";
    const w = data.weight != null && data.reps != null ? ` (${data.weight} kg x ${data.reps})` : "";
    options.push(`<option value="${id}">${escapeHtml(name + w)}</option>`);
  });
  detailSupersetWith.innerHTML = options.join("");
  if (detailEditingId && currentWorkouts.has(detailEditingId)) {
    const data = currentWorkouts.get(detailEditingId);
    detailSupersetWith.value = data.supersetWithId ?? "";
  }
}

function renderSessionHeaderRow(date) {
  const label = date ? formatDateLabel(date) : "Unknown date";
  return `
    <tr class="session-header-row">
      <th colspan="6">${escapeHtml(label)}</th>
    </tr>
  `;
}

function renderWorkoutRow(id, data) {
  const exercise = data.exerciseName ?? "";
  const weight = data.weight != null ? `${data.weight} kg` : "";
  const reps = data.reps != null ? `${data.reps}` : "";
  const partnerId = data.supersetWithId ?? "";
  const supersetLabel = getSupersetLabel(partnerId, data);
  const notes = data.notes ?? "";

  return `
    <tr data-id="${id}">
      <td>${escapeHtml(exercise)}</td>
      <td>${escapeHtml(weight)}</td>
      <td>${escapeHtml(reps)}</td>
      <td class="superset-cell" data-superset-target="${partnerId}">
        ${escapeHtml(supersetLabel)}
      </td>
      <td>${escapeHtml(notes)}</td>
      <td class="workout-actions">
        <button type="button" data-edit-id="${id}">Edit</button>
      </td>
    </tr>
  `;
}

recentDatesList?.addEventListener("click", (event) => {
  const sessionBtn = event.target.closest("[data-view-session]");
  const dateBtn = event.target.closest("[data-view-date]");
  if (sessionBtn) {
    selectedSessionId = sessionBtn.getAttribute("data-view-session");
    selectedDateForDetail = currentSessions.get(selectedSessionId)?.date ?? null;
  } else if (dateBtn) {
    selectedSessionId = null;
    selectedDateForDetail = dateBtn.getAttribute("data-view-date");
  } else return;
  renderRecentSection();
});

appSection?.addEventListener("click", (event) => {
  const supersetCell = event.target.closest("[data-superset-target]");
  if (supersetCell) {
    const targetId = supersetCell.getAttribute("data-superset-target");
    highlightSupersetRow(targetId);
    return;
  }

  const editBtn = event.target.closest("[data-edit-id]");
  if (!editBtn) return;
  const id = editBtn.getAttribute("data-edit-id");
  const data = currentWorkouts.get(id);
  if (!data) return;
  const tbody = editBtn.closest("tbody");
  if (tbody?.id === "detail-workout-body") {
    enterDetailEditMode(id, data);
  } else {
    enterEditMode(id, data);
  }
});

function formatDateLabel(dateStr) {
  // Expecting YYYY-MM-DD; fall back to raw string if parsing fails.
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return dateStr;

  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return formatter.format(date);
}

function enterEditMode(id, data) {
  detailEditingId = null;
  editingWorkoutId = id;
  workoutDateInput.value = data.date ?? "";
  document.getElementById("exercise-name").value = data.exerciseName ?? "";
  document.getElementById("weight").value =
    data.weight != null ? data.weight : "";
  document.getElementById("reps").value =
    data.reps != null ? data.reps : "";
  document.getElementById("notes").value = data.notes ?? "";

  refreshSupersetOptions(data.supersetWithId ?? null);

  workoutSubmitBtn.textContent = "Update set";
  workoutCancelEditBtn.classList.remove("hidden");
  editIndicator.classList.remove("hidden");
}

function enterDetailEditMode(id, data) {
  editingWorkoutId = null;
  exitEditMode();
  detailEditingId = id;
  if (detailExerciseName) detailExerciseName.value = data.exerciseName ?? "";
  if (detailWeight) detailWeight.value = data.weight != null ? data.weight : "";
  if (detailReps) detailReps.value = data.reps != null ? data.reps : "";
  if (detailNotes) detailNotes.value = data.notes ?? "";
  refreshDetailSupersetOptions();
  if (detailSupersetWith) detailSupersetWith.value = data.supersetWithId ?? "";
  const detailBtn = document.getElementById("detail-add-set-btn");
  if (detailBtn) detailBtn.textContent = "Update set";
}

function exitEditMode() {
  editingWorkoutId = null;
  workoutForm.reset();
  setDefaultDate();
  workoutSubmitBtn.textContent = "Add set";
  workoutCancelEditBtn.classList.add("hidden");
  editIndicator.classList.add("hidden");
}

async function showComparisonAfterAdd(newDocId, exerciseKey, weight, reps) {
  if (!comparisonMessageEl || !currentUser) return;

  setComparisonMessage("");

  const workoutsRef = collection(db, "workouts");
  const q = query(
    workoutsRef,
    where("userId", "==", currentUser.uid),
    where("exerciseKey", "==", exerciseKey),
    orderBy("createdAt", "desc"),
    limit(2),
  );

  try {
    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    if (docs.length < 2) {
      setComparisonMessage("First time logging this exercise.", true);
      return;
    }

    const first = docs[0];
    const second = docs[1];
    const isNewFirst = first.id === newDocId;
    const previous = isNewFirst ? second : first;
    const prevData = previous.data();
    const prevWeight = prevData.weight;
    const prevReps = prevData.reps;
    const prevDate = prevData.date;

    const weightUp = prevWeight != null && weight > prevWeight;
    const weightSame =
      prevWeight != null && weight === prevWeight;
    const repsUp = prevReps != null && reps > prevReps;
    const repsSame = prevReps != null && reps === prevReps;

    const prevLabel =
      prevDate && prevWeight != null && prevReps != null
        ? `${prevWeight} kg × ${prevReps} (${formatDateLabel(prevDate)})`
        : prevWeight != null && prevReps != null
          ? `${prevWeight} kg × ${prevReps}`
          : "last time";

    let msg = `Last time: ${prevLabel}. This set: ${weight} kg × ${reps}. `;
    if (weightUp && repsUp) msg += "More weight and more reps.";
    else if (weightUp) msg += "More weight.";
    else if (repsUp) msg += "More reps.";
    else if (weightSame && repsSame) msg += "Same as last time.";
    else if (weightUp === false && repsUp === false && (weight !== prevWeight || reps !== prevReps)) msg += "Different set.";
    else msg += "Nice.";

    setComparisonMessage(msg, true);
  } catch (err) {
    if (err.code === "failed-precondition") {
      // Index may still be building; comparison will work once it's ready.
    }
  }
}

function setComparisonMessage(text, clearAfter5s = false, indexUrl = null) {
  if (!comparisonMessageEl) return;
  if (!text && !indexUrl) {
    comparisonMessageEl.innerHTML = "";
    comparisonMessageEl.classList.add("hidden");
    return;
  }
  if (indexUrl) {
    comparisonMessageEl.innerHTML =
      escapeHtml(text) +
      ' <a href="' +
      escapeHtml(indexUrl) +
      '" target="_blank" rel="noopener">Create index</a>';
  } else {
    comparisonMessageEl.textContent = text;
  }
  comparisonMessageEl.classList.remove("hidden");
  if (clearAfter5s) {
    setTimeout(() => setComparisonMessage(""), 5000);
  }
}

function refreshSupersetOptions(selectedId = null) {
  if (!supersetSelect) return;
  const currentSelected =
    selectedId !== null ? selectedId : supersetSelect.value || "";
  const options = ['<option value="">No superset</option>'];
  const sessionSets = activeSessionId
    ? getSetsForSession(activeSessionId)
    : [];
  sessionSets.forEach(({ id, data }) => {
    if (id === editingWorkoutId) return;
    const name = data.exerciseName || "Exercise";
    const w =
      data.weight != null && data.reps != null
        ? ` (${data.weight} kg x ${data.reps})`
        : "";
    options.push(`<option value="${id}">${escapeHtml(name + w)}</option>`);
  });
  supersetSelect.innerHTML = options.join("");
  if (currentSelected) supersetSelect.value = currentSelected;
}

function getSupersetLabel(partnerId, data) {
  // Prefer the linked set, fall back to any legacy `superset` label.
  if (partnerId && currentWorkouts.has(partnerId)) {
    const partner = currentWorkouts.get(partnerId);
    return partner.exerciseName || "Superset";
  }
  return data.superset ?? "";
}

function highlightSupersetRow(targetId) {
  if (!targetId) return;

  if (highlightedSupersetRowId) {
    const prev = document.querySelector(
      `tr[data-id="${highlightedSupersetRowId}"]`,
    );
    if (prev) prev.classList.remove("superset-highlight");
  }

  const row = document.querySelector(`tr[data-id="${targetId}"]`);
  if (!row) return;

  row.classList.add("superset-highlight");
  highlightedSupersetRowId = targetId;

  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

