import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.19.0";
const THEME_KEY = "flashcards_share_theme";
const GUEST_KEY_PREFIX = "flashcards_guest_progress_";

const [appModule, authModule, firestoreModule] = await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
  import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
]);

const { initializeApp } = appModule;
const {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} = authModule;

const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp
} = firestoreModule;

const state = {
  app: null,
  auth: null,
  db: null,
  user: null,
  isAdmin: false,
  selectedDeck: null,
  currentProgress: null,
  studyMode: "standard",
  sessionCards: [],
  sessionIndex: 0,
  sessionRatings: [],
  teacherDecks: []
};

const sampleDeck = {
  name: "Bedroom Items",
  text: `Alarm Clock = နၣ်ရံၣ်ဆ့လ့
Bed = လီၢ်မံ
Bedroom = လီၢ်မံဒၢး
Blanket = ယၢ်လုး
Pillow = ခိၣ်သခၢၣ်
Curtain = ယၢ်ဘျးသဒၢ
Dresser = စီၢ်ကယၢ
Fan = နီၣ်ဝံၢ်ကသုၣ်
Mirror = မဲာ်ထံကလၤ
Hanger = နီၣ်ဘျးဆ့`
};

function isConfigured() {
  return Object.values(firebaseConfig || {}).every(v =>
    typeof v === "string" && v && !v.includes("PASTE_")
  );
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMessage(message, type = "", timeout = 4200) {
  const el = document.getElementById("globalMessage");
  el.textContent = message;
  el.className = `global-message ${type}`.trim();
  el.classList.remove("hidden");
  clearTimeout(showMessage._timer);
  if (timeout) {
    showMessage._timer = setTimeout(() => el.classList.add("hidden"), timeout);
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parsePairs(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      let parts;
      if (line.includes("=")) parts = line.split("=");
      else if (line.includes("\t")) parts = line.split("\t");
      else if (line.includes(",")) parts = line.split(",");
      else return null;

      const front = parts.shift()?.trim();
      const back = parts.join("=").trim();
      if (!front || !back) return null;
      return { id: uid("card"), front, back };
    })
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function getDeckIdFromUrl() {
  return new URL(window.location.href).searchParams.get("deck");
}

function buildShareLink(deckId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("deck", deckId);
  return url.toString();
}

function progressDocId(deckId, studentId) {
  return `${deckId}_${studentId}`;
}

function progressStats(progress) {
  if (!progress) return { studied: 0, ratingCount: 0, ratingTotal: 0, avg: 0, mastery: 0 };
  const ratingCount = Number(progress.ratingCount || 0);
  const ratingTotal = Number(progress.ratingTotal || 0);
  const avg = ratingCount ? ratingTotal / ratingCount : 0;
  return {
    studied: Number(progress.studied || 0),
    ratingCount,
    ratingTotal,
    avg,
    mastery: Math.round((avg / 5) * 100)
  };
}

function guestProgressKey(deckId) {
  return `${GUEST_KEY_PREFIX}${deckId}`;
}

function loadGuestProgress(deckId) {
  try {
    return JSON.parse(localStorage.getItem(guestProgressKey(deckId))) || null;
  } catch {
    return null;
  }
}

function saveGuestProgress(deckId, progress) {
  localStorage.setItem(guestProgressKey(deckId), JSON.stringify(progress));
}

function timestampToText(value) {
  if (!value) return "—";
  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function setUserChip(user, role) {
  document.getElementById("userName").textContent = user.displayName || user.email || "User";
  document.getElementById("userRole").textContent = role;

  const photo = document.getElementById("userPhoto");
  photo.src = user.photoURL || "";
  photo.classList.toggle("hidden", !user.photoURL);

  document.getElementById("userChip").classList.remove("hidden");
  document.getElementById("signOutBtn").classList.remove("hidden");
}

function clearUserChip() {
  document.getElementById("userChip").classList.add("hidden");
  document.getElementById("signOutBtn").classList.add("hidden");
}

async function ensureUserProfile() {
  if (!state.user) return;
  await setDoc(doc(state.db, "users", state.user.uid), {
    displayName: state.user.displayName || "",
    email: state.user.email || "",
    photoURL: state.user.photoURL || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function checkAdmin() {
  if (!state.user) {
    state.isAdmin = false;
    return false;
  }
  const snap = await getDoc(doc(state.db, "admins", state.user.uid));
  state.isAdmin = snap.exists();
  return state.isAdmin;
}

async function signInGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(state.auth, provider);
  } catch (err) {
    handleFirebaseError(err, "Google sign-in failed.");
  }
}

async function routeApp({ showPending = false } = {}) {
  const deckId = getDeckIdFromUrl();

  if (state.user) {
    await ensureUserProfile();
    await checkAdmin();
    setUserChip(state.user, state.isAdmin ? "Teacher" : "Student");
  } else {
    clearUserChip();
    state.isAdmin = false;
  }

  if (deckId) {
    await openSharedDeck(deckId);
    return;
  }

  if (!state.user) {
    showView("homeView");
    return;
  }

  if (state.isAdmin) {
    await loadTeacherDecks();
    showView("teacherView");
    return;
  }

  if (showPending && !sessionStorage.getItem("flashcards_student_confirmed")) {
    document.getElementById("uidDisplay").textContent = state.user.uid;
    showView("accessPendingView");
    return;
  }

  showView("studentIdleView");
}

async function openSharedDeck(deckId) {
  try {
    const snap = await getDoc(doc(state.db, "decks", deckId));
    if (!snap.exists()) {
      showMessage("This deck link is invalid or the deck was removed.", "error", 0);
      showView(state.user && state.isAdmin ? "teacherView" : "homeView");
      return;
    }

    state.selectedDeck = { id: snap.id, ...snap.data() };

    if (!state.selectedDeck.published && !(state.user && state.isAdmin)) {
      showMessage("This deck is not currently published.", "error", 0);
      showView("homeView");
      return;
    }

    await loadCurrentProgress();
    renderDeckLanding();
    showView("deckLandingView");
  } catch (err) {
    handleFirebaseError(err, "Could not open this deck.");
  }
}

async function loadCurrentProgress() {
  if (!state.selectedDeck) return;

  if (!state.user || state.isAdmin) {
    state.currentProgress = loadGuestProgress(state.selectedDeck.id) || {
      deckId: state.selectedDeck.id,
      studied: 0,
      ratingCount: 0,
      ratingTotal: 0,
      cards: {}
    };
    return;
  }

  const id = progressDocId(state.selectedDeck.id, state.user.uid);
  const snap = await getDoc(doc(state.db, "progress", id));

  state.currentProgress = snap.exists()
    ? { id: snap.id, ...snap.data() }
    : {
        id,
        deckId: state.selectedDeck.id,
        deckName: state.selectedDeck.name,
        studentId: state.user.uid,
        studentName: state.user.displayName || "",
        studentEmail: state.user.email || "",
        studied: 0,
        ratingCount: 0,
        ratingTotal: 0,
        cards: {}
      };
}

function renderDeckLanding() {
  const deck = state.selectedDeck;
  const stats = progressStats(state.currentProgress);

  document.getElementById("landingDeckTitle").textContent = deck.name;
  document.getElementById("landingDeckMeta").textContent =
    `${deck.cards?.length || 0} cards · Shared flashcard deck`;
  document.getElementById("landingCardCount").textContent = deck.cards?.length || 0;

  const namedProgress = state.user && !state.isAdmin;
  const hasGuestProgress = !namedProgress && stats.studied > 0;

  document.getElementById("landingMastery").textContent =
    (namedProgress || hasGuestProgress) ? `${stats.mastery}%` : "—";
  document.getElementById("landingStudied").textContent =
    (namedProgress || hasGuestProgress) ? stats.studied : "—";

  const guestNotice = document.getElementById("guestNotice");
  const signInBtn = document.getElementById("deckSignInBtn");

  if (namedProgress) {
    guestNotice.classList.add("hidden");
    signInBtn.classList.add("hidden");
  } else if (state.isAdmin) {
    guestNotice.innerHTML =
      `<strong>Teacher preview</strong><span>You can study this deck without affecting student progress.</span>`;
    guestNotice.classList.remove("hidden");
    signInBtn.classList.add("hidden");
  } else {
    guestNotice.innerHTML =
      `<strong>Studying as guest</strong><span>You can study now. Sign in with Google if you want your progress saved for your teacher.</span>`;
    guestNotice.classList.remove("hidden");
    signInBtn.classList.remove("hidden");
  }
}

async function loadTeacherDecks() {
  try {
    const q = query(
      collection(state.db, "decks"),
      where("createdBy", "==", state.user.uid)
    );
    const snap = await getDocs(q);

    state.teacherDecks = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    renderTeacherDecks();
  } catch (err) {
    handleFirebaseError(err, "Could not load your decks.");
  }
}

function renderTeacherDecks() {
  const grid = document.getElementById("teacherDeckGrid");

  if (!state.teacherDecks.length) {
    grid.innerHTML = `<div class="empty-state">No decks yet. Create your first shareable deck.</div>`;
    return;
  }

  grid.innerHTML = state.teacherDecks.map(deck => `
    <article class="card deck-card">
      <div>
        <span class="eyebrow">${deck.published ? "Published" : "Draft"}</span>
        <h3>${escapeHtml(deck.name)}</h3>
        <p>${deck.cards?.length || 0} cards</p>
      </div>

      <div class="deck-card-footer">
        <span class="badge">${deck.published ? "Link active" : "Link disabled"}</span>

        <div class="deck-actions">
          <button class="primary-btn" data-copy-link="${deck.id}" ${deck.published ? "" : "disabled"}>
            Copy Link
          </button>
          <button class="secondary-btn" data-preview-deck="${deck.id}">Preview</button>
          <button class="secondary-btn" data-progress-deck="${deck.id}">Progress</button>
          <button class="secondary-btn" data-toggle-deck="${deck.id}" data-published="${deck.published ? "1" : "0"}">
            ${deck.published ? "Unpublish" : "Publish"}
          </button>
          <button class="danger-btn" data-delete-deck="${deck.id}">Delete</button>
        </div>
      </div>
    </article>
  `).join("");
}

async function createDeck() {
  const name = document.getElementById("deckNameInput").value.trim();
  const cards = parsePairs(document.getElementById("deckCardsInput").value);
  const published = document.getElementById("publishDeckInput").checked;

  if (!name) return showMessage("Enter a deck name.", "error");
  if (!cards.length) return showMessage("Add at least one valid vocabulary pair.", "error");

  try {
    const ref = await addDoc(collection(state.db, "decks"), {
      name,
      cards,
      published,
      createdBy: state.user.uid,
      createdByName: state.user.displayName || state.user.email || "Teacher",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    document.getElementById("deckNameInput").value = "";
    document.getElementById("deckCardsInput").value = "";
    document.getElementById("publishDeckInput").checked = true;
    document.getElementById("newDeckPanel").classList.add("hidden");

    await loadTeacherDecks();

    if (published) {
      await copyShareLink(ref.id);
      showMessage("Deck created and share link copied.", "success");
    } else {
      showMessage("Draft deck created.", "success");
    }
  } catch (err) {
    handleFirebaseError(err, "Could not create the deck.");
  }
}

async function copyShareLink(deckId) {
  const link = buildShareLink(deckId);
  try {
    await navigator.clipboard.writeText(link);
    showMessage("Share link copied. Paste it into Google Classroom.", "success");
  } catch {
    window.prompt("Copy this deck link:", link);
  }
}

async function previewDeck(deckId) {
  const deck = state.teacherDecks.find(d => d.id === deckId);
  if (!deck) return;

  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("deck", deckId);
  history.pushState({}, "", url);

  await openSharedDeck(deckId);
}

async function toggleDeck(deckId, isPublished) {
  try {
    await updateDoc(doc(state.db, "decks", deckId), {
      published: !isPublished,
      updatedAt: serverTimestamp()
    });
    await loadTeacherDecks();
    showMessage(!isPublished ? "Deck published. Its link is active." : "Deck unpublished.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not update the deck.");
  }
}

async function deleteDeckById(deckId) {
  if (!confirm("Delete this deck? Student progress records will remain in Firestore.")) return;

  try {
    await deleteDoc(doc(state.db, "decks", deckId));
    await loadTeacherDecks();
    showMessage("Deck deleted.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not delete the deck.");
  }
}

async function openProgress(deckId) {
  const deck = state.teacherDecks.find(d => d.id === deckId);
  if (!deck) return;

  state.selectedDeck = deck;
  document.getElementById("progressDeckTitle").textContent = deck.name;
  showView("teacherProgressView");
  await loadProgressDashboard();
}

async function loadProgressDashboard() {
  const host = document.getElementById("progressTable");
  host.innerHTML = `<div class="empty-state">Loading progress…</div>`;

  try {
    const q = query(
      collection(state.db, "progress"),
      where("deckId", "==", state.selectedDeck.id)
    );

    const snap = await getDocs(q);
    const rows = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        String(a.studentName || a.studentEmail || "").localeCompare(
          String(b.studentName || b.studentEmail || "")
        )
      );

    document.getElementById("progressStudentCount").textContent =
      `${rows.length} student${rows.length === 1 ? "" : "s"}`;

    if (!rows.length) {
      host.innerHTML = `<div class="empty-state">No signed-in student progress yet.</div>`;
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Email</th>
              <th>Studied</th>
              <th>Average</th>
              <th>Mastery</th>
              <th>Last studied</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(p => {
              const stats = progressStats(p);
              return `
                <tr>
                  <td>${escapeHtml(p.studentName || "Student")}</td>
                  <td>${escapeHtml(p.studentEmail || "—")}</td>
                  <td>${stats.studied}</td>
                  <td>${stats.avg.toFixed(1)} / 5</td>
                  <td>${stats.mastery}%</td>
                  <td>${timestampToText(p.updatedAt)}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    host.innerHTML = `<div class="empty-state">Progress could not be loaded.</div>`;
    handleFirebaseError(err, "Could not load progress.");
  }
}

function openStudySetup() {
  if (!state.selectedDeck) return;
  document.getElementById("setupDeckTitle").textContent = state.selectedDeck.name;
  showView("studySetupView");
}

function startStudy(mode) {
  const deck = state.selectedDeck;
  if (!deck?.cards?.length) return;

  state.studyMode = mode;
  state.sessionIndex = 0;
  state.sessionRatings = [];

  const cardProgress = state.currentProgress?.cards || {};

  state.sessionCards = deck.cards
    .map(card => {
      const p = cardProgress[card.id];
      const score = p?.count ? Number(p.total || 0) / Number(p.count) : 0;
      return { ...card, score, jitter: Math.random() * .2 };
    })
    .sort((a, b) => (a.score + a.jitter) - (b.score + b.jitter));

  document.getElementById("studyDeckTitle").textContent = deck.name;
  document.getElementById("studyModeLabel").textContent =
    mode === "standard" ? "Flashcard" : mode === "reverse" ? "Reverse" : "Typing";

  showView("studyView");
  renderStudyCard();
}

function renderStudyCard() {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) return finishSession();

  const reverse = state.studyMode === "reverse";

  document.getElementById("questionText").textContent = reverse ? card.back : card.front;
  document.getElementById("answerText").textContent = reverse ? card.front : card.back;
  document.getElementById("cardCounter").textContent =
    `Card ${state.sessionIndex + 1} of ${state.sessionCards.length}`;
  document.getElementById("sessionProgress").style.width =
    `${(state.sessionIndex / state.sessionCards.length) * 100}%`;

  document.getElementById("answerArea").classList.add("hidden");
  document.getElementById("typingResult").textContent = "";
  document.getElementById("typingResult").className = "typing-result";

  if (state.studyMode === "typing") {
    document.getElementById("typingArea").classList.remove("hidden");
    document.getElementById("revealBtn").classList.add("hidden");
    document.getElementById("typingInput").value = "";
    setTimeout(() => document.getElementById("typingInput").focus(), 0);
  } else {
    document.getElementById("typingArea").classList.add("hidden");
    document.getElementById("revealBtn").classList.remove("hidden");
  }
}

function revealAnswer() {
  document.getElementById("answerArea").classList.remove("hidden");
  document.getElementById("revealBtn").classList.add("hidden");
}

function checkTypingAnswer() {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) return;

  const given = document.getElementById("typingInput").value.trim();
  const result = document.getElementById("typingResult");

  if (!given) {
    result.textContent = "Type an answer first.";
    result.className = "typing-result incorrect";
    return;
  }

  const correct = normalizeText(given) === normalizeText(card.back);
  result.textContent = correct ? "Correct!" : "Not quite — compare with the answer below.";
  result.className = `typing-result ${correct ? "correct" : "incorrect"}`;
  document.getElementById("answerArea").classList.remove("hidden");
}

async function rateCurrentCard(rating) {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) return;

  rating = Number(rating);
  const p = state.currentProgress || {
    deckId: state.selectedDeck.id,
    studied: 0,
    ratingCount: 0,
    ratingTotal: 0,
    cards: {}
  };

  p.cards = p.cards || {};
  const cp = p.cards[card.id] || { count: 0, total: 0, seen: 0 };

  cp.count += 1;
  cp.total += rating;
  cp.seen += 1;

  p.cards[card.id] = cp;
  p.studied = Number(p.studied || 0) + 1;
  p.ratingCount = Number(p.ratingCount || 0) + 1;
  p.ratingTotal = Number(p.ratingTotal || 0) + rating;

  state.currentProgress = p;
  state.sessionRatings.push(rating);

  try {
    if (state.user && !state.isAdmin) {
      const id = progressDocId(state.selectedDeck.id, state.user.uid);
      p.id = id;

      await setDoc(doc(state.db, "progress", id), {
        deckId: state.selectedDeck.id,
        deckName: state.selectedDeck.name,
        studentId: state.user.uid,
        studentName: state.user.displayName || "",
        studentEmail: state.user.email || "",
        studied: p.studied,
        ratingCount: p.ratingCount,
        ratingTotal: p.ratingTotal,
        cards: p.cards,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } else {
      saveGuestProgress(state.selectedDeck.id, p);
    }

    state.sessionIndex += 1;
    renderStudyCard();
  } catch (err) {
    handleFirebaseError(err, "Progress could not be saved. Try again.");
  }
}

function finishSession() {
  const average = state.sessionRatings.length
    ? state.sessionRatings.reduce((a, b) => a + b, 0) / state.sessionRatings.length
    : 0;

  const stats = progressStats(state.currentProgress);

  document.getElementById("completeCards").textContent = state.sessionRatings.length;
  document.getElementById("completeAverage").textContent = average.toFixed(1);
  document.getElementById("completeMastery").textContent = `${stats.mastery}%`;
  document.getElementById("completionText").textContent =
    `You reviewed ${state.sessionRatings.length} card${state.sessionRatings.length === 1 ? "" : "s"} in ${state.selectedDeck.name}.`;

  showView("completeView");
}

function clearDeckParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("deck");
  history.pushState({}, "", url);
}

function handleFirebaseError(err, fallback) {
  console.error(err);

  let message = fallback;

  if (err?.code === "permission-denied") {
    message = "Firebase blocked this request. Replace and publish the new Firestore Rules from this build.";
  } else if (err?.code === "auth/popup-blocked") {
    message = "Your browser blocked the Google sign-in popup. Allow popups and try again.";
  } else if (err?.code === "auth/unauthorized-domain") {
    message = "This website domain is not authorized in Firebase Authentication settings.";
  } else if (err?.message) {
    message = `${fallback} ${err.message}`;
  }

  showMessage(message, "error", 7000);
}

function initTheme() {
  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("dark");
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    THEME_KEY,
    document.body.classList.contains("dark") ? "dark" : "light"
  );
}

async function initializeFirebase() {
  if (!isConfigured()) {
    showView("setupView");
    return;
  }

  try {
    state.app = initializeApp(firebaseConfig);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);

    onAuthStateChanged(state.auth, async user => {
      state.user = user;
      try {
        await routeApp({ showPending: true });
      } catch (err) {
        handleFirebaseError(err, "Could not load Flashcards.");
      }
    });
  } catch (err) {
    console.error(err);
    showView("setupView");
    showMessage("Firebase could not initialize.", "error", 0);
  }
}

document.addEventListener("click", async e => {
  const copy = e.target.closest("[data-copy-link]");
  if (copy) return copyShareLink(copy.dataset.copyLink);

  const preview = e.target.closest("[data-preview-deck]");
  if (preview) return previewDeck(preview.dataset.previewDeck);

  const progress = e.target.closest("[data-progress-deck]");
  if (progress) return openProgress(progress.dataset.progressDeck);

  const toggle = e.target.closest("[data-toggle-deck]");
  if (toggle) {
    return toggleDeck(toggle.dataset.toggleDeck, toggle.dataset.published === "1");
  }

  const remove = e.target.closest("[data-delete-deck]");
  if (remove) return deleteDeckById(remove.dataset.deleteDeck);

  const mode = e.target.closest("[data-mode]");
  if (mode) return startStudy(mode.dataset.mode);

  const rating = e.target.closest("[data-rating]");
  if (rating) return rateCurrentCard(rating.dataset.rating);
});

document.getElementById("homeSignInBtn").addEventListener("click", signInGoogle);
document.getElementById("deckSignInBtn").addEventListener("click", signInGoogle);

document.getElementById("signOutBtn").addEventListener("click", async () => {
  sessionStorage.removeItem("flashcards_student_confirmed");
  await signOut(state.auth);
});

document.getElementById("continueStudentBtn").addEventListener("click", () => {
  sessionStorage.setItem("flashcards_student_confirmed", "1");
  if (getDeckIdFromUrl()) {
    openSharedDeck(getDeckIdFromUrl());
  } else {
    showView("studentIdleView");
  }
});

document.getElementById("refreshRoleBtn").addEventListener("click", async () => {
  try {
    if (await checkAdmin()) {
      setUserChip(state.user, "Teacher");
      clearDeckParam();
      await loadTeacherDecks();
      showView("teacherView");
      showMessage("Teacher access enabled.", "success");
    } else {
      showMessage("Teacher access is not enabled yet.", "error");
    }
  } catch (err) {
    handleFirebaseError(err, "Could not check teacher access.");
  }
});

document.getElementById("copyUidBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.user.uid);
  showMessage("UID copied.", "success");
});

document.getElementById("themeBtn").addEventListener("click", toggleTheme);

document.getElementById("brandBtn").addEventListener("click", async () => {
  clearDeckParam();

  if (!state.user) {
    showView("homeView");
    return;
  }

  if (state.isAdmin) {
    await loadTeacherDecks();
    showView("teacherView");
  } else {
    showView("studentIdleView");
  }
});

document.getElementById("newDeckToggleBtn").addEventListener("click", () => {
  document.getElementById("newDeckPanel").classList.toggle("hidden");
});

document.getElementById("closeDeckPanelBtn").addEventListener("click", () => {
  document.getElementById("newDeckPanel").classList.add("hidden");
});

document.getElementById("createDeckBtn").addEventListener("click", createDeck);

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  document.getElementById("deckNameInput").value = sampleDeck.name;
  document.getElementById("deckCardsInput").value = sampleDeck.text;
});

document.getElementById("backToTeacherBtn").addEventListener("click", async () => {
  await loadTeacherDecks();
  showView("teacherView");
});

document.getElementById("refreshProgressBtn").addEventListener("click", loadProgressDashboard);

document.getElementById("startDeckBtn").addEventListener("click", openStudySetup);

document.getElementById("backToLandingBtn").addEventListener("click", () => {
  renderDeckLanding();
  showView("deckLandingView");
});

document.getElementById("revealBtn").addEventListener("click", revealAnswer);
document.getElementById("checkTypingBtn").addEventListener("click", checkTypingAnswer);

document.getElementById("typingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") checkTypingAnswer();
});

document.getElementById("exitStudyBtn").addEventListener("click", openStudySetup);
document.getElementById("studyAgainBtn").addEventListener("click", () => startStudy(state.studyMode));

document.getElementById("completeBackBtn").addEventListener("click", () => {
  renderDeckLanding();
  showView("deckLandingView");
});

window.addEventListener("popstate", () => routeApp());

initTheme();
initializeFirebase();
