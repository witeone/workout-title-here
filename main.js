import { firebaseConfig } from "./firebase-config.js";
import { KNOWN_EXERCISES } from "./exercises-data.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
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
  deleteDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

if (!firebaseConfig || firebaseConfig.apiKey === "REPLACE_ME") {
  console.warn("[Workout] firebaseConfig not configured. Copy firebase-config.example.js to firebase-config.js.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (s) => document.querySelector(s);
const authSection = $("#auth-section");
const appSection = $("#app-section");
const appNav = $("#app-nav");
const headerLoggedIn = $("#header-logged-in");
const authError = $("#auth-error");
const userInfo = $(".user-info");
const userEmailEl = $("#user-email");

let currentUser = null;
let editingWorkoutId = null;
let detailEditingId = null;
let currentWorkouts = new Map();
let currentSessions = new Map();
let activeSessionId = null;
let selectedSessionId = null;
let selectedDateForDetail = null;
let unsubscribeWorkouts = null;
let unsubscribeWorkoutSessions = null;
let unsubscribeSession = null;
let currentCompetitions = new Map();
let myParticipations = new Map();
let selectedCompetitionId = null;
let lastAddedSet = null;
let unsubscribeCompetitions = null;
let unsubscribeParticipations = null;
let userExercises = [];
let unsubscribeUserExercises = null;

// ----- Auth UI -----
function setAuthError(msg) {
  if (!authError) return;
  authError.textContent = msg || "";
  authError.classList.toggle("hidden", !msg);
}

const loginTab = $("#login-tab");
const signupTab = $("#signup-tab");
const loginForm = $("#login-form");
const signupForm = $("#signup-form");
const logoutBtn = $("#logout-btn");

function switchAuthTab(target) {
  if (target === "login-form") {
    loginTab?.classList.add("active");
    signupTab?.classList.remove("active");
    loginForm?.classList.remove("hidden");
    signupForm?.classList.add("hidden");
  } else {
    signupTab?.classList.add("active");
    loginTab?.classList.remove("active");
    signupForm?.classList.remove("hidden");
    loginForm?.classList.add("hidden");
  }
  setAuthError("");
}

loginTab?.addEventListener("click", () => switchAuthTab("login-form"));
signupTab?.addEventListener("click", () => switchAuthTab("signup-form"));

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAuthError("");
  const email = $("#login-email")?.value;
  const password = $("#login-password")?.value;
  if (!email || !password) return;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    setAuthError(err.code === "auth/invalid-credential" ? "Incorrect email or password." : err.message);
  }
});

signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAuthError("");
  const email = $("#signup-email")?.value;
  const password = $("#signup-password")?.value;
  if (!email || !password) return;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    if (err.code === "auth/email-already-in-use") setAuthError("This email is already registered.");
    else if (err.code === "auth/weak-password") setAuthError("Password must be at least 6 characters.");
    else setAuthError(err.message);
  }
});

logoutBtn?.addEventListener("click", () => signOut(auth));

// ----- SPA routing -----
function getCurrentPath() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  return p || "/log";
}

function navigate(path) {
  path = path || "/log";
  if (path === "/") path = "/log";
  if (path !== getCurrentPath()) window.history.pushState({ path }, "", path);
  if (path === "/exercises") renderExercisesSection();
  if (path === "/competition") populateExerciseSelects([...currentWorkouts.values()].map((d) => d.exerciseName).filter(Boolean));
  appSection?.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("hidden", el.getAttribute("data-route") !== path);
  });
  appNav?.querySelectorAll("[data-route]").forEach((a) => {
    a.setAttribute("aria-current", a.getAttribute("data-route") === path ? "page" : null);
  });
}

function initRouter() {
  window.addEventListener("popstate", (e) => navigate(e.state?.path ?? getCurrentPath()));
  document.querySelectorAll("a[data-route]").forEach((a) => {
    a.addEventListener("click", (e) => { e.preventDefault(); navigate(a.getAttribute("data-route")); });
  });
  if (appSection && !appSection.classList.contains("hidden")) navigate(getCurrentPath());
}

// ----- Auth state -----
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    headerLoggedIn?.classList.remove("hidden");
    userEmailEl.textContent = user.email ?? "";
    navigate(getCurrentPath());
    subscribeToWorkouts(user.uid);
    subscribeToWorkoutSessions(user.uid);
    subscribeToSession(user.uid);
    subscribeToCompetitions();
    subscribeToParticipations(user.uid);
    subscribeToUserExercises(user.uid);
    loadProfile(user.uid);
    $("#profile-email").value = user.email ?? "";
    populateExerciseSelects();
    renderExercisesSection();
  } else {
    appSection.classList.add("hidden");
    headerLoggedIn?.classList.add("hidden");
    authSection.classList.remove("hidden");
    userEmailEl.textContent = "";
    activeSessionId = null;
    selectedSessionId = null;
    selectedDateForDetail = null;
    currentSessions = new Map();
    currentCompetitions = new Map();
    myParticipations = new Map();
    selectedCompetitionId = null;
    userExercises = [];
    [unsubscribeWorkouts, unsubscribeWorkoutSessions, unsubscribeSession, unsubscribeCompetitions, unsubscribeParticipations, unsubscribeUserExercises].forEach((un) => un?.());
    document.getElementById("active-workout-body") && (document.getElementById("active-workout-body").innerHTML = "");
    document.getElementById("recent-dates-list") && (document.getElementById("recent-dates-list").innerHTML = "");
    document.getElementById("detail-workout-body") && (document.getElementById("detail-workout-body").innerHTML = "");
  }
});

// ----- Exercises -----
function getAllExercises() {
  return [...KNOWN_EXERCISES, ...userExercises];
}

function populateExerciseSelects(extraNames = []) {
  const names = [...new Set([...getAllExercises().map((e) => e.name), ...extraNames])].sort();
  const opts = (el) => {
    if (!el) return;
    const current = el.value;
    el.innerHTML = '<option value="">Select exercise</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(current)) el.value = current;
  };
  opts($("#exercise-name"));
  opts($("#detail-exercise-name"));
  const comp = $("#comp-exercise-name");
  if (comp) {
    const cur = comp.value;
    comp.innerHTML = '<option value="">Select exercise</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(cur)) comp.value = cur;
  }
}

function subscribeToUserExercises(userId) {
  unsubscribeUserExercises?.();
  const q = query(collection(db, "exercises"), where("userId", "==", userId));
  unsubscribeUserExercises = onSnapshot(q, (snap) => {
    userExercises = snap.docs.map((d) => ({ id: d.id, ...d.data(), isCustom: true }));
    populateExerciseSelects([...currentWorkouts.values()].map((d) => d.exerciseName).filter(Boolean));
    renderExercisesSection();
  });
}

function renderExercisesSection() {
  const list = $("#exercises-list");
  if (!list) return;
  const exercises = getAllExercises();
  const byCategory = {};
  exercises.forEach((e) => {
    const cat = e.category || "Other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(e);
  });
  list.innerHTML = Object.entries(byCategory)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, exs]) => `
      <section class="exercise-category">
        <h3>${escapeHtml(cat)}</h3>
        <div class="exercise-grid">
          ${exs
            .map(
              (e) => `
            <article class="exercise-card" data-exercise="${escapeHtml(e.name)}" tabindex="0">
              <div class="exercise-card-preview">
                <img src="${e.imageUrl || ""}" alt="${escapeHtml(e.name)}" class="exercise-thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                <div class="exercise-thumb-placeholder" style="display:none;">No image</div>
                <h4>${escapeHtml(e.name)}</h4>
                <span class="exercise-click-hint">Click for form</span>
              </div>
              <div class="exercise-card-detail hidden">
                <button type="button" class="exercise-back-btn secondary outline">← Back</button>
                <p class="exercise-desc">${escapeHtml(e.description)}</p>
                <div class="exercise-form">
                  <strong>Correct form:</strong>
                  <p>${escapeHtml(e.form)}</p>
                </div>
                ${(e.formImages && e.formImages.length ? `<div class="exercise-form-images">${e.formImages.map((url) => `<img src="${url}" alt="Form" class="exercise-form-img" />`).join("")}</div>` : "")}
              </div>
            </article>
          `
            )
            .join("")}
        </div>
      </section>
    `)
    .join("");

  list.querySelectorAll(".exercise-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".exercise-back-btn")) return;
      const detail = card.querySelector(".exercise-card-detail");
      detail?.classList.toggle("hidden");
      card.classList.toggle("exercise-card-expanded", !detail?.classList.contains("hidden"));
    });
    card.querySelectorAll(".exercise-back-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const detail = card.querySelector(".exercise-card-detail");
        detail?.classList.add("hidden");
        card.classList.remove("exercise-card-expanded");
      });
    });
  });
}

$("#add-exercise-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const name = $("#new-exercise-name")?.value?.trim();
  if (!name) return;
  const category = $("#new-exercise-category")?.value || "Other";
  const description = $("#new-exercise-desc")?.value?.trim() || "";
  const form = $("#new-exercise-form")?.value?.trim() || "";
  const imageUrl = $("#new-exercise-image")?.value?.trim() || null;
  try {
    await addDoc(collection(db, "exercises"), {
      userId: currentUser.uid,
      name,
      category,
      description,
      form,
      imageUrl,
      formImages: imageUrl ? [imageUrl] : [],
      createdAt: serverTimestamp(),
    });
    $("#add-exercise-form").reset();
  } catch (err) {
    console.error(err);
  }
});

// ----- Exercise key -----
const EXERCISE_ABBREVIATIONS = { pdown: "pulldown", pd: "pulldown", ld: "pulldown", rows: "rows", ext: "extension", press: "press", curl: "curl", tri: "triceps", bi: "biceps", lat: "lat" };

function normalizeExerciseKey(name) {
  if (typeof name !== "string") return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ").split(" ").map((w) => EXERCISE_ABBREVIATIONS[w] ?? w).join(" ").trim();
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ----- Workouts -----
const workoutForm = $("#workout-form");
const workoutDateInput = $("#workout-date");
const supersetSelect = $("#superset-with");

function setWorkoutError(msg) {
  const el = $("#workout-error");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

function setComparisonMessage(msg) {
  const el = $("#comparison-message");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

function getRepsRecommendation(weight, reps) {
  if (reps > 12) return `Consider increasing weight next set – you hit ${reps} reps.`;
  if (reps < 6) return `Consider decreasing weight next set – you only did ${reps} reps.`;
  return "";
}

function exitEditMode() {
  editingWorkoutId = null;
  workoutCancelEditBtn?.classList.add("hidden");
  editIndicator?.classList.add("hidden");
  workoutSubmitBtn.textContent = "Add set";
  setComparisonMessage("");
}

const workoutCancelEditBtn = $("#workout-cancel-edit-btn");
const workoutSubmitBtn = document.getElementById("workout-submit-btn");
const editIndicator = $("#edit-indicator");

workoutForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setWorkoutError("");
  setComparisonMessage("");
  if (!currentUser) return;
  const date = workoutDateInput?.value;
  const exerciseName = $("#exercise-name")?.value?.trim();
  const weight = parseFloat($("#weight")?.value);
  const reps = parseInt($("#reps")?.value, 10);
  const supersetWithId = supersetSelect?.value || null;
  const notes = $("#notes")?.value?.trim();
  if (!date || !exerciseName || Number.isNaN(weight) || Number.isNaN(reps)) {
    setWorkoutError("Please fill in date, exercise, weight and reps.");
    return;
  }
  const exerciseKey = normalizeExerciseKey(exerciseName);
    const payload = { userId: currentUser.uid, date, exerciseName: exerciseName.trim(), exerciseKey: normalizeExerciseKey(exerciseName), weight, reps, supersetWithId, notes: notes || null };
  try {
    if (editingWorkoutId) {
      await updateDoc(doc(db, "workouts", editingWorkoutId), { ...payload, updatedAt: serverTimestamp() });
      exitEditMode();
    } else {
      const isFirstSet = activeSessionId && getSetsForSession(activeSessionId).length === 0;
      await addDoc(collection(db, "workouts"), { ...payload, sessionId: activeSessionId || null, createdAt: serverTimestamp() });
      if (isFirstSet) {
        await updateDoc(doc(db, "workoutSessions", activeSessionId), { startedAt: serverTimestamp() });
      }
      exitEditMode();
      lastAddedSet = { exerciseKey, weight, reps };
      offerCompetitionSubmit(exerciseKey, weight, reps);
      const rec = getRepsRecommendation(weight, reps);
      if (rec) setComparisonMessage(rec);
    }
  } catch (err) {
    console.error(err);
    setWorkoutError("Failed to save.");
  }
});

workoutCancelEditBtn?.addEventListener("click", exitEditMode);

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function subscribeToWorkouts(userId) {
  unsubscribeWorkouts?.();
  const q = query(collection(db, "workouts"), where("userId", "==", userId));
  unsubscribeWorkouts = onSnapshot(q, (snap) => {
    currentWorkouts = new Map();
    snap.forEach((d) => currentWorkouts.set(d.id, { ...d.data() }));
    const legacyNames = [...new Set([...currentWorkouts.values()].map((d) => d.exerciseName).filter(Boolean))];
    populateExerciseSelects(legacyNames);
    renderLogSection();
    renderRecentSection();
    renderStatsSection();
  });
}

function subscribeToWorkoutSessions(userId) {
  unsubscribeWorkoutSessions?.();
  const q = query(collection(db, "workoutSessions"), where("userId", "==", userId));
  unsubscribeWorkoutSessions = onSnapshot(q, (snap) => {
    currentSessions = new Map();
    snap.forEach((d) => currentSessions.set(d.id, { id: d.id, ...d.data() }));
    renderLogSection();
    renderRecentSection();
    renderStatsSection();
  });
}

function subscribeToSession(userId) {
  unsubscribeSession?.();
  const ref = doc(db, "sessions", userId);
  unsubscribeSession = onSnapshot(ref, (snap) => {
    activeSessionId = snap.exists() ? snap.data().activeSessionId ?? null : null;
    renderLogSection();
  });
}

const startWorkoutWrap = $("#start-workout-wrap");
const activeWorkoutWrap = $("#active-workout-wrap");
const activeWorkoutBody = $("#active-workout-body");

function getSetsForSession(sid) {
  return [...currentWorkouts.entries()].filter(([, d]) => d.sessionId === sid).map(([id, d]) => ({ id, data: d })).sort((a, b) => (a.data.createdAt?.toMillis?.() ?? 0) - (b.data.createdAt?.toMillis?.() ?? 0));
}

function getSetsForLegacyDate(date) {
  return [...currentWorkouts.entries()].filter(([, d]) => d.date === date && !d.sessionId).map(([id, d]) => ({ id, data: d })).sort((a, b) => (a.data.createdAt?.toMillis?.() ?? 0) - (b.data.createdAt?.toMillis?.() ?? 0));
}

function groupSetsByExercise(sets) {
  const groups = new Map();
  for (const s of sets) {
    const key = s.data.exerciseKey || s.data.exerciseName || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return groups;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function getPreviousSet(exerciseKey, currentCreatedAt, excludeId) {
  const currentMs = currentCreatedAt?.toMillis?.() ?? 0;
  const candidates = [...currentWorkouts.entries()]
    .filter(([wid, d]) => wid !== excludeId && (d.exerciseKey || normalizeExerciseKey(d.exerciseName || "")) === exerciseKey)
    .filter(([, d]) => (d.createdAt?.toMillis?.() ?? 0) < currentMs)
    .sort((a, b) => (b[1].createdAt?.toMillis?.() ?? 0) - (a[1].createdAt?.toMillis?.() ?? 0));
  return candidates[0] ? candidates[0][1] : null;
}

function renderDeltaIcon(current, prev, type) {
  if (prev == null || current == null) return "";
  const curr = typeof current === "number" ? current : parseFloat(current);
  const p = typeof prev === "number" ? prev : parseFloat(prev);
  if (Number.isNaN(curr) || Number.isNaN(p)) return "";
  if (curr > p) return `<span class="delta delta-up" title="${type} up from ${p}">↑</span>`;
  if (curr < p) return `<span class="delta delta-down" title="${type} down from ${p}">↓</span>`;
  return "";
}

function renderWorkoutRow(id, data, onEdit, onDelete, hideExerciseName, setNumber) {
  const supersetLabel = data.supersetWithId && currentWorkouts.has(data.supersetWithId) ? currentWorkouts.get(data.supersetWithId).exerciseName : (data.superset ?? "");
  const exerciseKey = data.exerciseKey || normalizeExerciseKey(data.exerciseName || "");
  const prev = getPreviousSet(exerciseKey, data.createdAt, id);
  const weightIcon = renderDeltaIcon(data.weight, prev?.weight, "Weight");
  const repsIcon = renderDeltaIcon(data.reps, prev?.reps, "Reps");
  const setCell = setNumber != null ? `<td class="set-number">${setNumber}</td>` : "";
  return `<tr data-id="${id}">
    ${setCell}
    <td>${hideExerciseName ? "" : escapeHtml(data.exerciseName || "")}</td>
    <td class="weight-cell">${data.weight ?? ""}${weightIcon}</td>
    <td class="reps-cell">${data.reps ?? ""}${repsIcon}</td>
    <td class="superset-cell">${escapeHtml(supersetLabel)}</td>
    <td>${escapeHtml(data.notes || "")}</td>
    <td class="workout-actions">${onEdit ? `<button type="button" class="secondary outline edit-set-btn" data-id="${id}">Edit</button>` : ""}${onDelete ? `<button type="button" class="secondary outline delete-set-btn" data-id="${id}">Delete</button>` : ""}</td>
  </tr>`;
}

function renderLogSection() {
  const session = activeSessionId ? currentSessions.get(activeSessionId) : null;
  if (activeSessionId && session) {
    startWorkoutWrap?.classList.add("hidden");
    activeWorkoutWrap?.classList.remove("hidden");
    if (workoutDateInput) workoutDateInput.value = session.date;
    if ($("#active-workout-date-label")) $("#active-workout-date-label").textContent = "Workout: " + formatDateLabel(session.date);
    const sets = getSetsForSession(activeSessionId);
    const groups = groupSetsByExercise(sets);
    activeWorkoutBody.innerHTML = [...groups.entries()].map(([, groupSets]) => {
      const exName = groupSets[0]?.data?.exerciseName || "—";
      return `<tr class="exercise-group-header"><td colspan="7">${escapeHtml(exName)}</td></tr>` +
        groupSets.map(({ id, data }, i) => renderWorkoutRow(id, data, true, false, true, i + 1)).join("");
    }).join("");
    refreshSupersetOptions();
    activeWorkoutBody.querySelectorAll(".edit-set-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingWorkoutId = btn.getAttribute("data-id");
        const d = currentWorkouts.get(editingWorkoutId);
        if (d) {
          $("#exercise-name").value = d.exerciseName ?? "";
          $("#weight").value = d.weight ?? "";
          $("#reps").value = d.reps ?? "";
          supersetSelect.value = d.supersetWithId ?? "";
          $("#notes").value = d.notes ?? "";
        }
        workoutCancelEditBtn?.classList.remove("hidden");
        editIndicator?.classList.remove("hidden");
        workoutSubmitBtn.textContent = "Update set";
        setComparisonMessage("");
      });
    });
  } else {
    startWorkoutWrap?.classList.remove("hidden");
    activeWorkoutWrap?.classList.add("hidden");
  }
}

function refreshSupersetOptions() {
  const sets = activeSessionId ? getSetsForSession(activeSessionId) : [];
  const opts = ['<option value="">No superset</option>'];
  sets.forEach(({ id, data }) => {
    if (id === editingWorkoutId) return;
    opts.push(`<option value="${id}">${escapeHtml((data.exerciseName || "") + ` (${data.weight ?? ""} kg × ${data.reps ?? ""})`)}</option>`);
  });
  supersetSelect.innerHTML = opts.join("");
}

document.getElementById("start-workout-btn")?.addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    const ref = await addDoc(collection(db, "workoutSessions"), { userId: currentUser.uid, date: getTodayString(), startedAt: null, endedAt: null, durationMinutes: null });
    await setDoc(doc(db, "sessions", currentUser.uid), { activeSessionId: ref.id, updatedAt: serverTimestamp() });
  } catch (e) {
    console.error(e);
    setWorkoutError("Failed to start workout.");
  }
});

$("#finish-workout-btn")?.addEventListener("click", async () => {
  if (!currentUser || !activeSessionId) return;
  const sets = getSetsForSession(activeSessionId);
  if (sets.length === 0) {
    try {
      await deleteDoc(doc(db, "workoutSessions", activeSessionId));
      await setDoc(doc(db, "sessions", currentUser.uid), { activeSessionId: null, updatedAt: serverTimestamp() });
      exitEditMode();
    } catch (e) {
      console.error(e);
    }
    return;
  }
  try {
    const snap = await getDoc(doc(db, "workoutSessions", activeSessionId));
    const startedAt = snap.exists() ? snap.data().startedAt?.toDate?.() : null;
    const endTime = new Date();
    const durationMinutes = startedAt ? Math.max(0, Math.round((endTime - startedAt) / 60000)) : 0;
    await updateDoc(doc(db, "workoutSessions", activeSessionId), { endedAt: Timestamp.fromDate(endTime), durationMinutes });
    await setDoc(doc(db, "sessions", currentUser.uid), { activeSessionId: null, updatedAt: serverTimestamp() });
    exitEditMode();
  } catch (e) {
    console.error(e);
  }
});

// ----- Recent -----
const recentDatesList = $("#recent-dates-list");
const recentDatesView = $("#recent-dates-view");
const recentDetailView = $("#recent-detail-view");
const detailBackBtn = $("#detail-back-btn");

function renderRecentSection() {
  if (!recentDatesView || !recentDetailView) return;
  if (selectedSessionId || selectedDateForDetail) {
    recentDatesView.classList.add("hidden");
    recentDetailView.classList.remove("hidden");
    const dateLabel = selectedSessionId ? currentSessions.get(selectedSessionId)?.date : selectedDateForDetail;
    $("#detail-date-label").textContent = "Workout: " + formatDateLabel(dateLabel || "");
    $("#detail-workout-date").value = dateLabel || "";
    const s = selectedSessionId ? currentSessions.get(selectedSessionId) : null;
    $("#detail-session-meta").textContent = s ? [s.endedAt?.toDate?.()?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), s.durationMinutes != null ? `${s.durationMinutes} min` : ""].filter(Boolean).join(" · ") || "—" : "Legacy";
    const sets = selectedSessionId ? getSetsForSession(selectedSessionId) : getSetsForLegacyDate(selectedDateForDetail);
    const detailBody = document.getElementById("detail-workout-body");
    const groups = groupSetsByExercise(sets);
    detailBody.innerHTML = [...groups.entries()].map(([, groupSets]) => {
      const exName = groupSets[0]?.data?.exerciseName || "—";
      return `<tr class="exercise-group-header"><td colspan="7">${escapeHtml(exName)}</td></tr>` +
        groupSets.map(({ id, data }, i) => renderWorkoutRow(id, data, true, true, true, i + 1)).join("");
    }).join("");
    detailBody.querySelectorAll(".edit-set-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        detailEditingId = btn.getAttribute("data-id");
        const d = currentWorkouts.get(detailEditingId);
        if (d) {
          $("#detail-exercise-name").value = d.exerciseName ?? "";
          $("#detail-weight").value = d.weight ?? "";
          $("#detail-reps").value = d.reps ?? "";
          $("#detail-superset-with").value = d.supersetWithId ?? "";
          $("#detail-notes").value = d.notes ?? "";
        }
        $("#detail-add-set-btn").textContent = "Update set";
      });
    });
    detailBody.querySelectorAll(".delete-set-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this set?")) return;
        try {
          await deleteDoc(doc(db, "workouts", btn.getAttribute("data-id")));
        } catch (err) { console.error(err); }
      });
    });
  } else {
    recentDatesView.classList.remove("hidden");
    recentDetailView.classList.add("hidden");
    const sessions = [...currentSessions.values()].sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
    const legacyDates = [...new Set([...currentWorkouts.values()].filter((d) => d.date && !d.sessionId).map((d) => d.date))].sort().reverse();
    let html = "";
    sessions.forEach((s) => {
      html += `<li><button type="button" class="date-btn" data-session="${s.id}">${formatDateLabel(s.date)} · ${s.durationMinutes != null ? s.durationMinutes + " min" : ""}</button></li>`;
    });
    legacyDates.forEach((d) => {
      if (!sessions.some((s) => s.date === d)) html += `<li><button type="button" class="date-btn" data-date="${d}">${formatDateLabel(d)} (legacy)</button></li>`;
    });
    recentDatesList.innerHTML = html || "<li class=\"muted\">No workouts yet.</li>";
    recentDatesList.querySelectorAll(".date-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedSessionId = btn.getAttribute("data-session") || null;
        selectedDateForDetail = btn.getAttribute("data-date") || null;
        renderRecentSection();
      });
    });
  }
}

detailBackBtn?.addEventListener("click", () => {
  selectedSessionId = null;
  selectedDateForDetail = null;
  detailEditingId = null;
  renderRecentSection();
});

$("#detail-workout-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const date = selectedSessionId ? currentSessions.get(selectedSessionId)?.date : selectedDateForDetail;
  if (!date) return;
  const exerciseName = $("#detail-exercise-name")?.value?.trim();
  const weight = parseFloat($("#detail-weight")?.value);
  const reps = parseInt($("#detail-reps")?.value, 10);
  const supersetWithId = $("#detail-superset-with")?.value || null;
  const notes = $("#detail-notes")?.value?.trim();
  if (!exerciseName || Number.isNaN(weight) || Number.isNaN(reps)) return;
  const payload = { userId: currentUser.uid, date, exerciseName, exerciseKey: normalizeExerciseKey(exerciseName), weight, reps, supersetWithId, notes: notes || null };
  try {
    if (detailEditingId) {
      await updateDoc(doc(db, "workouts", detailEditingId), { ...payload, updatedAt: serverTimestamp() });
      detailEditingId = null;
      $("#detail-add-set-btn").textContent = "Add set";
    } else {
      await addDoc(collection(db, "workouts"), { ...payload, sessionId: selectedSessionId || null, createdAt: serverTimestamp() });
    }
    $("#detail-workout-form").reset();
    renderRecentSection();
  } catch (err) {
    console.error(err);
    $("#detail-workout-error").textContent = "Failed to save.";
  }
});

// ----- Stats -----
function renderStatsSection() {
  const overview = $("#stats-overview");
  const activity = $("#stats-activity");
  const exercises = $("#stats-exercises");
  const volume = $("#stats-volume");
  if (!overview || !activity || !exercises || !volume) return;
  const now = new Date();
  const today = getTodayString();
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  let totalWorkouts = 0, totalSets = 0, totalVolume = 0, days7 = 0, days30 = 0;
  const dateSet = new Set();
  const exCount = new Map();
  const exVolume = new Map();
  currentWorkouts.forEach((d) => {
    totalSets++;
    const v = (d.weight ?? 0) * (d.reps ?? 0);
    totalVolume += v;
    if (d.date) dateSet.add(d.date);
    const k = d.exerciseKey || d.exerciseName || "";
    exCount.set(k, (exCount.get(k) ?? 0) + 1);
    exVolume.set(k, (exVolume.get(k) ?? 0) + v);
  });
  totalWorkouts = dateSet.size;
  dateSet.forEach((d) => {
    const t = new Date(d + "T12:00:00").getTime();
    if (t >= sevenDaysAgo.getTime()) days7++;
    if (t >= thirtyDaysAgo.getTime()) days30++;
  });
  overview.innerHTML = `
    <div class="stats-card"><div class="value">${totalWorkouts}</div><div class="label">Workouts</div></div>
    <div class="stats-card"><div class="value">${totalSets}</div><div class="label">Sets</div></div>
    <div class="stats-card"><div class="value">${Math.round(totalVolume)}</div><div class="label">Volume (kg)</div></div>
    <div class="stats-card"><div class="value">${days7}/${7}</div><div class="label">7d active</div></div>
    <div class="stats-card"><div class="value">${days30}/30</div><div class="label">30d active</div></div>`;
  activity.innerHTML = `<p class="muted">${days7} days in last 7, ${days30} in last 30.</p>`;
  const topEx = [...exCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  exercises.innerHTML = topEx.map(([k, v]) => `<li><span>${escapeHtml(k || "—")}</span> <span>${v} sets</span></li>`).join("") || "<li class=\"muted\">No data</li>";
  const topVol = [...exVolume.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  volume.innerHTML = topVol.map(([k, v]) => `<li><span>${escapeHtml(k || "—")}</span> <span>${Math.round(v)} kg</span></li>`).join("") || "<li class=\"muted\">No data</li>";
}

// ----- Profile -----
async function loadProfile(userId) {
  try {
    const snap = await getDoc(doc(db, "profiles", userId));
    const d = snap.exists() ? snap.data() : {};
    $("#profile-display-name").value = d.displayName ?? "";
    $("#profile-height").value = d.height ?? "";
    $("#profile-body-weight").value = d.bodyWeight ?? "";
    $("#profile-weight-unit").value = d.weightUnit ?? "kg";
    $("#profile-birth-year").value = d.birthYear ?? "";
  } catch (err) {
    console.error(err);
  }
}

$("#profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const payload = {
    displayName: $("#profile-display-name")?.value?.trim() || null,
    height: $("#profile-height")?.value ? parseFloat($("#profile-height").value) : null,
    bodyWeight: $("#profile-body-weight")?.value ? parseFloat($("#profile-body-weight").value) : null,
    weightUnit: $("#profile-weight-unit")?.value || "kg",
    birthYear: $("#profile-birth-year")?.value ? parseInt($("#profile-birth-year").value, 10) : null,
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, "profiles", currentUser.uid), payload, { merge: true });
    $("#profile-success").textContent = "Profile saved.";
    $("#profile-success").classList.remove("hidden");
    setTimeout(() => $("#profile-success").classList.add("hidden"), 3000);
  } catch (err) {
    console.error(err);
    $("#profile-error").textContent = "Failed to save.";
    $("#profile-error").classList.remove("hidden");
  }
});

// ----- Competition -----
function subscribeToCompetitions() {
  unsubscribeCompetitions?.();
  const q = query(collection(db, "competitions"), where("status", "==", "open"));
  unsubscribeCompetitions = onSnapshot(q, (snap) => {
    currentCompetitions = new Map();
    const now = Date.now();
    snap.forEach((d) => {
      const data = d.data();
      if ((data.endsAt?.toMillis?.() ?? 0) > now) currentCompetitions.set(d.id, { id: d.id, ...data });
    });
    renderCompetitionSection();
    renderCompetitionSubmitOptions();
  });
}

function subscribeToParticipations(userId) {
  unsubscribeParticipations?.();
  const q = query(collection(db, "competitionParticipants"), where("userId", "==", userId));
  unsubscribeParticipations = onSnapshot(q, (snap) => {
    myParticipations = new Map();
    snap.forEach((d) => myParticipations.set(d.data().competitionId, { id: d.id, ...d.data() }));
    renderCompetitionSection();
    renderCompetitionSubmitOptions();
  });
}

function renderCompetitionSection() {
  const list = $("#competition-list");
  if (!list) return;
  const comps = [...currentCompetitions.values()].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  list.innerHTML = comps.length === 0 ? '<li class="muted">No open competitions.</li>' : comps.map((c) => {
    const joined = myParticipations.has(c.id);
    const ends = c.endsAt?.toDate?.().toLocaleString();
    return `<li class="competition-item"><div><strong>${escapeHtml(c.exerciseName || "")}</strong> <span class="muted">· ends ${ends || "—"}</span></div><button type="button" class="comp-view-btn" data-id="${c.id}">${joined ? "View" : "Join"}</button></li>`;
  }).join("");
  list.querySelectorAll(".comp-view-btn").forEach((btn) => btn.addEventListener("click", () => showCompetitionDetail(btn.getAttribute("data-id"))));
}

function showCompetitionDetail(compId) {
  selectedCompetitionId = compId;
  const comp = currentCompetitions.get(compId);
  if (!comp) return;
  $("#competition-list-view").classList.add("hidden");
  $("#competition-detail-view").classList.remove("hidden");
  $("#comp-detail-title").textContent = comp.exerciseName || "Competition";
  $("#comp-detail-meta").textContent = comp.endsAt?.toDate ? "Ends " + comp.endsAt.toDate().toLocaleString() : "";
  const isCreator = comp.createdBy === currentUser?.uid;
  const joined = myParticipations.has(compId);
  $("#comp-join-btn").classList.toggle("hidden", joined || isCreator);
  $("#comp-close-btn").classList.toggle("hidden", !isCreator);
  renderCompetitionLeaderboard(compId);
}

async function renderCompetitionLeaderboard(compId) {
  const el = $("#comp-leaderboard");
  if (!el) return;
  const snap = await getDocs(query(collection(db, "competitionParticipants"), where("competitionId", "==", compId)));
  const parts = snap.docs.map((d) => d.data()).filter((p) => p.bestVolume > 0).sort((a, b) => b.bestVolume - a.bestVolume);
  el.innerHTML = parts.length === 0 ? '<p class="muted">No submissions yet.</p>' : `<ol class="comp-leaderboard-list">${parts.map((p, i) => `<li>#${i + 1} ${escapeHtml(p.userEmail || "")} · ${p.bestWeight ?? 0} kg × ${p.bestReps ?? 0} = ${p.bestVolume ?? 0} pts</li>`).join("")}</ol>`;
}

$("#comp-back-btn")?.addEventListener("click", () => {
  selectedCompetitionId = null;
  $("#competition-list-view").classList.remove("hidden");
  $("#competition-detail-view").classList.add("hidden");
});

$("#comp-join-btn")?.addEventListener("click", async () => {
  if (!currentUser || !selectedCompetitionId) return;
  try {
    await addDoc(collection(db, "competitionParticipants"), { competitionId: selectedCompetitionId, userId: currentUser.uid, userEmail: currentUser.email ?? "", joinedAt: serverTimestamp(), submissions: [], bestVolume: null, bestWeight: null, bestReps: null });
    showCompetitionDetail(selectedCompetitionId);
  } catch (err) { console.error(err); }
});

$("#comp-close-btn")?.addEventListener("click", async () => {
  if (!currentUser || !selectedCompetitionId) return;
  const comp = currentCompetitions.get(selectedCompetitionId);
  if (comp?.createdBy !== currentUser.uid) return;
  try {
    await updateDoc(doc(db, "competitions", selectedCompetitionId), { status: "closed", closedAt: serverTimestamp() });
    $("#comp-back-btn").click();
  } catch (err) { console.error(err); }
});

$("#create-competition-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const name = $("#comp-exercise-name")?.value?.trim();
  if (!name) return;
  try {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await addDoc(collection(db, "competitions"), { createdBy: currentUser.uid, createdByEmail: currentUser.email ?? "", exerciseName: name, exerciseKey: normalizeExerciseKey(name), createdAt: serverTimestamp(), endsAt: Timestamp.fromDate(endsAt), status: "open" });
    $("#comp-exercise-name").value = "";
  } catch (err) { console.error(err); }
});

function renderCompetitionSubmitOptions() {
  const wrap = $("#competition-submit-wrap");
  const list = $("#competition-submit-list");
  if (!wrap || !list) return;
  let exerciseKey, weight, reps;
  if (lastAddedSet) {
    exerciseKey = lastAddedSet.exerciseKey;
    weight = lastAddedSet.weight;
    reps = lastAddedSet.reps;
  } else {
    const ex = $("#exercise-name")?.value?.trim();
    weight = parseFloat($("#weight")?.value);
    reps = parseInt($("#reps")?.value, 10);
    if (!ex || Number.isNaN(weight) || Number.isNaN(reps)) { wrap.classList.add("hidden"); return; }
    exerciseKey = normalizeExerciseKey(ex);
  }
  const matching = [];
  myParticipations.forEach((p, compId) => {
    const comp = currentCompetitions.get(compId);
    if (!comp || comp.exerciseKey !== exerciseKey) return;
    if ((p.submissions || []).length >= 3) return;
    matching.push({ comp, p });
  });
  if (matching.length === 0) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  list.innerHTML = matching.map(({ comp }) => {
    const part = myParticipations.get(comp.id);
    const left = 3 - (part?.submissions?.length ?? 0);
    return `<div class="comp-submit-item"><button type="button" class="comp-submit-btn" data-id="${comp.id}">Submit ${weight} kg × ${reps} reps to "${escapeHtml(comp.exerciseName)}" (${left}/3 left)</button></div>`;
  }).join("");
  list.querySelectorAll(".comp-submit-btn").forEach((btn) => btn.addEventListener("click", () => submitToCompetition(btn.getAttribute("data-id"), weight, reps)));
}

function offerCompetitionSubmit(exerciseKey, weight, reps) {
  renderCompetitionSubmitOptions();
}

async function submitToCompetition(compId, weight, reps) {
  if (!currentUser) return;
  const part = myParticipations.get(compId);
  if (!part || (part.submissions || []).length >= 3) return;
  const volume = weight * reps;
  try {
    const ref = doc(db, "competitionParticipants", part.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const subs = data.submissions || [];
      if (subs.length >= 3) return;
      let bestVolume = data.bestVolume ?? 0, bestWeight = data.bestWeight, bestReps = data.bestReps;
      if (volume > bestVolume) { bestVolume = volume; bestWeight = weight; bestReps = reps; }
      tx.update(ref, { submissions: [...subs, { weight, reps, submittedAt: serverTimestamp() }], bestVolume, bestWeight, bestReps });
    });
    lastAddedSet = null;
    $("#competition-submit-wrap")?.classList.add("hidden");
  } catch (err) { console.error(err); }
}

$("#comp-submit-dismiss")?.addEventListener("click", () => { lastAddedSet = null; $("#competition-submit-wrap")?.classList.add("hidden"); });

["exercise-name", "weight", "reps"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", renderCompetitionSubmitOptions);
});

// ----- Init -----
initRouter();
