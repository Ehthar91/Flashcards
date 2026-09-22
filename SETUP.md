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
