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
  const snap = await getDocs(collection(state.db, "classes", state.selectedClass.id, "decks"));
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
          <h3>${escapeHtml(deck.name)}</h3>
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
              <button class="deck-action-btn" data-edit-deck="${deck.id}" title="Edit deck">✎</button>
            </div>
          ` : ""}
          <button class="deck-play" data-study-deck="${deck.id}" title="Study">▶</button>
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
  openModal("newDeckModal");
}

async function createDeck() {
  if (!isOwner()) return;

  const name = document.getElementById("newDeckName").value.trim();
  const cards = parsePairs(document.getElementById("newDeckCards").value);

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
      order: state.decks.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    closeModals();
    await openClass(state.selectedClass.id);
    showMessage("Deck created. Everyone following this class will see it automatically.", "success");
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
  openModal("editDeckModal");
}

async function saveDeckChanges() {
  if (!isOwner() || !state.editingDeckId) return;

  const name = document.getElementById("editDeckName").value.trim();
  const cards = parsePairs(document.getElementById("editDeckCards").value);

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
      rows.push({
        deck: deck.name,
        studied: s.studied,
        unique: s.unique,
        total: deck.cards?.length || 0,
        mastery: s.mastery
      });
    }

    document.getElementById("tabLearnerCount").textContent = "";

    host.innerHTML = rows.length
      ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Deck</th><th>Unique Studied</th><th>Total Reviews</th><th>Mastery</th></tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${escapeHtml(r.deck)}</td>
                  <td>${r.unique} of ${r.total}</td>
                  <td>${r.studied}</td>
                  <td>${r.mastery}%</td>
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
          uniqueKeys: new Set(),
          updatedAt: p.updatedAt
        });
      }

      const row = byStudent.get(key);
      row.studied += Number(p.studied || 0);
      row.ratingTotal += Number(p.ratingTotal || 0);
      row.ratingCount += Number(p.ratingCount || 0);

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

function startDeckStudy(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck?.cards?.length) return;

  state.studyScope = "deck";
  state.selectedDeck = deck;
  state.studyMode = "standard";

  state.sessionCards = deck.cards.map(card => ({
    ...card,
    deckId: deck.id,
    deckName: deck.name
  }));

  prepareSession(deck.name, "Deck Study");
}

function startClassStudy() {
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

  // Prioritize cards with lower confidence.
  state.sessionCards = cards.map(card => {
    const p = state.progressMap.get(card.deckId);
    const cp = p?.cards?.[card.id];
    const score = cp?.count ? cp.total / cp.count : 0;
    return { ...card, score, jitter: Math.random() * .2 };
  }).sort((a, b) => (a.score + a.jitter) - (b.score + b.jitter));

  prepareSession(state.selectedClass.name, "Class Study");
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

function revealAnswer() {
  document.getElementById("answerArea").classList.remove("hidden");
  document.getElementById("revealBtn").classList.add("hidden");
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

  const studyDeck = e.target.closest("[data-study-deck]");
  if (studyDeck) {
    return startDeckStudy(studyDeck.dataset.studyDeck);
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

document.getElementById("studyClassBtn").addEventListener("click", startClassStudy);
document.getElementById("refreshLearnersBtn").addEventListener("click", loadLearners);

document.getElementById("revealBtn").addEventListener("click", revealAnswer);
document.getElementById("exitStudyBtn").addEventListener("click", returnToClass);
document.getElementById("studyAgainBtn").addEventListener("click", () => {
  if (state.studyScope === "class") {
    startClassStudy();
  } else if (state.selectedDeck) {
    startDeckStudy(state.selectedDeck.id);
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

document.getElementById("modalBackdrop").addEventListener("click", e => {
  if (e.target.id === "modalBackdrop") {
    closeModals();
  }
});

window.addEventListener("popstate", routeAfterAuth);

initTheme();
initializeFirebase();
