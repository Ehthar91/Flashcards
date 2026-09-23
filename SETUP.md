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
