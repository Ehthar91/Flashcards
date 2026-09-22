import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.19.0";
const THEME_KEY = "flashcards_linked_theme";

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
  ownedDecks: [],
  sharedDecks: [],
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

function cardsToText(cards = []) {
  return cards.map(card => `${card.front} = ${card.back}`).join("\n");
}

function normalizeText(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function deckParam() {
  return new URL(window.location.href).searchParams.get("deck");
}

function buildShareLink(deckId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("deck", deckId);
  return url.toString();
}

function clearDeckParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("deck");
  history.pushState({}, "", url);
}

function isOwner(deck = state.selectedDeck) {
  return Boolean(deck && state.user && deck.ownerId === state.user.uid);
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

function setUserChip(user) {
  document.getElementById("userName").textContent = user.displayName || user.email || "User";

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
  await setDoc(doc(state.db, "users", state.user.uid), {
    displayName: state.user.displayName || "",
    email: state.user.email || "",
    photoURL: state.user.photoURL || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
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

async function routeAfterAuth() {
  if (!state.user) {
    clearUserChip();

    const sharedId = deckParam();
    if (sharedId) {
      try {
        const snap = await getDoc(doc(state.db, "decks", sharedId));
        if (snap.exists() && snap.data().published === true) {
          document.getElementById("sharedSignInTitle").textContent =
            snap.data().name || "A deck was shared with you.";
          showView("sharedSignInView");
          return;
        }
      } catch (_) {}
    }

    showView("loginView");
    return;
  }

  setUserChip(state.user);
  await ensureUserProfile();

  const sharedId = deckParam();
  if (sharedId) {
    await acceptSharedDeck(sharedId);
    return;
  }

  await loadLibrary();
  showView("libraryView");
}

async function loadLibrary() {
  await Promise.all([loadOwnedDecks(), loadSharedDecks()]);
  renderLibrary();
}

async function loadOwnedDecks() {
  const q = query(
    collection(state.db, "decks"),
    where("ownerId", "==", state.user.uid)
  );

  const snap = await getDocs(q);
  state.ownedDecks = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function loadSharedDecks() {
  const refs = await getDocs(collection(state.db, "users", state.user.uid, "library"));
  const results = [];

  for (const refSnap of refs.docs) {
    const refData = refSnap.data();

    try {
      const deckSnap = await getDoc(doc(state.db, "decks", refData.deckId || refSnap.id));
      if (deckSnap.exists()) {
        const deck = { id: deckSnap.id, ...deckSnap.data(), libraryAccess: refData.access || "study" };

        // Do not duplicate an owned deck in Shared With Me.
        if (deck.ownerId !== state.user.uid) {
          results.push(deck);
        }
      } else {
        results.push({
          id: refData.deckId || refSnap.id,
          name: refData.deckName || "Unavailable deck",
          unavailable: true,
          libraryAccess: refData.access || "study"
        });
      }
    } catch {
      results.push({
        id: refData.deckId || refSnap.id,
        name: refData.deckName || "Unavailable deck",
        unavailable: true,
        libraryAccess: refData.access || "study"
      });
    }
  }

  state.sharedDecks = results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function renderLibrary() {
  document.getElementById("ownedCount").textContent = state.ownedDecks.length;
  document.getElementById("sharedCount").textContent = state.sharedDecks.length;

  const ownedGrid = document.getElementById("ownedDeckGrid");
  const sharedGrid = document.getElementById("sharedDeckGrid");

  if (!state.ownedDecks.length) {
    ownedGrid.innerHTML = `<div class="empty-state">You have not created a deck yet.</div>`;
  } else {
    ownedGrid.innerHTML = state.ownedDecks.map(deck => `
      <article class="card deck-card">
        <div>
          <span class="eyebrow">Owner</span>
          <h3>${escapeHtml(deck.name)}</h3>
          <p>${deck.cards?.length || 0} cards · ${deck.published ? "Study link active" : "Private draft"}</p>
        </div>

        <div class="deck-card-footer">
          <span class="badge">${deck.published ? "Published" : "Draft"}</span>

          <div class="deck-actions">
            <button class="primary-btn" data-open-owned="${deck.id}">Study</button>
            <button class="secondary-btn" data-edit-deck="${deck.id}">Edit</button>
            <button class="secondary-btn" data-share-deck="${deck.id}" ${deck.published ? "" : "disabled"}>Share</button>
            <button class="secondary-btn" data-progress-deck="${deck.id}">Progress</button>
            <button class="danger-btn" data-delete-deck="${deck.id}">Delete</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  if (!state.sharedDecks.length) {
    sharedGrid.innerHTML = `<div class="empty-state">Open a shared study link to add a deck here.</div>`;
  } else {
    sharedGrid.innerHTML = state.sharedDecks.map(deck => `
      <article class="card deck-card">
        <div>
          <span class="eyebrow">Study access</span>
          <h3>${escapeHtml(deck.name)}</h3>
          <p>${
            deck.unavailable
              ? "This deck is unavailable or no longer published."
              : `${deck.cards?.length || 0} cards · by ${escapeHtml(deck.ownerName || "Owner")}`
          }</p>
        </div>

        <div class="deck-card-footer">
          <span class="badge">Study only</span>

          <div class="deck-actions">
            <button class="primary-btn" data-open-shared="${deck.id}" ${deck.unavailable ? "disabled" : ""}>Study</button>
            <button class="secondary-btn" data-remove-shared="${deck.id}">Remove</button>
          </div>
        </div>
      </article>
    `).join("");
  }
}

async function acceptSharedDeck(deckId) {
  try {
    const snap = await getDoc(doc(state.db, "decks", deckId));

    if (!snap.exists()) {
      clearDeckParam();
      showMessage("This deck no longer exists.", "error");
      await loadLibrary();
      showView("libraryView");
      return;
    }

    const deck = { id: snap.id, ...snap.data() };

    if (deck.ownerId === state.user.uid) {
      state.selectedDeck = deck;
      clearDeckParam();
      await openDeck(deck);
      return;
    }

    if (!deck.published) {
      clearDeckParam();
      showMessage("This study link is no longer active.", "error");
      await loadLibrary();
      showView("libraryView");
      return;
    }

    await setDoc(doc(state.db, "users", state.user.uid, "library", deck.id), {
      deckId: deck.id,
      deckName: deck.name,
      ownerId: deck.ownerId,
      access: "study",
      addedAt: serverTimestamp()
    }, { merge: true });

    state.selectedDeck = deck;
    clearDeckParam();
    showMessage(`"${deck.name}" was added to Shared With Me.`, "success");
    await openDeck(deck);
  } catch (err) {
    handleFirebaseError(err, "Could not add this shared deck.");
  }
}

async function createDeck() {
  const name = document.getElementById("newDeckName").value.trim();
  const cards = parsePairs(document.getElementById("newDeckCards").value);
  const published = document.getElementById("newDeckPublished").checked;

  if (!name) return showMessage("Enter a deck name.", "error");
  if (!cards.length) return showMessage("Add at least one valid card.", "error");

  try {
    const ref = await addDoc(collection(state.db, "decks"), {
      name,
      cards,
      ownerId: state.user.uid,
      ownerName: state.user.displayName || state.user.email || "Owner",
      published,
      accessMode: "study",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    document.getElementById("newDeckName").value = "";
    document.getElementById("newDeckCards").value = "";
    document.getElementById("newDeckPublished").checked = true;
    document.getElementById("newDeckPanel").classList.add("hidden");

    await loadLibrary();

    if (published) {
      await copyShareLink(ref.id);
      showMessage("Deck created. Study link copied.", "success");
    } else {
      showMessage("Deck created as a private draft.", "success");
    }
  } catch (err) {
    handleFirebaseError(err, "Could not create the deck.");
  }
}

function findOwnedDeck(deckId) {
  return state.ownedDecks.find(d => d.id === deckId);
}

function findSharedDeck(deckId) {
  return state.sharedDecks.find(d => d.id === deckId);
}

async function openDeck(deckOrId) {
  try {
    let deck = typeof deckOrId === "string"
      ? findOwnedDeck(deckOrId) || findSharedDeck(deckOrId)
      : deckOrId;

    if (!deck || deck.unavailable) {
      const snap = await getDoc(doc(state.db, "decks", typeof deckOrId === "string" ? deckOrId : deckOrId.id));
      if (!snap.exists()) return showMessage("This deck is unavailable.", "error");
      deck = { id: snap.id, ...snap.data() };
    } else {
      // Always reload the canonical deck so shared users receive owner updates.
      const snap = await getDoc(doc(state.db, "decks", deck.id));
      if (!snap.exists()) return showMessage("This deck is unavailable.", "error");
      deck = { id: snap.id, ...snap.data() };
    }

    state.selectedDeck = deck;
    await loadProgressForSelectedDeck();
    renderDeckLanding();
    showView("deckLandingView");
  } catch (err) {
    handleFirebaseError(err, "Could not open the deck.");
  }
}

async function loadProgressForSelectedDeck() {
  const id = progressDocId(state.selectedDeck.id, state.user.uid);

  // Query the signed-in user's existing progress instead of doing a direct
  // get on a document that may not exist yet. This avoids a Firestore
  // permission-denied result on a brand-new study session.
  const q = query(
    collection(state.db, "progress"),
    where("studentId", "==", state.user.uid)
  );

  const snap = await getDocs(q);
  const existing = snap.docs.find(d => d.data().deckId === state.selectedDeck.id);

  state.currentProgress = existing
    ? { id: existing.id, ...existing.data() }
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
  const owner = isOwner(deck);
  const stats = progressStats(state.currentProgress);

  document.getElementById("landingAccessLabel").textContent = owner ? "Your deck" : "Shared deck";
  document.getElementById("landingDeckTitle").textContent = deck.name;
  document.getElementById("landingDeckMeta").textContent =
    owner
      ? `${deck.cards?.length || 0} cards · You own this deck`
      : `${deck.cards?.length || 0} cards · by ${deck.ownerName || "Owner"} · Study access`;

  document.getElementById("landingCardCount").textContent = deck.cards?.length || 0;
  document.getElementById("landingMastery").textContent = `${stats.mastery}%`;
  document.getElementById("landingStudied").textContent = stats.studied;

  document.getElementById("linkedNotice").classList.toggle("hidden", owner);
  document.getElementById("landingEditBtn").classList.toggle("hidden", !owner);
  document.getElementById("landingShareBtn").classList.toggle("hidden", !owner);
  document.getElementById("landingShareBtn").disabled = !deck.published;
}

function openEditDeck(deckId = state.selectedDeck?.id) {
  const deck = findOwnedDeck(deckId) || (isOwner() ? state.selectedDeck : null);
  if (!deck || deck.ownerId !== state.user.uid) {
    return showMessage("Only the deck owner can edit this deck.", "error");
  }

  state.selectedDeck = deck;
  document.getElementById("editDeckName").value = deck.name;
  document.getElementById("editDeckCards").value = cardsToText(deck.cards);
  document.getElementById("editDeckPublished").checked = Boolean(deck.published);
  showView("editDeckView");
}

async function saveDeckChanges() {
  const name = document.getElementById("editDeckName").value.trim();
  const cards = parsePairs(document.getElementById("editDeckCards").value);
  const published = document.getElementById("editDeckPublished").checked;

  if (!name) return showMessage("Enter a deck name.", "error");
  if (!cards.length) return showMessage("Add at least one valid card.", "error");

  try {
    await updateDoc(doc(state.db, "decks", state.selectedDeck.id), {
      name,
      cards,
      published,
      updatedAt: serverTimestamp()
    });

    // Update local selected deck. Shared users still reference the same deck ID.
    state.selectedDeck = {
      ...state.selectedDeck,
      name,
      cards,
      published
    };

    await loadLibrary();
    showMessage("Deck updated. Shared users will receive the new version.", "success");
    await openDeck(state.selectedDeck.id);
  } catch (err) {
    handleFirebaseError(err, "Could not save the deck.");
  }
}

async function copyShareLink(deckId) {
  const link = buildShareLink(deckId);

  try {
    await navigator.clipboard.writeText(link);
    showMessage("Study link copied. Paste it into Google Classroom.", "success");
  } catch {
    window.prompt("Copy this study link:", link);
  }
}

async function removeSharedDeck(deckId) {
  try {
    await deleteDoc(doc(state.db, "users", state.user.uid, "library", deckId));
    await loadLibrary();
    showMessage("Deck removed from Shared With Me.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not remove the shared deck.");
  }
}

async function deleteOwnedDeck(deckId) {
  if (!confirm("Delete this deck? Students who saved it will no longer be able to open it.")) return;

  try {
    await deleteDoc(doc(state.db, "decks", deckId));
    await loadLibrary();
    showMessage("Deck deleted.", "success");
  } catch (err) {
    handleFirebaseError(err, "Could not delete the deck.");
  }
}

async function openProgress(deckId) {
  const deck = findOwnedDeck(deckId);
  if (!deck) return;

  state.selectedDeck = deck;
  document.getElementById("progressDeckTitle").textContent = `${deck.name} Progress`;
  showView("progressView");
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
      .filter(p => p.studentId !== state.user.uid)
      .sort((a, b) =>
        String(a.studentName || a.studentEmail || "").localeCompare(
          String(b.studentName || b.studentEmail || "")
        )
      );

    document.getElementById("progressCount").textContent =
      `${rows.length} student${rows.length === 1 ? "" : "s"}`;

    if (!rows.length) {
      host.innerHTML = `<div class="empty-state">No student progress yet.</div>`;
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

  // Typing mode always asks front -> back.
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

    state.sessionIndex += 1;
    renderStudyCard();
  } catch (err) {
    handleFirebaseError(err, "Progress could not be saved.");
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
        await routeAfterAuth();
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
  const openOwned = e.target.closest("[data-open-owned]");
  if (openOwned) return openDeck(openOwned.dataset.openOwned);

  const openShared = e.target.closest("[data-open-shared]");
  if (openShared) return openDeck(openShared.dataset.openShared);

  const edit = e.target.closest("[data-edit-deck]");
  if (edit) return openEditDeck(edit.dataset.editDeck);

  const share = e.target.closest("[data-share-deck]");
  if (share) return copyShareLink(share.dataset.shareDeck);

  const progress = e.target.closest("[data-progress-deck]");
  if (progress) return openProgress(progress.dataset.progressDeck);

  const remove = e.target.closest("[data-remove-shared]");
  if (remove) return removeSharedDeck(remove.dataset.removeShared);

  const deleteDeck = e.target.closest("[data-delete-deck]");
  if (deleteDeck) return deleteOwnedDeck(deleteDeck.dataset.deleteDeck);

  const mode = e.target.closest("[data-mode]");
  if (mode) return startStudy(mode.dataset.mode);

  const rating = e.target.closest("[data-rating]");
  if (rating) return rateCurrentCard(rating.dataset.rating);
});

document.getElementById("googleSignInBtn").addEventListener("click", signInGoogle);
document.getElementById("sharedGoogleSignInBtn").addEventListener("click", signInGoogle);

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await signOut(state.auth);
});

document.getElementById("themeBtn").addEventListener("click", toggleTheme);

document.getElementById("brandBtn").addEventListener("click", async () => {
  clearDeckParam();

  if (!state.user) {
    showView("loginView");
    return;
  }

  await loadLibrary();
  showView("libraryView");
});

document.getElementById("newDeckToggleBtn").addEventListener("click", () => {
  document.getElementById("newDeckPanel").classList.toggle("hidden");
});

document.getElementById("closeNewDeckBtn").addEventListener("click", () => {
  document.getElementById("newDeckPanel").classList.add("hidden");
});

document.getElementById("createDeckBtn").addEventListener("click", createDeck);

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  document.getElementById("newDeckName").value = sampleDeck.name;
  document.getElementById("newDeckCards").value = sampleDeck.text;
});

document.getElementById("backFromEditBtn").addEventListener("click", async () => {
  await loadLibrary();
  showView("libraryView");
});

document.getElementById("cancelEditBtn").addEventListener("click", async () => {
  await loadLibrary();
  showView("libraryView");
});

document.getElementById("saveDeckBtn").addEventListener("click", saveDeckChanges);

document.getElementById("startDeckBtn").addEventListener("click", openStudySetup);

document.getElementById("landingEditBtn").addEventListener("click", () => {
  openEditDeck(state.selectedDeck.id);
});

document.getElementById("landingShareBtn").addEventListener("click", () => {
  copyShareLink(state.selectedDeck.id);
});

document.getElementById("backFromProgressBtn").addEventListener("click", async () => {
  await loadLibrary();
  showView("libraryView");
});

document.getElementById("refreshProgressBtn").addEventListener("click", loadProgressDashboard);

document.getElementById("backToDeckBtn").addEventListener("click", async () => {
  await openDeck(state.selectedDeck.id);
});

document.getElementById("revealBtn").addEventListener("click", revealAnswer);
document.getElementById("checkTypingBtn").addEventListener("click", checkTypingAnswer);

document.getElementById("typingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") checkTypingAnswer();
});

document.getElementById("exitStudyBtn").addEventListener("click", openStudySetup);
document.getElementById("studyAgainBtn").addEventListener("click", () => startStudy(state.studyMode));

document.getElementById("completeBackBtn").addEventListener("click", async () => {
  await openDeck(state.selectedDeck.id);
});

window.addEventListener("popstate", () => routeAfterAuth());

initTheme();
initializeFirebase();
