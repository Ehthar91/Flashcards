import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.19.0";

const [
  appModule,
  authModule,
  firestoreModule
] = await Promise.all([
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
  orderBy,
  serverTimestamp,
  writeBatch
} = firestoreModule;

const THEME_KEY = "flashcards_cloud_theme";

const state = {
  app: null,
  auth: null,
  db: null,
  user: null,
  isAdmin: false,
  teacherClasses: [],
  studentClasses: [],
  selectedClass: null,
  selectedDeck: null,
  currentProgress: null,
  studyMode: "standard",
  sessionCards: [],
  sessionIndex: 0,
  sessionRatings: []
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
  const values = Object.values(firebaseConfig || {});
  return values.length > 0 && values.every(v => typeof v === "string" && v && !v.includes("PASTE_"));
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

  window.clearTimeout(showMessage._timer);
  if (timeout) {
    showMessage._timer = window.setTimeout(() => el.classList.add("hidden"), timeout);
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

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

function generateClassCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  crypto.getRandomValues(new Uint32Array(length)).forEach(n => {
    code += chars[n % chars.length];
  });
  return code;
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

function progressDocId(classId, deckId, studentId) {
  return `${classId}_${deckId}_${studentId}`;
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

function timestampToText(value) {
  if (!value) return "—";
  try {
    const d = value.toDate ? value.toDate() : new Date(value);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function setUserChip(user, role) {
  const chip = document.getElementById("userChip");
  const photo = document.getElementById("userPhoto");
  document.getElementById("userName").textContent = user.displayName || user.email || "User";
  document.getElementById("userRole").textContent = role;
  photo.src = user.photoURL || "";
  photo.classList.toggle("hidden", !user.photoURL);
  chip.classList.remove("hidden");
  document.getElementById("signOutBtn").classList.remove("hidden");
}

function clearUserChip() {
  document.getElementById("userChip").classList.add("hidden");
  document.getElementById("signOutBtn").classList.add("hidden");
}

async function ensureUserProfile() {
  const ref = doc(state.db, "users", state.user.uid);
  await setDoc(ref, {
    displayName: state.user.displayName || "",
    email: state.user.email || "",
    photoURL: state.user.photoURL || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function checkAdmin() {
  const snap = await getDoc(doc(state.db, "admins", state.user.uid));
  state.isAdmin = snap.exists();
  return state.isAdmin;
}

async function routeSignedInUser({ showPendingForNonAdmin = false } = {}) {
  await ensureUserProfile();
  const isAdmin = await checkAdmin();

  if (isAdmin) {
    setUserChip(state.user, "Teacher");
    await loadTeacherClasses();
    showView("teacherView");
  } else {
    setUserChip(state.user, "Student");
    if (showPendingForNonAdmin && !sessionStorage.getItem("flashcards_student_confirmed")) {
      document.getElementById("uidDisplay").textContent = state.user.uid;
      showView("accessPendingView");
    } else {
      await loadStudentClasses();
      showView("studentView");
    }
  }
}

async function loadTeacherClasses() {
  const q = query(
    collection(state.db, "classes"),
    where("teacherId", "==", state.user.uid)
  );
  const snap = await getDocs(q);
  state.teacherClasses = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  renderTeacherClasses();
}

function renderTeacherClasses() {
  const grid = document.getElementById("teacherClassGrid");
  if (!state.teacherClasses.length) {
    grid.innerHTML = `<div class="empty-state">No classes yet. Create your first class.</div>`;
    return;
  }

  grid.innerHTML = state.teacherClasses.map(c => `
    <article class="card class-card" data-teacher-class="${c.id}">
      <div>
        <span class="eyebrow">Class</span>
        <h3>${escapeHtml(c.name)}</h3>
        <p>Share this code with students.</p>
      </div>
      <div class="class-card-footer">
        <span class="code-pill">${escapeHtml(c.code)}</span>
        <span>Open →</span>
      </div>
    </article>
  `).join("");
}

async function createClass() {
  const nameInput = document.getElementById("classNameInput");
  const name = nameInput.value.trim();
  if (!name) return showMessage("Enter a class name.", "error");

  try {
    let code = "";
    let codeRef;
    for (let i = 0; i < 8; i++) {
      code = generateClassCode();
      codeRef = doc(state.db, "classCodes", code);
      const existing = await getDoc(codeRef);
      if (!existing.exists()) break;
      code = "";
    }

    if (!code) throw new Error("Could not generate a unique class code.");

    const classRef = doc(collection(state.db, "classes"));
    const batch = writeBatch(state.db);

    batch.set(classRef, {
      name,
      code,
      teacherId: state.user.uid,
      teacherName: state.user.displayName || state.user.email || "Teacher",
      createdAt: serverTimestamp()
    });

    batch.set(codeRef, {
      classId: classRef.id,
      createdAt: serverTimestamp()
    });

    await batch.commit();
    nameInput.value = "";
    document.getElementById("newClassPanel").classList.add("hidden");
    showMessage(`Class created. Code: ${code}`, "success");
    await loadTeacherClasses();
  } catch (err) {
    handleFirebaseError(err, "Could not create the class.");
  }
}

async function openTeacherClass(classId) {
  const snap = await getDoc(doc(state.db, "classes", classId));
  if (!snap.exists()) return showMessage("Class not found.", "error");

  state.selectedClass = { id: snap.id, ...snap.data() };
  document.getElementById("teacherClassTitle").textContent = state.selectedClass.name;
  document.getElementById("teacherClassCode").textContent = state.selectedClass.code;
  showView("teacherClassView");
  setTeacherTab("decks");
  await loadTeacherDecks();
}

async function loadTeacherDecks() {
  const snap = await getDocs(collection(state.db, "classes", state.selectedClass.id, "decks"));
  const decks = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  renderTeacherDecks(decks);
}

function renderTeacherDecks(decks) {
  const list = document.getElementById("teacherDeckList");
  if (!decks.length) {
    list.innerHTML = `<div class="empty-state">No decks yet. Create an assigned deck.</div>`;
    return;
  }

  list.innerHTML = decks.map(deck => `
    <article class="card deck-card">
      <div>
        <span class="eyebrow">${deck.published ? "Assigned" : "Draft"}</span>
        <h3>${escapeHtml(deck.name)}</h3>
        <p>${Array.isArray(deck.cards) ? deck.cards.length : 0} cards</p>
      </div>
      <div class="deck-card-footer">
        <span class="badge">${deck.published ? "Students can study" : "Hidden"}</span>
        <div class="deck-actions">
          <button class="secondary-btn" data-toggle-deck="${deck.id}" data-published="${deck.published ? "1" : "0"}">
            ${deck.published ? "Unassign" : "Assign"}
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
    await addDoc(collection(state.db, "classes", state.selectedClass.id, "decks"), {
      name,
      cards,
      published,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.user.uid
    });

    document.getElementById("deckNameInput").value = "";
    document.getElementById("deckCardsInput").value = "";
    document.getElementById("publishDeckInput").checked = true;
    document.getElementById("newDeckPanel").classList.add("hidden");
    showMessage(`Created "${name}" with ${cards.length} cards.`, "success");
    await loadTeacherDecks();
  } catch (err) {
    handleFirebaseError(err, "Could not create the deck.");
  }
}

async function toggleDeck(deckId, isPublished) {
  try {
    await updateDoc(doc(state.db, "classes", state.selectedClass.id, "decks", deckId), {
      published: !isPublished,
      updatedAt: serverTimestamp()
    });
    await loadTeacherDecks();
  } catch (err) {
    handleFirebaseError(err, "Could not update the deck.");
  }
}

async function deleteDeckById(deckId) {
  if (!confirm("Delete this deck? Existing student progress will remain in the database.")) return;
  try {
    await deleteDoc(doc(state.db, "classes", state.selectedClass.id, "decks", deckId));
    showMessage("Deck deleted.", "success");
    await loadTeacherDecks();
  } catch (err) {
    handleFirebaseError(err, "Could not delete the deck.");
  }
}

function setTeacherTab(name) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.teacherTab === name);
  });
  document.querySelectorAll(".teacher-tab").forEach(tab => tab.classList.remove("active"));
  document.getElementById(
    name === "decks" ? "teacherDecksTab" :
    name === "students" ? "teacherStudentsTab" : "teacherProgressTab"
  ).classList.add("active");

  if (name === "students") loadRoster();
  if (name === "progress") loadProgressDashboard();
}

async function loadRoster() {
  try {
    const snap = await getDocs(collection(state.db, "classes", state.selectedClass.id, "members"));
    const members = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));

    document.getElementById("studentCountBadge").textContent =
      `${members.length} student${members.length === 1 ? "" : "s"}`;

    const host = document.getElementById("studentRoster");
    if (!members.length) {
      host.innerHTML = `<div class="empty-state">No students have joined yet.</div>`;
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Student</th><th>Email</th><th>Joined</th></tr></thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td>${escapeHtml(m.displayName || "Student")}</td>
                <td>${escapeHtml(m.email || "—")}</td>
                <td>${timestampToText(m.joinedAt)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    handleFirebaseError(err, "Could not load the roster.");
  }
}

async function loadProgressDashboard() {
  const host = document.getElementById("progressTable");
  host.innerHTML = `<div class="empty-state">Loading progress…</div>`;

  try {
    const [memberSnap, deckSnap, progressSnap] = await Promise.all([
      getDocs(collection(state.db, "classes", state.selectedClass.id, "members")),
      getDocs(collection(state.db, "classes", state.selectedClass.id, "decks")),
      getDocs(query(
        collection(state.db, "progress"),
        where("classId", "==", state.selectedClass.id)
      ))
    ]);

    const members = new Map(memberSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const decks = new Map(deckSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    const progress = progressSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!progress.length) {
      host.innerHTML = `<div class="empty-state">No study progress yet. Progress appears after students rate cards.</div>`;
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Student</th><th>Deck</th><th>Studied</th><th>Average</th><th>Mastery</th><th>Last studied</th></tr>
          </thead>
          <tbody>
            ${progress
              .sort((a, b) => String(members.get(a.studentId)?.displayName || "").localeCompare(
                String(members.get(b.studentId)?.displayName || "")
              ))
              .map(p => {
                const s = progressStats(p);
                const member = members.get(p.studentId);
                const deck = decks.get(p.deckId);
                return `
                  <tr>
                    <td>${escapeHtml(member?.displayName || member?.email || "Student")}</td>
                    <td>${escapeHtml(deck?.name || p.deckName || "Deck")}</td>
                    <td>${s.studied}</td>
                    <td>${s.avg.toFixed(1)} / 5</td>
                    <td>${s.mastery}%</td>
                    <td>${timestampToText(p.updatedAt)}</td>
                  </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    handleFirebaseError(err, "Could not load progress.");
    host.innerHTML = `<div class="empty-state">Progress could not be loaded.</div>`;
  }
}

async function loadStudentClasses() {
  try {
    const refsSnap = await getDocs(collection(state.db, "users", state.user.uid, "classes"));
    const classes = [];

    for (const refDoc of refsSnap.docs) {
      const classId = refDoc.data().classId || refDoc.id;
      try {
        const classSnap = await getDoc(doc(state.db, "classes", classId));
        if (classSnap.exists()) classes.push({ id: classSnap.id, ...classSnap.data() });
      } catch (_) {}
    }

    state.studentClasses = classes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    renderStudentClasses();
  } catch (err) {
    handleFirebaseError(err, "Could not load your classes.");
  }
}

function renderStudentClasses() {
  const grid = document.getElementById("studentClassGrid");
  if (!state.studentClasses.length) {
    grid.innerHTML = `<div class="empty-state">You have not joined a class yet.</div>`;
    return;
  }

  grid.innerHTML = state.studentClasses.map(c => `
    <article class="card class-card" data-student-class="${c.id}">
      <div>
        <span class="eyebrow">Class</span>
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(c.teacherName || "Teacher")}</p>
      </div>
      <div class="class-card-footer">
        <span class="badge">${escapeHtml(c.code || "")}</span>
        <span>Open →</span>
      </div>
    </article>
  `).join("");
}

async function joinClass() {
  const input = document.getElementById("joinCodeInput");
  const code = normalizeCode(input.value);
  input.value = code;

  if (code.length < 4) return showMessage("Enter the class code from your teacher.", "error");

  try {
    const codeSnap = await getDoc(doc(state.db, "classCodes", code));
    if (!codeSnap.exists()) return showMessage("That class code was not found.", "error");

    const classId = codeSnap.data().classId;
    const memberRef = doc(state.db, "classes", classId, "members", state.user.uid);
    const userClassRef = doc(state.db, "users", state.user.uid, "classes", classId);

    const existing = await getDoc(memberRef);
    if (!existing.exists()) {
      const batch = writeBatch(state.db);
      batch.set(memberRef, {
        studentId: state.user.uid,
        displayName: state.user.displayName || "",
        email: state.user.email || "",
        joinCode: code,
        joinedAt: serverTimestamp()
      });
      batch.set(userClassRef, {
        classId,
        joinedAt: serverTimestamp()
      });
      await batch.commit();
    } else {
      await setDoc(userClassRef, { classId, joinedAt: serverTimestamp() }, { merge: true });
    }

    input.value = "";
    document.getElementById("joinClassPanel").classList.add("hidden");
    showMessage("Class joined.", "success");
    await loadStudentClasses();
  } catch (err) {
    handleFirebaseError(err, "Could not join this class.");
  }
}

async function openStudentClass(classId) {
  try {
    const snap = await getDoc(doc(state.db, "classes", classId));
    if (!snap.exists()) return showMessage("Class not found.", "error");

    state.selectedClass = { id: snap.id, ...snap.data() };
    document.getElementById("studentClassTitle").textContent = state.selectedClass.name;
    showView("studentClassView");
    await loadStudentDecks();
  } catch (err) {
    handleFirebaseError(err, "Could not open the class.");
  }
}

async function loadStudentDecks() {
  try {
    // Security Rules require the query to match the published-only access condition.
    const q = query(
      collection(state.db, "classes", state.selectedClass.id, "decks"),
      where("published", "==", true)
    );
    const snap = await getDocs(q);
    const decks = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const list = document.getElementById("studentDeckList");
    if (!decks.length) {
      list.innerHTML = `<div class="empty-state">Your teacher has not assigned a deck yet.</div>`;
      return;
    }

    const progressDocs = await Promise.all(decks.map(async deck => {
      const pSnap = await getDoc(doc(state.db, "progress", progressDocId(state.selectedClass.id, deck.id, state.user.uid)));
      return pSnap.exists() ? pSnap.data() : null;
    }));

    list.innerHTML = decks.map((deck, index) => {
      const stats = progressStats(progressDocs[index]);
      return `
        <article class="card deck-card" data-student-deck="${deck.id}">
          <div>
            <span class="eyebrow">Assigned deck</span>
            <h3>${escapeHtml(deck.name)}</h3>
            <p>${deck.cards?.length || 0} cards</p>
          </div>
          <div class="deck-card-footer">
            <span class="badge">${stats.mastery}% mastery</span>
            <span>Study →</span>
          </div>
        </article>`;
    }).join("");

    state._studentDeckCache = new Map(decks.map(d => [d.id, d]));
  } catch (err) {
    handleFirebaseError(err, "Could not load assigned decks.");
  }
}

async function openStudySetup(deckId) {
  let deck = state._studentDeckCache?.get(deckId);

  if (!deck) {
    const snap = await getDoc(doc(state.db, "classes", state.selectedClass.id, "decks", deckId));
    if (!snap.exists()) return;
    deck = { id: snap.id, ...snap.data() };
  }

  state.selectedDeck = deck;

  const pRef = doc(state.db, "progress", progressDocId(state.selectedClass.id, deck.id, state.user.uid));
  const pSnap = await getDoc(pRef);
  state.currentProgress = pSnap.exists()
    ? { id: pSnap.id, ...pSnap.data() }
    : {
        id: pRef.id,
        classId: state.selectedClass.id,
        deckId: deck.id,
        deckName: deck.name,
        studentId: state.user.uid,
        studied: 0,
        ratingCount: 0,
        ratingTotal: 0,
        cards: {}
      };

  const stats = progressStats(state.currentProgress);
  document.getElementById("setupDeckTitle").textContent = deck.name;
  document.getElementById("setupCardCount").textContent = deck.cards?.length || 0;
  document.getElementById("setupMastery").textContent = `${stats.mastery}%`;
  document.getElementById("setupStudied").textContent = stats.studied;
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
  const p = state.currentProgress;
  p.cards = p.cards || {};
  const cp = p.cards[card.id] || { count: 0, total: 0, seen: 0 };

  cp.count += 1;
  cp.total += rating;
  cp.seen += 1;
  p.cards[card.id] = cp;
  p.studied = Number(p.studied || 0) + 1;
  p.ratingCount = Number(p.ratingCount || 0) + 1;
  p.ratingTotal = Number(p.ratingTotal || 0) + rating;

  state.sessionRatings.push(rating);

  try {
    await setDoc(doc(state.db, "progress", p.id), {
      classId: state.selectedClass.id,
      deckId: state.selectedDeck.id,
      deckName: state.selectedDeck.name,
      studentId: state.user.uid,
      studied: p.studied,
      ratingCount: p.ratingCount,
      ratingTotal: p.ratingTotal,
      cards: p.cards,
      updatedAt: serverTimestamp()
    }, { merge: true });

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

function handleFirebaseError(err, fallback) {
  console.error(err);
  let message = fallback;

  if (err?.code === "permission-denied") {
    message = "Firebase blocked this request. Check your Firestore security rules and account access.";
  } else if (err?.code === "auth/popup-blocked") {
    message = "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
  } else if (err?.code === "auth/unauthorized-domain") {
    message = "This website domain is not authorized in Firebase Authentication settings.";
  } else if (err?.message) {
    message = `${fallback} ${err.message}`;
  }

  showMessage(message, "error", 7000);
}

function initTheme() {
  if (localStorage.getItem(THEME_KEY) === "dark") document.body.classList.add("dark");
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "dark" : "light");
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
      if (!user) {
        state.isAdmin = false;
        clearUserChip();
        showView("loginView");
        return;
      }

      try {
        await routeSignedInUser({ showPendingForNonAdmin: true });
      } catch (err) {
        handleFirebaseError(err, "Could not load your Flashcards account.");
      }
    });
  } catch (err) {
    console.error(err);
    showView("setupView");
    showMessage("Firebase could not initialize. Check firebase-config.js.", "error", 0);
  }
}

document.addEventListener("click", async e => {
  const teacherClass = e.target.closest("[data-teacher-class]");
  if (teacherClass) return openTeacherClass(teacherClass.dataset.teacherClass);

  const studentClass = e.target.closest("[data-student-class]");
  if (studentClass) return openStudentClass(studentClass.dataset.studentClass);

  const studentDeck = e.target.closest("[data-student-deck]");
  if (studentDeck) return openStudySetup(studentDeck.dataset.studentDeck);

  const mode = e.target.closest("[data-mode]");
  if (mode) return startStudy(mode.dataset.mode);

  const rating = e.target.closest("[data-rating]");
  if (rating) return rateCurrentCard(rating.dataset.rating);

  const toggle = e.target.closest("[data-toggle-deck]");
  if (toggle) return toggleDeck(toggle.dataset.toggleDeck, toggle.dataset.published === "1");

  const remove = e.target.closest("[data-delete-deck]");
  if (remove) return deleteDeckById(remove.dataset.deleteDeck);

  const tab = e.target.closest("[data-teacher-tab]");
  if (tab) return setTeacherTab(tab.dataset.teacherTab);
});

document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(state.auth, provider);
  } catch (err) {
    handleFirebaseError(err, "Google sign-in failed.");
  }
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  sessionStorage.removeItem("flashcards_student_confirmed");
  await signOut(state.auth);
});

document.getElementById("continueStudentBtn").addEventListener("click", async () => {
  sessionStorage.setItem("flashcards_student_confirmed", "1");
  await loadStudentClasses();
  showView("studentView");
});

document.getElementById("refreshRoleBtn").addEventListener("click", async () => {
  try {
    if (await checkAdmin()) {
      setUserChip(state.user, "Teacher");
      await loadTeacherClasses();
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

document.getElementById("brandHomeBtn").addEventListener("click", async () => {
  if (!state.user) return showView("loginView");
  if (state.isAdmin) {
    await loadTeacherClasses();
    showView("teacherView");
  } else {
    await loadStudentClasses();
    showView("studentView");
  }
});

document.getElementById("newClassToggleBtn").addEventListener("click", () => {
  document.getElementById("newClassPanel").classList.toggle("hidden");
});
document.getElementById("closeClassPanelBtn").addEventListener("click", () => {
  document.getElementById("newClassPanel").classList.add("hidden");
});
document.getElementById("createClassBtn").addEventListener("click", createClass);

document.getElementById("backTeacherBtn").addEventListener("click", async () => {
  await loadTeacherClasses();
  showView("teacherView");
});

document.getElementById("teacherClassCode").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.selectedClass.code);
  showMessage("Class code copied.", "success");
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
document.getElementById("refreshProgressBtn").addEventListener("click", loadProgressDashboard);

document.getElementById("joinClassToggleBtn").addEventListener("click", () => {
  document.getElementById("joinClassPanel").classList.toggle("hidden");
  setTimeout(() => document.getElementById("joinCodeInput").focus(), 0);
});
document.getElementById("joinCodeInput").addEventListener("input", e => {
  e.target.value = normalizeCode(e.target.value);
});
document.getElementById("joinCodeInput").addEventListener("keydown", e => {
  if (e.key === "Enter") joinClass();
});
document.getElementById("joinClassBtn").addEventListener("click", joinClass);

document.getElementById("backStudentBtn").addEventListener("click", async () => {
  await loadStudentClasses();
  showView("studentView");
});

document.getElementById("backClassBtn").addEventListener("click", async () => {
  showView("studentClassView");
  await loadStudentDecks();
});

document.getElementById("revealBtn").addEventListener("click", revealAnswer);
document.getElementById("checkTypingBtn").addEventListener("click", checkTypingAnswer);
document.getElementById("typingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") checkTypingAnswer();
});
document.getElementById("exitStudyBtn").addEventListener("click", () => openStudySetup(state.selectedDeck.id));
document.getElementById("studyAgainBtn").addEventListener("click", () => startStudy(state.studyMode));
document.getElementById("completeBackBtn").addEventListener("click", async () => {
  showView("studentClassView");
  await loadStudentDecks();
});

initTheme();
initializeFirebase();
