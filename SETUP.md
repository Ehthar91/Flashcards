# Flashcards — Class + Deck Architecture

This build uses the Brainscape-style hierarchy:

- One account type
- My Flashcards
- Classes
- Multiple decks inside each class
- One share link per class
- Shared classes are linked, not copied
- Shared users have study-only access
- Owner changes automatically appear for followers

## Firestore structure

- `users/{uid}`
- `users/{uid}/library/{classId}`
- `classes/{classId}`
- `classes/{classId}/decks/{deckId}`
- `progress/{classId}_{deckId}_{studentId}`

## Important

Replace your current Firestore Rules with the included `firestore.rules` and click Publish.

## Sharing

The owner clicks SHARE on the class.

The link looks like:

`https://YOUR-GITHUB-PAGES/Flashcards/?class=FIREBASE_CLASS_ID`

A signed-in student who opens it gets the class added to My Flashcards with study-only access.

The student's library stores a reference to the class, not copies of the decks. If the owner adds, removes, renames, or edits a deck, the student sees the new version next time the class loads.

## GitHub

Upload these files together in the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`

`firestore.rules` and `SETUP.md` can stay in the repository for reference.


## Deck visibility / drafts

Each deck now has its own `published` visibility flag.

- `published: true` = visible to students following the class.
- `published: false` = hidden draft; only the class owner can see it.
- The class itself can remain shared while you prepare future decks privately.
- Students query only visible decks.
- Owners see both visible and hidden decks.

The class owner can use **Show / Hide** directly from the Decks tab or change **Visible to students** while editing a deck.


## Custom quiz question templates

Quiz Setup now includes **Question wording → Custom Question**.

Example:

`What is the answer for {term}?`

`{term}` is replaced by the flashcard prompt term after applying the selected direction:

- Front → Back: `{term}` = card front; correct answer = card back.
- Back → Front: `{term}` = card back; correct answer = card front.
- Mixed: the direction is selected per question.

Custom templates must contain `{term}`.

## Google Forms Quiz export — downloadable `.gs`

The Flashcards site does not connect to Google Apps Script.

Click **Download Google Forms Script (.gs)** in Quiz Setup. The downloaded script contains that exact quiz.

To create the Form:

1. Open Google Apps Script and create a new project.
2. Replace the starter code with the downloaded `.gs` file.
3. Save.
4. Run `createFlashcardsQuiz()`.
5. Approve Google permissions the first time.
6. Open the execution log for the Form editor/student URLs, or find the new Form in Google Drive.


## Copy cards between decks and classes

Class owners can copy cards into any deck they own.

1. Open the destination class.
2. In the destination deck, click **Copy**.
3. Choose a source class.
4. Choose a source deck.
5. Select individual cards or use **Select All**.
6. Leave **Skip cards already in the destination deck** enabled to avoid exact duplicate front/back pairs.
7. Click **Copy Selected Cards**.

Sources can include:

- other decks in the current class,
- decks in another class you own,
- visible decks from a class shared with you.

The source cards are not moved or linked. New independent card IDs are created in the destination deck, so later edits do not affect the original cards.

No Firestore rule changes are required because source reads use the same existing owner/shared-class permissions and the destination write is restricted to the destination class owner.


## Archive classes and decks

Class owners can archive classes and individual decks without deleting them.

### Archive a class
Open the class → Edit Class → **Archive Class**.

- The class disappears from the normal class list.
- Sharing is temporarily turned off while archived.
- Its previous sharing setting is remembered.
- All decks/cards stay in Firestore.
- The class remains available as a source in **Copy Cards**.

### Archive a deck
Open the deck → Edit Deck → **Archive Deck**.

- The deck disappears from the normal Decks tab.
- It is hidden from students while archived.
- Its previous visibility setting is remembered.
- Its cards remain available in **Copy Cards**.

### Restore
Use the **Archived** button at the bottom of the sidebar.

Archived classes and decks each have a **Restore** button. Restoring returns the previous sharing/visibility setting.

No Firestore rule change is required for this feature. Archive/restore writes remain owner-only under the existing rules.


## Archive a class from the sidebar

Owned classes now have a small archive button on the right side of the sidebar row.

- Hover over an owned class to reveal it.
- Click the archive icon and confirm.
- The class moves to **Archived** immediately.
- Shared classes do not show the archive icon.
- Archived cards remain available through Copy Cards.
