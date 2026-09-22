# Flashcards — Linked Library Model

This version matches the behavior you described:

- There is only one account type.
- Any signed-in user can create their own decks.
- The deck creator is the owner.
- The owner can edit, publish, share, view progress, or delete the deck.
- A student opens a study link and the deck is automatically added to **Shared With Me**.
- The student receives **study** access only.
- The student does not receive a copied deck.
- The library stores only a reference to the owner's deck.
- When the owner edits the master deck, students see the updated version the next time the deck is loaded.

## Firestore collections

- `users/{uid}`
- `users/{uid}/library/{deckId}` — linked study-only deck references
- `decks/{deckId}` — one canonical/master deck
- `progress/{deckId}_{studentId}` — per-student study progress

No `admins`, `classes`, or `classCodes` collection is required.

## Important setup step

Replace your current Firestore Rules with the contents of `firestore.rules`, then click **Publish**.

## Shared-link flow

Teacher/owner:

1. Create a deck.
2. Click **Copy Study Link**.
3. Paste the link into Google Classroom.

Student:

1. Click the link.
2. Sign in with Google if needed.
3. Flashcards automatically adds the deck to **Shared With Me** with study-only access.
4. The student can study but cannot edit the deck.

## GitHub files

Upload these files together in the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`

`firestore.rules` and `SETUP.md` can stay in the repository for reference.
