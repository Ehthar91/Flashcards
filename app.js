import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.19.0";
const THEME_KEY = "flashcards_brainscape_theme";

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
  reauthenticateWithPopup,
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
  ownedClasses: [],
  sharedClasses: [],
  selectedClass: null,
  decks: [],
  progressMap: new Map(),
  selectedDeck: null,
  editingDeckId: null,
  studyMode: "standard",
  studyScope: "deck",
  sessionCards: [],
  sessionIndex: 0,
  sessionRatings: [],
  studyOrder: "progressive",
  pendingStudy: null,
  pendingQuiz: null,
  quizConfig: {
    questionStyle: "standard",
    template: "What is the answer for {term}?",
    direction: "frontBack",
    answerMode: "multiple",
    order: "progressive",
    points: 1
  },
  quizQuestions: [],
  quizIndex: 0,
  quizScore: 0,
  quizResults: [],
  quizAnswered: false
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

function showMessage(message, type = "", timeout = 4500) {
  const el = document.getElementById("globalMessage");
  el.textContent = message;
  el.className = `global-message ${type}`.trim();
  el.classList.remove("hidden");

  clearTimeout(showMessage._timer);
  if (timeout) {
    showMessage._timer = setTimeout(() => el.classList.add("hidden"), timeout);
  }
}

function showTopView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

function showPanel(id) {
  document.querySelectorAll(".panel-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
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

function cardsToText(cards = []) {
  return cards.map(card => `${card.front} = ${card.back}`).join("\n");
}

function normalizeText(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function shuffledCopy(items) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function classParam() {
  return new URL(window.location.href).searchParams.get("class");
}

function buildClassShareLink(classId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("class", classId);
  return url.toString();
}

function clearClassParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("class");
  history.replaceState({}, "", url);
}

function isOwner() {
  return Boolean(state.selectedClass && state.user && state.selectedClass.ownerId === state.user.uid);
}

function progressDocId(classId, deckId, studentId) {
  return `${classId}_${deckId}_${studentId}`;
}

function progressStats(progress) {
  if (!progress) {
    return { studied: 0, unique: 0, ratingCount: 0, ratingTotal: 0, avg: 0, mastery: 0 };
  }

  const ratingCount = Number(progress.ratingCount || 0);
  const ratingTotal = Number(progress.ratingTotal || 0);
  const avg = ratingCount ? ratingTotal / ratingCount : 0;

  return {
    studied: Number(progress.studied || 0),
    unique: Object.keys(progress.cards || {}).length,
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
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function classCardCount() {
  return state.decks.reduce((sum, d) => sum + (d.cards?.length || 0), 0);
}

function currentClassStats() {
  let studied = 0;
  let unique = 0;
  let totalRatings = 0;
  let ratingCount = 0;

  for (const deck of state.decks) {
    const p = state.progressMap.get(deck.id);
    const s = progressStats(p);
    studied += s.studied;
    unique += s.unique;
    totalRatings += s.ratingTotal;
    ratingCount += s.ratingCount;
  }

  const avg = ratingCount ? totalRatings / ratingCount : 0;
  return {
    studied,
    unique,
    mastery: Math.round((avg / 5) * 100)
  };
}

function openModal(id) {
  document.getElementById("modalBackdrop").classList.remove("hidden");
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function closeModals() {
  document.getElementById("modalBackdrop").classList.add("hidden");
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
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

async function ensureUserProfile() {
  await setDoc(doc(state.db, "users", state.user.uid), {
    displayName: state.user.displayName || "",
    email: state.user.email || "",
    photoURL: state.user.photoURL || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function renderUser() {
  document.getElementById("sidebarName").textContent =
    state.user.displayName?.split(" ")[0] || state.user.email || "User";

  const photo = document.getElementById("sidebarPhoto");
  if (state.user.photoURL) {
    photo.src = state.user.photoURL;
    photo.classList.remove("hidden");
  } else {
    photo.removeAttribute("src");
  }
}

async function routeAfterAuth() {
  if (!state.user) {
    const inviteId = classParam();

    if (inviteId) {
      try {
        const snap = await getDoc(doc(state.db, "classes", inviteId));
        if (snap.exists() && snap.data().published === true) {
          document.getElementById("sharedClassSignInTitle").textContent =
            snap.data().name || "A class was shared with you.";
          showTopView("sharedSignInView");
          return;
        }
      } catch (_) {}
    }

    showTopView("loginView");
    return;
  }

  await ensureUserProfile();
  renderUser();
  showTopView("appView");

  const inviteId = classParam();
  if (inviteId) {
    await acceptSharedClass(inviteId);
    return;
  }

  await loadLibrary();
  showPanel("libraryView");
}

async function loadLibrary() {
  await Promise.all([loadOwnedClasses(), loadSharedClasses(), loadSidebarStats()]);
  renderSidebar();
  renderLibrary();
}

async function loadOwnedClasses() {
  const q = query(
    collection(state.db, "classes"),
    where("ownerId", "==", state.user.uid)
  );

  const snap = await getDocs(q);
  state.ownedClasses = snap.docs
    .map(d => ({ id: d.id, ...d.data(), libraryType: "owned" }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function loadSharedClasses() {
  const refs = await getDocs(collection(state.db, "users", state.user.uid, "library"));
  const classes = [];

  for (const refSnap of refs.docs) {
    const data = refSnap.data();

    try {
      const cSnap = await getDoc(doc(state.db, "classes", data.classId || refSnap.id));

      if (cSnap.exists()) {
        const c = { id: cSnap.id, ...cSnap.data(), libraryType: "shared" };

        if (c.ownerId !== state.user.uid) {
          classes.push(c);
        }
      }
    } catch (_) {}
  }

  state.sharedClasses = classes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function loadSidebarStats() {
  try {
    const q = query(
      collection(state.db, "progress"),
      where("studentId", "==", state.user.uid)
    );

    const snap = await getDocs(q);
    const rows = snap.docs.map(d => d.data());

    let studied = 0;
    let ratingTotal = 0;
    let ratingCount = 0;

    for (const p of rows) {
      studied += Number(p.studied || 0);
      ratingTotal += Number(p.ratingTotal || 0);
      ratingCount += Number(p.ratingCount || 0);
    }

    const mastery = ratingCount ? Math.round(((ratingTotal / ratingCount) / 5) * 100) : 0;

    document.getElementById("sidebarClassCount").textContent =
      state.ownedClasses.length + state.sharedClasses.length;
    document.getElementById("sidebarStudied").textContent = studied;
    document.getElementById("sidebarMastery").textContent = `${mastery}%`;
  } catch {
    document.getElementById("sidebarClassCount").textContent =
      state.ownedClasses.length + state.sharedClasses.length;
  }
}

function renderSidebar() {
  const classes = [...state.ownedClasses, ...state.sharedClasses];
  const host = document.getElementById("classSidebarList");

  if (!classes.length) {
    host.innerHTML = `<div style="padding:20px 24px;color:#9fb3c8;font-size:.8rem;">No classes yet.</div>`;
    return;
  }

  host.innerHTML = classes.map(c => `
    <button class="sidebar-class-item ${state.selectedClass?.id === c.id ? "active" : ""}" data-sidebar-class="${c.id}">
      <span class="sidebar-stack-icon"><span></span></span>
      <span class="sidebar-class-copy">
        <strong>${escapeHtml(c.name)}</strong>
        <small>${c.libraryType === "owned" ? "Owner" : "Study access"}</small>
      </span>
    </button>
  `).join("");
}

function renderLibrary() {
  document.getElementById("ownedClassCount").textContent = state.ownedClasses.length;
  document.getElementById("sharedClassCount").textContent = state.sharedClasses.length;

  const owned = document.getElementById("ownedClassCards");
  const shared = document.getElementById("sharedClassCards");

  owned.innerHTML = state.ownedClasses.length
    ? state.ownedClasses.map(c => classCardMarkup(c, true)).join("")
    : `<div class="empty-state">Create your first class.</div>`;

  shared.innerHTML = state.sharedClasses.length
    ? state.sharedClasses.map(c => classCardMarkup(c, false)).join("")
    : `<div class="empty-state">Classes shared with you will appear here.</div>`;
}

function classCardMarkup(c, owned) {
  return `
    <article class="class-card" data-library-class="${c.id}">
      <span class="eyebrow">${owned ? "Owner" : "Study access"}</span>
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.intro || (owned ? "Your class" : `by ${c.ownerName || "Owner"}`))}</p>
      <div class="class-card-bottom">
        <span>${owned ? (c.published ? "Sharing enabled" : "Private") : `by ${escapeHtml(c.ownerName || "Owner")}`}</span>
        <strong>Open →</strong>
      </div>
    </article>
  `;
}

async function createClass() {
  const name = document.getElementById("newClassName").value.trim();
  const intro = document.getElementById("newClassIntro").value.trim();
  const published = document.getElementById("newClassPublished").checked;

  if (!name) {
    showMessage("Enter a class name.", "error");
    return;
  }

  try {
    const ref = await addDoc(collection(state.db, "classes"), {
      name,
      intro,
      ownerId: state.user.uid,
      ownerName: state.user.displayName || state.user.email || "Owner",
      published,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    document.getElementById("newClassName").value = "";
    document.getElementById("newClassIntro").value = "";
    document.getElementById("newClassPublished").checked = true;
    closeModals();

    await loadLibrary();
    await openClass(ref.id);

    if (published) {
      await copyClassLink(ref.id);
      showMessage("Class created. Share link copied.", "success");
    } else {
      showMessage("Class created.", "success");
    }
  } catch (err) {
    handleFirebaseError(err, "Could not create the class.");
  }
}

async function acceptSharedClass(classId) {
  try {
    const snap = await getDoc(doc(state.db, "classes", classId));

    if (!snap.exists()) {
      clearClassParam();
      showMessage("This class no longer exists.", "error");
      await loadLibrary();
      showPanel("libraryView");
      return;
    }

    const c = { id: snap.id, ...snap.data() };

    if (c.ownerId !== state.user.uid) {
      if (!c.published) {
        clearClassParam();
        showMessage("This class link is no longer active.", "error");
        await loadLibrary();
        showPanel("libraryView");
        return;
      }

      await setDoc(doc(state.db, "users", state.user.uid, "library", c.id), {
        classId: c.id,
        className: c.name,
        ownerId: c.ownerId,
        access: "study",
        addedAt: serverTimestamp()
      }, { merge: true });

      showMessage(`"${c.name}" was added to My Flashcards.`, "success");
    }

    clearClassParam();
    await loadLibrary();
    await openClass(c.id);
  } catch (err) {
    handleFirebaseError(err, "Could not add this class.");
  }
}

async function openClass(classId) {
  try {
    const snap = await getDoc(doc(state.db, "classes", classId));

    if (!snap.exists()) {
      showMessage("Class not found.", "error");
      return;
    }

    state.selectedClass = { id: snap.id, ...snap.data() };

    await Promise.all([loadDecks(), loadCurrentUserProgress()]);
    renderSidebar();
    renderClass();
    showPanel("classView");
    setTab("decks");
  } catch (err) {
    handleFirebaseError(err, "Could not open this class.");
  }
}

async function loadDecks() {
  const decksRef = collection(state.db, "classes", state.selectedClass.id, "decks");

  // Owners see every deck, including hidden drafts.
  // Students query only decks that are explicitly visible.
  const source = isOwner()
    ? decksRef
    : query(decksRef, where("published", "==", true));

  const snap = await getDocs(source);

  state.decks = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ao = Number(a.order ?? 99999);
      const bo = Number(b.order ?? 99999);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name));
    });
}

async function loadCurrentUserProgress() {
  const q = query(
    collection(state.db, "progress"),
    where("studentId", "==", state.user.uid)
  );

  const snap = await getDocs(q);
  const map = new Map();

  for (const d of snap.docs) {
    const p = { id: d.id, ...d.data() };
    if (p.classId === state.selectedClass.id) {
      map.set(p.deckId, p);
    }
  }

  state.progressMap = map;
}

function renderClass() {
  const owner = isOwner();
  const stats = currentClassStats();
  const totalCards = classCardCount();

  document.getElementById("classTitle").textContent = state.selectedClass.name;
  document.getElementById("classOwnerName").textContent = state.selectedClass.ownerName || "Owner";
  document.getElementById("classCardsStudied").textContent = `${stats.unique} of ${totalCards}`;
  document.getElementById("classDeckCount").textContent = state.decks.length;
  document.getElementById("classMastery").textContent = `${stats.mastery}%`;
  document.getElementById("masteryRing").style.setProperty("--mastery", stats.mastery);

  document.getElementById("tabDeckCount").textContent = `(${state.decks.length})`;
  document.getElementById("introClassTitle").textContent = state.selectedClass.name;
  document.getElementById("introText").textContent =
    state.selectedClass.intro || "No introduction has been added yet.";

  document.getElementById("editClassBtn").classList.toggle("hidden", !owner);
  document.getElementById("shareClassBtn").classList.toggle("hidden", !owner);
  document.getElementById("ownerDeckTools").classList.toggle("hidden", !owner);
  document.getElementById("editIntroBtn").classList.toggle("hidden", !owner);
  document.getElementById("refreshLearnersBtn").classList.toggle("hidden", !owner);
  document.getElementById("removeSharedClassBtn").classList.toggle("hidden", owner);

  document.getElementById("shareClassBtn").disabled = owner && !state.selectedClass.published;
  document.getElementById("studyClassBtn").disabled = state.decks.length === 0;
  document.getElementById("quizClassBtn").disabled = state.decks.length === 0;

  renderDeckRows();

  // Shared users see only their own learner count conceptually; owner count is loaded on Learners tab.
  document.getElementById("tabLearnerCount").textContent = owner ? "(…)" : "";
}

function renderDeckRows() {
  const host = document.getElementById("deckRows");
  const owner = isOwner();

  if (!state.decks.length) {
    host.innerHTML = `
      <div class="empty-state">
        ${owner ? "No decks yet. Create the first deck for this class." : "The owner has not added any decks yet."}
      </div>`;
    return;
  }

  host.innerHTML = state.decks.map(deck => {
    const s = progressStats(state.progressMap.get(deck.id));
    const total = deck.cards?.length || 0;
    const uniquePct = total ? Math.min(100, Math.round((s.unique / total) * 100)) : 0;

    return `
      <article class="deck-row">
        <div class="deck-percent">
          <span class="check-circle">✓</span>
          <strong>${s.mastery}%</strong>
        </div>

        <div class="deck-main">
          <h3>
            ${escapeHtml(deck.name)}
            ${owner ? `
              <span class="deck-status-badge ${deck.published === false ? "hidden" : "visible"}">
                ${deck.published === false ? "Hidden" : "Visible"}
              </span>
            ` : ""}
          </h3>
          <div class="deck-progress-copy">
            <span>${s.unique} of ${total} unique cards studied</span>
          </div>
          <div class="deck-progress-track">
            <span style="width:${uniquePct}%"></span>
          </div>
        </div>

        <div class="deck-actions-row">
          ${owner ? `
            <div class="deck-owner-tools">
              <button
                class="deck-action-btn visibility-toggle"
                data-toggle-deck-visibility="${deck.id}"
                title="${deck.published === false ? "Make visible to students" : "Hide from students"}"
              >
                ${deck.published === false ? "Show" : "Hide"}
              </button>
              <button class="deck-action-btn" data-edit-deck="${deck.id}" title="Edit deck">✎</button>
            </div>
          ` : ""}
          <div class="deck-primary-actions">
            <button class="deck-quiz" data-quiz-deck="${deck.id}" title="Quiz">Quiz ?</button>
            <button class="deck-play" data-study-deck="${deck.id}" title="Study">▶</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function setTab(name) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  document.getElementById("introTab").classList.toggle("hidden", name !== "intro");
  document.getElementById("decksTab").classList.toggle("hidden", name !== "decks");
  document.getElementById("learnersTab").classList.toggle("hidden", name !== "learners");

  if (name === "learners") {
    loadLearners();
  }
}

function openEditClass() {
  if (!isOwner()) return;

  document.getElementById("editClassName").value = state.selectedClass.name;
  document.getElementById("editClassIntro").value = state.selectedClass.intro || "";
  document.getElementById("editClassPublished").checked = Boolean(state.selectedClass.published);
  openModal("editClassModal");
}

async function saveClassChanges() {
  if (!isOwner()) return;

  const name = document.getElementById("editClassName").value.trim();
  const intro = document.getElementById("editClassIntro").value.trim();
  const published = document.getElementById("editClassPublished").checked;

  if (!name) {
    showMessage("Enter a class name.", "error");
    return;
  }

  try {
    await updateDoc(doc(state.db, "classes", state.selectedClass.id), {
      name,
      intro,
      published,
      updatedAt: serverTimestamp()
    });

    state.selectedClass = { ...state.selectedClass, name, intro, published };
    closeModals();
    await loadLibrary();
    await openClass(state.selectedClass.id);
    showMessage("Class updated.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not update the class.");
  }
}

async function copyClassLink(classId = state.selectedClass?.id) {
  if (!classId) return;

  const c = state.ownedClasses.find(x => x.id === classId) || state.selectedClass;

  if (c && c.published === false) {
    showMessage("Turn class sharing on before copying the link.", "error");
    return;
  }

  const link = buildClassShareLink(classId);

  try {
    await navigator.clipboard.writeText(link);
    showMessage("Class link copied. Paste it into Google Classroom.", "success");
  } catch {
    window.prompt("Copy this class link:", link);
  }
}

async function removeSharedClass() {
  if (isOwner()) return;

  try {
    await deleteDoc(doc(state.db, "users", state.user.uid, "library", state.selectedClass.id));
    state.selectedClass = null;
    await loadLibrary();
    showPanel("libraryView");
    showMessage("Class removed from My Flashcards.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not remove the class.");
  }
}

function openNewDeck() {
  if (!isOwner()) return;
  document.getElementById("newDeckName").value = "";
  document.getElementById("newDeckCards").value = "";
  document.getElementById("newDeckPublished").checked = true;
  openModal("newDeckModal");
}

async function createDeck() {
  if (!isOwner()) return;

  const name = document.getElementById("newDeckName").value.trim();
  const cards = parsePairs(document.getElementById("newDeckCards").value);
  const published = document.getElementById("newDeckPublished").checked;

  if (!name) {
    showMessage("Enter a deck name.", "error");
    return;
  }

  if (!cards.length) {
    showMessage("Add at least one valid card.", "error");
    return;
  }

  try {
    await addDoc(collection(state.db, "classes", state.selectedClass.id, "decks"), {
      name,
      cards,
      published,
      order: state.decks.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    closeModals();
    await openClass(state.selectedClass.id);
    showMessage(
      published
        ? "Deck created and visible to students."
        : "Deck created as hidden. Students will not see it yet.",
      "success"
    );
  } catch (err) {
    handleFirebaseError(err, "Could not create the deck.");
  }
}

function openEditDeck(deckId) {
  if (!isOwner()) return;

  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  state.editingDeckId = deckId;
  document.getElementById("editDeckName").value = deck.name;
  document.getElementById("editDeckCards").value = cardsToText(deck.cards);
  document.getElementById("editDeckPublished").checked = deck.published !== false;
  openModal("editDeckModal");
}

async function saveDeckChanges() {
  if (!isOwner() || !state.editingDeckId) return;

  const name = document.getElementById("editDeckName").value.trim();
  const cards = parsePairs(document.getElementById("editDeckCards").value);
  const published = document.getElementById("editDeckPublished").checked;

  if (!name) {
    showMessage("Enter a deck name.", "error");
    return;
  }

  if (!cards.length) {
    showMessage("Add at least one valid card.", "error");
    return;
  }

  try {
    await updateDoc(
      doc(state.db, "classes", state.selectedClass.id, "decks", state.editingDeckId),
      {
        name,
        cards,
        published,
        updatedAt: serverTimestamp()
      }
    );

    closeModals();
    await openClass(state.selectedClass.id);
    showMessage("Deck updated for everyone following this class.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not update the deck.");
  }
}

async function toggleDeckVisibility(deckId) {
  if (!isOwner()) return;

  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  const nextPublished = deck.published === false;

  try {
    await updateDoc(
      doc(state.db, "classes", state.selectedClass.id, "decks", deckId),
      {
        published: nextPublished,
        updatedAt: serverTimestamp()
      }
    );

    await openClass(state.selectedClass.id);

    showMessage(
      nextPublished
        ? `"${deck.name}" is now visible to students.`
        : `"${deck.name}" is hidden from students.`,
      "success"
    );
  } catch (err) {
    handleFirebaseError(err, "Could not change deck visibility.");
  }
}

async function deleteCurrentDeck() {
  if (!isOwner() || !state.editingDeckId) return;

  if (!confirm("Delete this deck? It will disappear for everyone following the class.")) {
    return;
  }

  try {
    await deleteDoc(
      doc(state.db, "classes", state.selectedClass.id, "decks", state.editingDeckId)
    );

    closeModals();
    await openClass(state.selectedClass.id);
    showMessage("Deck deleted.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not delete the deck.");
  }
}

async function loadLearners() {
  const host = document.getElementById("learnersContent");

  if (!isOwner()) {
    const rows = [];

    for (const deck of state.decks) {
      const s = progressStats(state.progressMap.get(deck.id));
      const rawProgress = state.progressMap.get(deck.id);
      rows.push({
        deck: deck.name,
        studied: s.studied,
        unique: s.unique,
        total: deck.cards?.length || 0,
        mastery: s.mastery,
        quizAnswered: Number(rawProgress?.quizAnswered || 0),
        quizCorrect: Number(rawProgress?.quizCorrect || 0)
      });
    }

    document.getElementById("tabLearnerCount").textContent = "";

    host.innerHTML = rows.length
      ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Deck</th><th>Unique Studied</th><th>Total Reviews</th><th>Mastery</th><th>Quiz</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${escapeHtml(r.deck)}</td>
                  <td>${r.unique} of ${r.total}</td>
                  <td>${r.studied}</td>
                  <td>${r.mastery}%</td>
                  <td>${r.quizAnswered ? `${Math.round((r.quizCorrect / r.quizAnswered) * 100)}% (${r.quizCorrect}/${r.quizAnswered})` : "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`
      : `<div class="empty-state">No progress yet.</div>`;

    return;
  }

  host.innerHTML = `<div class="empty-state">Loading learners…</div>`;

  try {
    const q = query(
      collection(state.db, "progress"),
      where("classId", "==", state.selectedClass.id)
    );

    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.studentId !== state.user.uid);

    const byStudent = new Map();

    for (const p of docs) {
      const key = p.studentId;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          studentId: key,
          name: p.studentName || "Student",
          email: p.studentEmail || "",
          studied: 0,
          ratingTotal: 0,
          ratingCount: 0,
          quizAnswered: 0,
          quizCorrect: 0,
          uniqueKeys: new Set(),
          updatedAt: p.updatedAt
        });
      }

      const row = byStudent.get(key);
      row.studied += Number(p.studied || 0);
      row.ratingTotal += Number(p.ratingTotal || 0);
      row.ratingCount += Number(p.ratingCount || 0);
      row.quizAnswered += Number(p.quizAnswered || 0);
      row.quizCorrect += Number(p.quizCorrect || 0);

      Object.keys(p.cards || {}).forEach(cardId => {
        row.uniqueKeys.add(`${p.deckId}:${cardId}`);
      });

      if (p.updatedAt) {
        row.updatedAt = p.updatedAt;
      }
    }

    const learners = [...byStudent.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    document.getElementById("tabLearnerCount").textContent = `(${learners.length})`;

    if (!learners.length) {
      host.innerHTML = `<div class="empty-state">No learners have studied this class yet.</div>`;
      return;
    }

    host.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Learner</th>
              <th>Email</th>
              <th>Unique Cards</th>
              <th>Total Reviews</th>
              <th>Mastery</th>
              <th>Quiz</th>
              <th>Last Studied</th>
            </tr>
          </thead>
          <tbody>
            ${learners.map(l => {
              const avg = l.ratingCount ? l.ratingTotal / l.ratingCount : 0;
              const mastery = Math.round((avg / 5) * 100);

              return `
                <tr>
                  <td>${escapeHtml(l.name)}</td>
                  <td>${escapeHtml(l.email || "—")}</td>
                  <td>${l.uniqueKeys.size}</td>
                  <td>${l.studied}</td>
                  <td>${mastery}%</td>
                  <td>${l.quizAnswered ? `${Math.round((l.quizCorrect / l.quizAnswered) * 100)}% (${l.quizCorrect}/${l.quizAnswered})` : "—"}</td>
                  <td>${timestampToText(l.updatedAt)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    host.innerHTML = `<div class="empty-state">Learners could not be loaded.</div>`;
    handleFirebaseError(err, "Could not load learners.");
  }
}

function chooseStudyOrder(scope, deckId = null) {
  let targetName = state.selectedClass?.name || "Class";

  if (scope === "deck") {
    const deck = state.decks.find(d => d.id === deckId);
    if (!deck?.cards?.length) return;
    targetName = deck.name;
  } else if (!state.decks.some(deck => deck.cards?.length)) {
    return;
  }

  state.pendingStudy = { scope, deckId };
  document.getElementById("studyOrderTarget").textContent =
    scope === "deck"
      ? `Study deck: ${targetName}`
      : `Study class: ${targetName}`;

  openModal("studyOrderModal");
}

function beginPendingStudy(order) {
  const pending = state.pendingStudy;
  if (!pending) return;

  state.studyOrder = order;
  closeModals();

  if (pending.scope === "deck") {
    startDeckStudy(pending.deckId, order);
  } else {
    startClassStudy(order);
  }

  state.pendingStudy = null;
}

function startDeckStudy(deckId, order = state.studyOrder) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck?.cards?.length) return;

  state.studyScope = "deck";
  state.selectedDeck = deck;
  state.studyMode = "standard";
  state.studyOrder = order;

  const cards = deck.cards.map(card => ({
    ...card,
    deckId: deck.id,
    deckName: deck.name
  }));

  state.sessionCards = order === "random"
    ? shuffledCopy(cards)
    : cards;

  prepareSession(
    deck.name,
    order === "random" ? "Deck Study · Random" : "Deck Study · Progressive"
  );
}

function startClassStudy(order = state.studyOrder) {
  const cards = [];

  for (const deck of state.decks) {
    for (const card of deck.cards || []) {
      cards.push({
        ...card,
        deckId: deck.id,
        deckName: deck.name
      });
    }
  }

  if (!cards.length) return;

  state.studyScope = "class";
  state.selectedDeck = null;
  state.studyMode = "standard";
  state.studyOrder = order;

  state.sessionCards = order === "random"
    ? shuffledCopy(cards)
    : cards;

  prepareSession(
    state.selectedClass.name,
    order === "random" ? "Class Study · Random" : "Class Study · Progressive"
  );
}


function chooseQuizSetup(scope, deckId = null) {
  let targetName = state.selectedClass?.name || "Class";

  if (scope === "deck") {
    const deck = state.decks.find(d => d.id === deckId);
    if (!deck?.cards?.length) return;
    targetName = deck.name;
  } else if (!state.decks.some(deck => deck.cards?.length)) {
    return;
  }

  state.pendingQuiz = { scope, deckId };
  state.quizConfig = {
    questionStyle: "standard",
    template: "What is the answer for {term}?",
    direction: "frontBack",
    answerMode: "multiple",
    order: "progressive",
    points: 1
  };

  document.getElementById("quizSetupTarget").textContent =
    scope === "deck"
      ? `Quiz deck: ${targetName}`
      : `Quiz class: ${targetName}`;

  document.querySelectorAll("[data-quiz-setting]").forEach(group => {
    const setting = group.dataset.quizSetting;
    group.querySelectorAll(".quiz-setting-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.value === state.quizConfig[setting]);
    });
  });

  document.getElementById("quizTemplateInput").value = state.quizConfig.template;
  document.getElementById("quizTemplateField").classList.add("hidden");
  document.getElementById("quizPointsInput").value = state.quizConfig.points;
  document.getElementById("exportGoogleFormsBtn").classList.toggle("hidden", !isOwner());
  document.getElementById("googleFormsExportResult").classList.add("hidden");
  document.getElementById("googleFormsExportStatus").textContent = "";

  openModal("quizSetupModal");
}

function collectQuizCards(scope, deckId = null) {
  const cards = [];

  if (scope === "deck") {
    const deck = state.decks.find(d => d.id === deckId);
    if (!deck) return cards;

    for (const card of deck.cards || []) {
      cards.push({
        ...card,
        deckId: deck.id,
        deckName: deck.name
      });
    }

    return cards;
  }

  for (const deck of state.decks) {
    for (const card of deck.cards || []) {
      cards.push({
        ...card,
        deckId: deck.id,
        deckName: deck.name
      });
    }
  }

  return cards;
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function buildMultipleChoiceOptions(card, direction, allCards) {
  const correct = direction === "frontBack" ? card.back : card.front;
  const pool = uniqueValues(
    allCards
      .filter(c => c.id !== card.id || c.deckId !== card.deckId)
      .map(c => direction === "frontBack" ? c.back : c.front)
      .filter(value => normalizeText(value) !== normalizeText(correct))
  );

  if (pool.length < 3) return null;

  const distractors = shuffledCopy(pool).slice(0, 3);
  return shuffledCopy([correct, ...distractors]);
}

function buildQuizQuestions(scope, deckId, config) {
  let cards = collectQuizCards(scope, deckId);

  if (config.order === "random") {
    cards = shuffledCopy(cards);
  }

  return cards.map((card, index) => {
    const direction = config.direction === "mixed"
      ? (Math.random() < 0.5 ? "frontBack" : "backFront")
      : config.direction;

    const term = direction === "frontBack" ? card.front : card.back;
    const answer = direction === "frontBack" ? card.back : card.front;

    const prompt = config.questionStyle === "custom"
      ? String(config.template || "").replaceAll("{term}", term)
      : term;

    let requestedType = config.answerMode;
    if (requestedType === "mixed") {
      requestedType = index % 2 === 0 ? "multiple" : "typed";
    }

    let options = null;
    let type = requestedType;

    if (requestedType === "multiple") {
      options = buildMultipleChoiceOptions(card, direction, cards);
      if (!options) type = "typed";
    }

    return {
      id: `${card.deckId}:${card.id}:${index}`,
      cardId: card.id,
      deckId: card.deckId,
      deckName: card.deckName,
      prompt,
      answer,
      direction,
      type,
      options
    };
  });
}

function syncQuizSetupInputs() {
  state.quizConfig.template = document.getElementById("quizTemplateInput").value.trim();
  state.quizConfig.points = Math.max(
    0,
    Math.min(100, Number(document.getElementById("quizPointsInput").value || 1))
  );
}

function validateQuizSetup() {
  syncQuizSetupInputs();

  if (state.quizConfig.questionStyle === "custom") {
    if (!state.quizConfig.template) {
      showMessage("Enter a custom question template.", "error");
      return false;
    }

    if (!state.quizConfig.template.includes("{term}")) {
      showMessage('Custom questions must include {term}.', "error");
      return false;
    }
  }

  return true;
}

function startConfiguredQuiz() {
  const pending = state.pendingQuiz;
  if (!pending) return;
  if (!validateQuizSetup()) return;

  const questions = buildQuizQuestions(
    pending.scope,
    pending.deckId,
    state.quizConfig
  );

  if (!questions.length) {
    showMessage("There are no cards available for this quiz.", "error");
    return;
  }

  state.quizQuestions = questions;
  state.quizIndex = 0;
  state.quizScore = 0;
  state.quizResults = [];
  state.quizAnswered = false;

  const title = pending.scope === "deck"
    ? state.decks.find(d => d.id === pending.deckId)?.name || "Deck Quiz"
    : state.selectedClass.name;

  document.getElementById("quizTitle").textContent = title;
  document.getElementById("quizScopeLabel").textContent =
    pending.scope === "deck" ? "Deck Quiz" : "Class Quiz";

  closeModals();
  showPanel("quizView");
  renderQuizQuestion();
}

async function googleFormsRequest(path, accessToken, options = {}) {
  const response = await fetch(`https://forms.googleapis.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const bodyText = await response.text();
  let data = {};

  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = { raw: bodyText };
    }
  }

  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      data?.raw ||
      `Google Forms API error (${response.status})`;

    const err = new Error(apiMessage);
    err.httpStatus = response.status;
    err.apiData = data;
    throw err;
  }

  return data;
}

function googleFormQuestionItem(question, points, index) {
  const grading = {
    pointValue: points,
    correctAnswers: {
      answers: [{ value: question.answer }]
    }
  };

  let questionKind;

  if (question.type === "multiple" && Array.isArray(question.options)) {
    grading.whenRight = { text: "Correct." };
    grading.whenWrong = { text: `Correct answer: ${question.answer}` };

    questionKind = {
      choiceQuestion: {
        type: "RADIO",
        options: question.options.map(value => ({ value })),
        shuffle: false
      }
    };
  } else {
    grading.generalFeedback = {
      text: `Correct answer: ${question.answer}`
    };

    questionKind = {
      textQuestion: {
        paragraph: false
      }
    };
  }

  return {
    createItem: {
      item: {
        title: question.prompt,
        description: question.deckName ? `Deck: ${question.deckName}` : "",
        questionItem: {
          question: {
            required: true,
            grading,
            ...questionKind
          }
        }
      },
      location: { index }
    }
  };
}

async function getGoogleFormsAccessToken() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/forms.body");

  if (state.user?.email) {
    provider.setCustomParameters({
      login_hint: state.user.email
    });
  }

  const result = await reauthenticateWithPopup(state.user, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;

  if (!accessToken) {
    throw new Error("Google did not return a Forms authorization token.");
  }

  return accessToken;
}

async function exportQuizToGoogleForms() {
  if (!isOwner()) {
    showMessage("Only the class owner can export this quiz.", "error");
    return;
  }

  if (!state.pendingQuiz) return;
  if (!validateQuizSetup()) return;

  const status = document.getElementById("googleFormsExportStatus");
  const exportBtn = document.getElementById("exportGoogleFormsBtn");
  const resultBox = document.getElementById("googleFormsExportResult");

  resultBox.classList.add("hidden");
  status.textContent = "Connecting to Google Forms…";
  exportBtn.disabled = true;

  try {
    const questions = buildQuizQuestions(
      state.pendingQuiz.scope,
      state.pendingQuiz.deckId,
      state.quizConfig
    );

    if (!questions.length) {
      throw new Error("There are no flashcards available to export.");
    }

    const accessToken = await getGoogleFormsAccessToken();

    status.textContent = "Creating Google Form Quiz…";

    const targetTitle =
      state.pendingQuiz.scope === "deck"
        ? `${state.decks.find(d => d.id === state.pendingQuiz.deckId)?.name || "Flashcards"} Quiz`
        : `${state.selectedClass.name} Quiz`;

    const created = await googleFormsRequest("/forms", accessToken, {
      method: "POST",
      body: JSON.stringify({
        info: {
          title: targetTitle
        }
      })
    });

    if (!created.formId) {
      throw new Error("Google Forms did not return a form ID.");
    }

    const requests = [
      {
        updateSettings: {
          settings: {
            quizSettings: {
              isQuiz: true
            }
          },
          updateMask: "quizSettings.isQuiz"
        }
      },
      {
        updateFormInfo: {
          info: {
            description:
              `Created from Flashcards — ${state.selectedClass.name}. ` +
              `${questions.length} question${questions.length === 1 ? "" : "s"}, ` +
              `${state.quizConfig.points} point${state.quizConfig.points === 1 ? "" : "s"} each.`
          },
          updateMask: "description"
        }
      },
      ...questions.map((q, index) =>
        googleFormQuestionItem(q, state.quizConfig.points, index)
      )
    ];

    await googleFormsRequest(`/forms/${encodeURIComponent(created.formId)}:batchUpdate`, accessToken, {
      method: "POST",
      body: JSON.stringify({ requests })
    });

    const editUrl = `https://docs.google.com/forms/d/${created.formId}/edit`;
    const link = document.getElementById("googleFormsEditLink");
    link.href = editUrl;

    resultBox.classList.remove("hidden");
    status.textContent = `Exported ${questions.length} questions successfully.`;
    showMessage("Google Form Quiz created.", "success");
  } catch (err) {
    console.error(err);

    if (
      err?.httpStatus === 403 ||
      /access not configured|api has not been used|permission|insufficient authentication|scope/i.test(err?.message || "")
    ) {
      status.textContent =
        "Google Forms export needs the Google Forms API enabled for this Firebase/Google Cloud project.";
    } else if (err?.code === "auth/popup-blocked") {
      status.textContent =
        "Your browser blocked the Google permission window. Allow popups and try again.";
    } else {
      status.textContent = `Export failed: ${err?.message || "Unknown error"}`;
    }
  } finally {
    exportBtn.disabled = false;
  }
}

function renderQuizQuestion() {
  const q = state.quizQuestions[state.quizIndex];

  if (!q) {
    finishQuiz();
    return;
  }

  state.quizAnswered = false;

  document.getElementById("quizQuestionCounter").textContent =
    `Question ${state.quizIndex + 1} of ${state.quizQuestions.length}`;
  document.getElementById("quizQuestionType").textContent =
    q.type === "multiple" ? "Multiple Choice" : "Type Answer";
  document.getElementById("quizQuestionText").textContent = q.prompt;
  document.getElementById("quizLiveScore").textContent =
    `${state.quizScore} / ${state.quizIndex}`;
  document.getElementById("quizProgressFill").style.width =
    `${(state.quizIndex / state.quizQuestions.length) * 100}%`;

  const choiceArea = document.getElementById("quizChoiceArea");
  const typingArea = document.getElementById("quizTypingArea");
  const typingInput = document.getElementById("quizTypingInput");

  choiceArea.innerHTML = "";
  choiceArea.classList.toggle("hidden", q.type !== "multiple");
  typingArea.classList.toggle("hidden", q.type !== "typed");

  document.getElementById("quizFeedback").classList.add("hidden");
  document.getElementById("quizNextBtn").classList.add("hidden");
  document.getElementById("quizCheckBtn").disabled = false;
  typingInput.disabled = false;
  typingInput.value = "";

  if (q.type === "multiple") {
    q.options.forEach((option, index) => {
      const btn = document.createElement("button");
      btn.className = "quiz-choice-btn";
      btn.dataset.quizChoice = option;
      btn.innerHTML = `
        <span class="quiz-choice-letter">${String.fromCharCode(65 + index)}</span>
        <span>${escapeHtml(option)}</span>
      `;
      choiceArea.appendChild(btn);
    });
  } else {
    setTimeout(() => typingInput.focus(), 0);
  }
}

function showQuizFeedback(correct, given, question) {
  const box = document.getElementById("quizFeedback");
  const title = document.getElementById("quizFeedbackTitle");
  const text = document.getElementById("quizFeedbackText");

  box.classList.remove("hidden", "correct", "incorrect");
  box.classList.add(correct ? "correct" : "incorrect");

  title.textContent = correct ? "Correct!" : "Not quite.";
  text.textContent = correct
    ? `Answer: ${question.answer}`
    : `Correct answer: ${question.answer}`;

  document.getElementById("quizNextBtn").classList.remove("hidden");
  document.getElementById("quizLiveScore").textContent =
    `${state.quizScore} / ${state.quizIndex + 1}`;
}

function answerQuizQuestion(given) {
  if (state.quizAnswered) return;

  const q = state.quizQuestions[state.quizIndex];
  if (!q) return;

  const cleanGiven = String(given ?? "").trim();
  if (!cleanGiven) {
    showMessage("Choose or type an answer first.", "error");
    return;
  }

  state.quizAnswered = true;

  const correct = normalizeText(cleanGiven) === normalizeText(q.answer);
  if (correct) state.quizScore += 1;

  state.quizResults.push({
    ...q,
    given: cleanGiven,
    correct
  });

  document.querySelectorAll(".quiz-choice-btn").forEach(btn => {
    btn.disabled = true;
    const value = btn.dataset.quizChoice;

    if (normalizeText(value) === normalizeText(q.answer)) {
      btn.classList.add("correct");
    } else if (normalizeText(value) === normalizeText(cleanGiven) && !correct) {
      btn.classList.add("incorrect");
    }
  });

  document.getElementById("quizTypingInput").disabled = true;
  document.getElementById("quizCheckBtn").disabled = true;

  showQuizFeedback(correct, cleanGiven, q);
}

function nextQuizQuestion() {
  if (!state.quizAnswered) return;
  state.quizIndex += 1;
  renderQuizQuestion();
}

async function saveQuizProgress() {
  const grouped = new Map();

  for (const result of state.quizResults) {
    if (!grouped.has(result.deckId)) {
      grouped.set(result.deckId, { answered: 0, correct: 0, deckName: result.deckName });
    }

    const group = grouped.get(result.deckId);
    group.answered += 1;
    if (result.correct) group.correct += 1;
  }

  for (const [deckId, group] of grouped.entries()) {
    let p = state.progressMap.get(deckId);

    if (!p) {
      p = {
        id: progressDocId(state.selectedClass.id, deckId, state.user.uid),
        classId: state.selectedClass.id,
        className: state.selectedClass.name,
        deckId,
        deckName: group.deckName,
        studentId: state.user.uid,
        studentName: state.user.displayName || "",
        studentEmail: state.user.email || "",
        studied: 0,
        ratingCount: 0,
        ratingTotal: 0,
        cards: {},
        quizAnswered: 0,
        quizCorrect: 0
      };
    }

    p.quizAnswered = Number(p.quizAnswered || 0) + group.answered;
    p.quizCorrect = Number(p.quizCorrect || 0) + group.correct;
    state.progressMap.set(deckId, p);

    await setDoc(doc(state.db, "progress", p.id), {
      classId: state.selectedClass.id,
      className: state.selectedClass.name,
      deckId,
      deckName: group.deckName,
      studentId: state.user.uid,
      studentName: state.user.displayName || "",
      studentEmail: state.user.email || "",
      quizAnswered: p.quizAnswered,
      quizCorrect: p.quizCorrect,
      lastQuizPercent: group.answered
        ? Math.round((group.correct / group.answered) * 100)
        : 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
}

async function finishQuiz() {
  const total = state.quizQuestions.length;
  const percent = total ? Math.round((state.quizScore / total) * 100) : 0;

  document.getElementById("quizResultsTitle").textContent =
    `${state.selectedClass.name} Quiz Results`;
  document.getElementById("quizResultsText").textContent =
    `You answered ${state.quizScore} of ${total} questions correctly.`;
  document.getElementById("quizCorrectCount").textContent =
    `${state.quizScore} / ${total}`;
  document.getElementById("quizPercent").textContent = `${percent}%`;

  const missed = state.quizResults.filter(r => !r.correct);
  const review = document.getElementById("quizReview");

  if (!missed.length) {
    review.innerHTML = `
      <div class="quiz-perfect">
        Perfect score — every answer was correct.
      </div>
    `;
  } else {
    review.innerHTML = `
      <div class="quiz-review-head">
        <span class="eyebrow">Review</span>
        <h3>Questions to review</h3>
      </div>
      ${missed.map(r => `
        <article class="quiz-review-item">
          <strong>${escapeHtml(r.prompt)}</strong>
          <span>Your answer: ${escapeHtml(r.given)}</span>
          <span>Correct answer: ${escapeHtml(r.answer)}</span>
        </article>
      `).join("")}
    `;
  }

  showPanel("quizCompleteView");

  try {
    await saveQuizProgress();
    await loadSidebarStats();
  } catch (err) {
    handleFirebaseError(err, "Quiz score was shown, but cloud progress could not be saved.");
  }
}

function tryQuizAgain() {
  state.quizIndex = 0;
  state.quizScore = 0;
  state.quizResults = [];
  state.quizAnswered = false;

  // Random order gets a fresh shuffle on each attempt.
  if (state.quizConfig.order === "random" && state.pendingQuiz) {
    state.quizQuestions = buildQuizQuestions(
      state.pendingQuiz.scope,
      state.pendingQuiz.deckId,
      state.quizConfig
    );
  }

  showPanel("quizView");
  renderQuizQuestion();
}

function prepareSession(title, label) {
  state.sessionIndex = 0;
  state.sessionRatings = [];

  document.getElementById("studyTitle").textContent = title;
  document.getElementById("studyDeckLabel").textContent = label;

  showPanel("studyView");
  renderStudyCard();
}

function renderStudyCard() {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) {
    finishSession();
    return;
  }

  document.getElementById("questionText").textContent = card.front;
  document.getElementById("answerText").textContent = card.back;
  document.getElementById("cardCounter").textContent =
    `${state.sessionIndex + 1} of ${state.sessionCards.length}`;
  document.getElementById("studyProgressFill").style.width =
    `${(state.sessionIndex / state.sessionCards.length) * 100}%`;

  document.getElementById("answerArea").classList.add("hidden");
  document.getElementById("typingArea").classList.add("hidden");
  document.getElementById("revealBtn").classList.remove("hidden");
  document.getElementById("typingResult").textContent = "";
}

function toggleAnswerVisibility(forceState = null) {
  const answerArea = document.getElementById("answerArea");
  const revealBtn = document.getElementById("revealBtn");

  const currentlyVisible = !answerArea.classList.contains("hidden");
  const shouldShow = forceState === null ? !currentlyVisible : Boolean(forceState);

  answerArea.classList.toggle("hidden", !shouldShow);
  revealBtn.classList.toggle("hidden", shouldShow);
}

function revealAnswer() {
  toggleAnswerVisibility(true);
}

function studyViewIsOpen() {
  return !document.getElementById("studyView").classList.contains("hidden");
}

function answerIsVisible() {
  return !document.getElementById("answerArea").classList.contains("hidden");
}

function targetIsInteractive(target) {
  return Boolean(
    target.closest(
      "button, input, textarea, select, a, [contenteditable='true'], [data-rating]"
    )
  );
}

async function rateCurrentCard(rating) {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) return;

  rating = Number(rating);

  let p = state.progressMap.get(card.deckId);

  if (!p) {
    p = {
      id: progressDocId(state.selectedClass.id, card.deckId, state.user.uid),
      classId: state.selectedClass.id,
      className: state.selectedClass.name,
      deckId: card.deckId,
      deckName: card.deckName,
      studentId: state.user.uid,
      studentName: state.user.displayName || "",
      studentEmail: state.user.email || "",
      studied: 0,
      ratingCount: 0,
      ratingTotal: 0,
      cards: {}
    };
  }

  p.cards = p.cards || {};
  const cp = p.cards[card.id] || { count: 0, total: 0, seen: 0 };
  cp.count += 1;
  cp.total += rating;
  cp.seen += 1;
  p.cards[card.id] = cp;

  p.studied = Number(p.studied || 0) + 1;
  p.ratingCount = Number(p.ratingCount || 0) + 1;
  p.ratingTotal = Number(p.ratingTotal || 0) + rating;

  state.progressMap.set(card.deckId, p);
  state.sessionRatings.push(rating);

  try {
    await setDoc(doc(state.db, "progress", p.id), {
      classId: state.selectedClass.id,
      className: state.selectedClass.name,
      deckId: card.deckId,
      deckName: card.deckName,
      studentId: state.user.uid,
      studentName: state.user.displayName || "",
      studentEmail: state.user.email || "",
      studied: p.studied,
      ratingCount: p.ratingCount,
      ratingTotal: p.ratingTotal,
      cards: p.cards,
      updatedAt: serverTimestamp()
    }, { merge: true });

    state.sessionIndex += 1;
    renderStudyCard();
  } catch (err) {
    handleFirebaseError(err, "Progress could not be saved.");
  }
}

function finishSession() {
  const avg = state.sessionRatings.length
    ? state.sessionRatings.reduce((a, b) => a + b, 0) / state.sessionRatings.length
    : 0;

  const stats = currentClassStats();

  document.getElementById("completeCards").textContent = state.sessionRatings.length;
  document.getElementById("completeAverage").textContent = avg.toFixed(1);
  document.getElementById("completeMastery").textContent = `${stats.mastery}%`;
  document.getElementById("completeText").textContent =
    `You reviewed ${state.sessionRatings.length} card${state.sessionRatings.length === 1 ? "" : "s"} in ${state.selectedClass.name}.`;

  showPanel("completeView");
}

async function returnToClass() {
  await openClass(state.selectedClass.id);
}

function handleFirebaseError(err, fallback) {
  console.error(err);

  let message = fallback;

  if (err?.code === "permission-denied") {
    message = "Firebase blocked this request. Publish the new Firestore Rules included with this build.";
  } else if (err?.code === "auth/popup-blocked") {
    message = "Your browser blocked the Google sign-in popup. Allow popups and try again.";
  } else if (err?.code === "auth/unauthorized-domain") {
    message = "This website domain is not authorized in Firebase Authentication settings.";
  } else if (err?.message) {
    message = `${fallback} ${err.message}`;
  }

  showMessage(message, "error", 7000);
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    THEME_KEY,
    document.body.classList.contains("dark") ? "dark" : "light"
  );
}

function initTheme() {
  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("dark");
  }
}

async function initializeFirebase() {
  try {
    state.app = initializeApp(firebaseConfig);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);

    onAuthStateChanged(state.auth, async user => {
      state.user = user;

      try {
        await routeAfterAuth();
      } catch (err) {
        handleFirebaseError(err, "Could not load Flashcards.");
      }
    });
  } catch (err) {
    console.error(err);
    showTopView("loginView");
    showMessage("Firebase could not initialize.", "error", 0);
  }
}

document.addEventListener("click", async e => {
  const sidebarClass = e.target.closest("[data-sidebar-class]");
  if (sidebarClass) {
    return openClass(sidebarClass.dataset.sidebarClass);
  }

  const libraryClass = e.target.closest("[data-library-class]");
  if (libraryClass) {
    return openClass(libraryClass.dataset.libraryClass);
  }

  const tab = e.target.closest("[data-tab]");
  if (tab) {
    return setTab(tab.dataset.tab);
  }

  const editDeck = e.target.closest("[data-edit-deck]");
  if (editDeck) {
    return openEditDeck(editDeck.dataset.editDeck);
  }

  const toggleDeckVisibilityBtn = e.target.closest("[data-toggle-deck-visibility]");
  if (toggleDeckVisibilityBtn) {
    return toggleDeckVisibility(toggleDeckVisibilityBtn.dataset.toggleDeckVisibility);
  }

  const studyDeck = e.target.closest("[data-study-deck]");
  if (studyDeck) {
    return chooseStudyOrder("deck", studyDeck.dataset.studyDeck);
  }

  const quizDeck = e.target.closest("[data-quiz-deck]");
  if (quizDeck) {
    return chooseQuizSetup("deck", quizDeck.dataset.quizDeck);
  }

  const quizSettingBtn = e.target.closest(".quiz-setting-btn");
  if (quizSettingBtn) {
    const group = quizSettingBtn.closest("[data-quiz-setting]");
    const setting = group.dataset.quizSetting;

    state.quizConfig[setting] = quizSettingBtn.dataset.value;

    group.querySelectorAll(".quiz-setting-btn").forEach(btn => {
      btn.classList.toggle("active", btn === quizSettingBtn);
    });

    if (setting === "questionStyle") {
      const custom = quizSettingBtn.dataset.value === "custom";
      document.getElementById("quizTemplateField").classList.toggle("hidden", !custom);

      if (custom) {
        setTimeout(() => document.getElementById("quizTemplateInput").focus(), 0);
      }
    }

    return;
  }

  const quizChoice = e.target.closest("[data-quiz-choice]");
  if (quizChoice) {
    return answerQuizQuestion(quizChoice.dataset.quizChoice);
  }

  const rating = e.target.closest("[data-rating]");
  if (rating) {
    return rateCurrentCard(rating.dataset.rating);
  }

  if (e.target.closest("[data-close-modal]")) {
    closeModals();
  }
});

document.getElementById("googleSignInBtn").addEventListener("click", signInGoogle);
document.getElementById("sharedGoogleSignInBtn").addEventListener("click", signInGoogle);

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await signOut(state.auth);
});

document.getElementById("sidebarSettingsBtn").addEventListener("click", toggleTheme);

document.getElementById("newClassSidebarBtn").addEventListener("click", () => openModal("newClassModal"));
document.getElementById("newClassMainBtn").addEventListener("click", () => openModal("newClassModal"));
document.getElementById("createClassBtn").addEventListener("click", createClass);

document.getElementById("editClassBtn").addEventListener("click", openEditClass);
document.getElementById("editIntroBtn").addEventListener("click", openEditClass);
document.getElementById("saveClassBtn").addEventListener("click", saveClassChanges);

document.getElementById("shareClassBtn").addEventListener("click", () => copyClassLink());
document.getElementById("removeSharedClassBtn").addEventListener("click", removeSharedClass);

document.getElementById("newDeckBtn").addEventListener("click", openNewDeck);
document.getElementById("createDeckBtn").addEventListener("click", createDeck);
document.getElementById("loadSampleBtn").addEventListener("click", () => {
  document.getElementById("newDeckName").value = sampleDeck.name;
  document.getElementById("newDeckCards").value = sampleDeck.text;
});

document.getElementById("saveDeckBtn").addEventListener("click", saveDeckChanges);
document.getElementById("deleteDeckBtn").addEventListener("click", deleteCurrentDeck);

document.getElementById("studyClassBtn").addEventListener("click", () => chooseStudyOrder("class"));
document.getElementById("quizClassBtn").addEventListener("click", () => chooseQuizSetup("class"));
document.getElementById("startQuizBtn").addEventListener("click", startConfiguredQuiz);
document.getElementById("exportGoogleFormsBtn").addEventListener("click", exportQuizToGoogleForms);
document.getElementById("quizTemplateInput").addEventListener("input", e => {
  state.quizConfig.template = e.target.value;
});
document.getElementById("quizPointsInput").addEventListener("input", e => {
  const value = Math.max(0, Math.min(100, Number(e.target.value || 1)));
  state.quizConfig.points = value;
});
document.getElementById("quizCheckBtn").addEventListener("click", () => {
  answerQuizQuestion(document.getElementById("quizTypingInput").value);
});
document.getElementById("quizTypingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    answerQuizQuestion(e.target.value);
  }
});
document.getElementById("quizNextBtn").addEventListener("click", nextQuizQuestion);
document.getElementById("exitQuizBtn").addEventListener("click", returnToClass);
document.getElementById("quizBackToClassBtn").addEventListener("click", returnToClass);
document.getElementById("quizTryAgainBtn").addEventListener("click", tryQuizAgain);

document.getElementById("refreshLearnersBtn").addEventListener("click", loadLearners);

document.getElementById("revealBtn").addEventListener("click", e => {
  e.stopPropagation();
  toggleAnswerVisibility();
});
document.getElementById("exitStudyBtn").addEventListener("click", returnToClass);
document.getElementById("studyAgainBtn").addEventListener("click", () => {
  if (state.studyScope === "class") {
    startClassStudy(state.studyOrder);
  } else if (state.selectedDeck) {
    startDeckStudy(state.selectedDeck.id, state.studyOrder);
  }
});
document.getElementById("completeBackBtn").addEventListener("click", returnToClass);

// Typing controls are retained for later expansion, but current Brainscape-style study uses reveal + confidence.
document.getElementById("checkTypingBtn").addEventListener("click", () => {
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
  result.textContent = correct ? "Correct!" : "Not quite.";
  result.className = `typing-result ${correct ? "correct" : "incorrect"}`;
  document.getElementById("answerArea").classList.remove("hidden");
});

// Click anywhere on the flashcard surface to reveal/hide the answer.
// Interactive controls are excluded so rating buttons and inputs do not toggle the card.
document.querySelector(".study-card").addEventListener("click", e => {
  if (!studyViewIsOpen()) return;
  if (targetIsInteractive(e.target)) return;

  toggleAnswerVisibility();
});

// Keyboard study controls:
// Space = reveal/hide answer.
// Number keys 1-5 = submit confidence rating while the answer is visible.
document.addEventListener("keydown", e => {
  if (!studyViewIsOpen()) return;

  const active = document.activeElement;
  const tag = active?.tagName?.toLowerCase();

  if (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    active?.isContentEditable
  ) {
    return;
  }

  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    toggleAnswerVisibility();
    return;
  }

  if (!["1", "2", "3", "4", "5"].includes(e.key)) return;
  if (!answerIsVisible()) return;

  e.preventDefault();
  rateCurrentCard(Number(e.key));
});

document.getElementById("progressiveOrderBtn").addEventListener("click", () => {
  beginPendingStudy("progressive");
});

document.getElementById("randomOrderBtn").addEventListener("click", () => {
  beginPendingStudy("random");
});

document.getElementById("modalBackdrop").addEventListener("click", e => {
  if (e.target.id === "modalBackdrop") {
    closeModals();
  }
});

window.addEventListener("popstate", routeAfterAuth);

initTheme();
initializeFirebase();
