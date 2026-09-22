const STORAGE_KEY = "flashcards_v1_data";
const THEME_KEY = "flashcards_v1_theme";

const state = {
  decks: [],
  selectedDeckId: null,
  studyMode: "standard",
  sessionCards: [],
  sessionIndex: 0,
  sessionRatings: [],
  currentTypingChecked: false
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

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.decks)) {
      state.decks = saved.decks;
    }
  } catch (_) {}

  if (!state.decks.length) {
    const starter = createDeckObject(sampleDeck.name, parsePairs(sampleDeck.text));
    state.decks.push(starter);
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ decks: state.decks }));
}

function parsePairs(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      let parts = null;
      if (line.includes("=")) parts = line.split("=");
      else if (line.includes("\t")) parts = line.split("\t");
      else if (line.includes(",")) parts = line.split(",");

      if (!parts || parts.length < 2) return null;
      const front = parts.shift().trim();
      const back = parts.join("=").trim();
      if (!front || !back) return null;

      return {
        id: uid(),
        front,
        back,
        ratings: [],
        seen: 0
      };
    })
    .filter(Boolean);
}

function createDeckObject(name, cards) {
  return {
    id: uid(),
    name,
    cards,
    createdAt: new Date().toISOString()
  };
}

function calculateDeckStats(deck) {
  const allRatings = deck.cards.flatMap(c => c.ratings || []);
  const studied = deck.cards.reduce((sum, c) => sum + (c.seen || 0), 0);
  const avg = allRatings.length
    ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
    : 0;
  const mastery = Math.round((avg / 5) * 100);
  return { studied, avg, mastery };
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");

  if (viewId === "teacherView") renderTeacherDecks();
  if (viewId === "studentView") renderStudentDecks();
}

function renderTeacherDecks() {
  const list = document.getElementById("teacherDeckList");
  if (!state.decks.length) {
    list.innerHTML = `<div class="empty-state">No decks yet.</div>`;
    return;
  }

  list.innerHTML = state.decks.map(deck => {
    const stats = calculateDeckStats(deck);
    return `
      <div class="deck-row">
        <div>
          <h4>${escapeHtml(deck.name)}</h4>
          <p>${deck.cards.length} cards · ${stats.mastery}% mastery</p>
        </div>
        <div class="deck-row-actions">
          <button class="small-btn" data-study-deck="${deck.id}">Study</button>
          <button class="small-btn danger" data-delete-deck="${deck.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderStudentDecks() {
  const list = document.getElementById("studentDeckList");
  if (!state.decks.length) {
    list.innerHTML = `<div class="empty-state">No decks are available yet.</div>`;
    return;
  }

  list.innerHTML = state.decks.map(deck => {
    const stats = calculateDeckStats(deck);
    return `
      <button class="deck-tile" data-open-deck="${deck.id}">
        <div>
          <span class="eyebrow">Deck</span>
          <h3>${escapeHtml(deck.name)}</h3>
          <p>${deck.cards.length} study cards</p>
        </div>
        <div class="deck-meta">
          <span>${stats.mastery}% mastery</span>
          <span>${stats.studied} studied</span>
        </div>
      </button>
    `;
  }).join("");
}

function openDeckSetup(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;
  state.selectedDeckId = deckId;
  const stats = calculateDeckStats(deck);
  document.getElementById("setupDeckTitle").textContent = deck.name;
  document.getElementById("setupCardCount").textContent = deck.cards.length;
  document.getElementById("setupMastery").textContent = `${stats.mastery}%`;
  document.getElementById("setupStudied").textContent = stats.studied;
  showView("studySetupView");
}

function startStudy(mode) {
  const deck = getSelectedDeck();
  if (!deck || !deck.cards.length) return;

  state.studyMode = mode;
  state.sessionIndex = 0;
  state.sessionRatings = [];
  state.currentTypingChecked = false;

  // Sort lower-confidence cards first, but randomize ties a little.
  state.sessionCards = deck.cards
    .map(card => ({
      ...card,
      sortScore: card.ratings?.length
        ? card.ratings.reduce((a, b) => a + b, 0) / card.ratings.length
        : 0
    }))
    .sort((a, b) => (a.sortScore + Math.random() * .25) - (b.sortScore + Math.random() * .25));

  document.getElementById("studyDeckTitle").textContent = deck.name;
  document.getElementById("studyModeLabel").textContent =
    mode === "standard" ? "Flashcard" :
    mode === "reverse" ? "Reverse" : "Typing";

  showView("studyView");
  renderStudyCard();
}

function renderStudyCard() {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) {
    finishSession();
    return;
  }

  const isReverse = state.studyMode === "reverse";
  const question = isReverse ? card.back : card.front;
  const answer = isReverse ? card.front : card.back;

  document.getElementById("questionText").textContent = question;
  document.getElementById("answerText").textContent = answer;
  document.getElementById("cardCounter").textContent =
    `Card ${state.sessionIndex + 1} of ${state.sessionCards.length}`;

  const pct = (state.sessionIndex / state.sessionCards.length) * 100;
  document.getElementById("sessionProgress").style.width = `${pct}%`;

  const answerArea = document.getElementById("answerArea");
  const revealBtn = document.getElementById("revealBtn");
  const typingArea = document.getElementById("typingArea");
  const typingInput = document.getElementById("typingInput");
  const typingResult = document.getElementById("typingResult");

  answerArea.classList.add("hidden");
  typingResult.textContent = "";
  typingResult.className = "typing-result";
  state.currentTypingChecked = false;

  if (state.studyMode === "typing") {
    typingArea.classList.remove("hidden");
    revealBtn.classList.add("hidden");
    typingInput.value = "";
    setTimeout(() => typingInput.focus(), 0);
  } else {
    typingArea.classList.add("hidden");
    revealBtn.classList.remove("hidden");
  }
}

function revealAnswer() {
  document.getElementById("answerArea").classList.remove("hidden");
  document.getElementById("revealBtn").classList.add("hidden");
}

function checkTyping() {
  const card = state.sessionCards[state.sessionIndex];
  if (!card) return;
  const isReverse = false;
  const correctAnswer = card.back.trim();
  const given = document.getElementById("typingInput").value.trim();
  const result = document.getElementById("typingResult");

  if (!given) {
    result.textContent = "Type an answer first.";
    result.className = "typing-result incorrect";
    return;
  }

  const correct = normalizeText(given) === normalizeText(correctAnswer);
  result.textContent = correct ? "Correct!" : "Not quite — check the answer below.";
  result.className = `typing-result ${correct ? "correct" : "incorrect"}`;
  document.getElementById("answerArea").classList.remove("hidden");
  state.currentTypingChecked = true;
}

function normalizeText(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function rateCurrentCard(rating) {
  const deck = getSelectedDeck();
  const sessionCard = state.sessionCards[state.sessionIndex];
  if (!deck || !sessionCard) return;

  const original = deck.cards.find(c => c.id === sessionCard.id);
  if (original) {
    original.ratings = Array.isArray(original.ratings) ? original.ratings : [];
    original.ratings.push(Number(rating));
    if (original.ratings.length > 20) original.ratings = original.ratings.slice(-20);
    original.seen = (original.seen || 0) + 1;
  }

  state.sessionRatings.push(Number(rating));
  saveState();
  state.sessionIndex += 1;
  renderStudyCard();
}

function finishSession() {
  const deck = getSelectedDeck();
  const avg = state.sessionRatings.length
    ? state.sessionRatings.reduce((a, b) => a + b, 0) / state.sessionRatings.length
    : 0;
  const stats = deck ? calculateDeckStats(deck) : { mastery: 0 };

  document.getElementById("completeCards").textContent = state.sessionRatings.length;
  document.getElementById("completeAverage").textContent = avg.toFixed(1);
  document.getElementById("completeMastery").textContent = `${stats.mastery}%`;
  document.getElementById("completionText").textContent =
    `You reviewed ${state.sessionRatings.length} card${state.sessionRatings.length === 1 ? "" : "s"} in ${deck?.name || "this deck"}.`;
  showView("completeView");
}

function getSelectedDeck() {
  return state.decks.find(d => d.id === state.selectedDeckId);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setTeacherMessage(message, type = "") {
  const el = document.getElementById("teacherMessage");
  el.textContent = message;
  el.className = `status-message ${type}`.trim();
}

document.addEventListener("click", e => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    showView(nav.dataset.nav);
    return;
  }

  const studyDeck = e.target.closest("[data-study-deck]");
  if (studyDeck) {
    openDeckSetup(studyDeck.dataset.studyDeck);
    return;
  }

  const openDeck = e.target.closest("[data-open-deck]");
  if (openDeck) {
    openDeckSetup(openDeck.dataset.openDeck);
    return;
  }

  const deleteDeck = e.target.closest("[data-delete-deck]");
  if (deleteDeck) {
    const id = deleteDeck.dataset.deleteDeck;
    const deck = state.decks.find(d => d.id === id);
    if (deck && confirm(`Delete "${deck.name}"?`)) {
      state.decks = state.decks.filter(d => d.id !== id);
      saveState();
      renderTeacherDecks();
    }
    return;
  }

  const mode = e.target.closest("[data-mode]");
  if (mode) {
    startStudy(mode.dataset.mode);
    return;
  }

  const rating = e.target.closest("[data-rating]");
  if (rating) {
    rateCurrentCard(rating.dataset.rating);
  }
});

document.getElementById("createDeckBtn").addEventListener("click", () => {
  const name = document.getElementById("deckName").value.trim();
  const text = document.getElementById("deckInput").value;
  const cards = parsePairs(text);

  if (!name) {
    setTeacherMessage("Enter a deck name.", "error");
    return;
  }
  if (!cards.length) {
    setTeacherMessage("Add at least one valid vocabulary pair.", "error");
    return;
  }

  state.decks.unshift(createDeckObject(name, cards));
  saveState();
  document.getElementById("deckName").value = "";
  document.getElementById("deckInput").value = "";
  setTeacherMessage(`Created "${name}" with ${cards.length} cards.`, "success");
  renderTeacherDecks();
});

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  document.getElementById("deckName").value = sampleDeck.name;
  document.getElementById("deckInput").value = sampleDeck.text;
  setTeacherMessage("Sample loaded.");
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (confirm("Delete all decks and progress from this browser?")) {
    state.decks = [];
    saveState();
    renderTeacherDecks();
  }
});

document.getElementById("revealBtn").addEventListener("click", revealAnswer);
document.getElementById("checkTypingBtn").addEventListener("click", checkTyping);
document.getElementById("typingInput").addEventListener("keydown", e => {
  if (e.key === "Enter") checkTyping();
});

document.getElementById("exitStudyBtn").addEventListener("click", () => {
  openDeckSetup(state.selectedDeckId);
});

document.getElementById("studyAgainBtn").addEventListener("click", () => {
  startStudy(state.studyMode);
});

document.getElementById("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
});

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark") document.body.classList.add("dark");
}

loadState();
initTheme();
renderTeacherDecks();
renderStudentDecks();
