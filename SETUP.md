# Flashcards — Share-Link Version

This version uses direct deck links instead of classes and class codes.

## Student flow

Teacher posts a link like:

`https://YOUR-SITE/Flashcards/?deck=FIREBASE_DECK_ID`

Student clicks it and can study immediately.

Google sign-in is optional for studying. It is required only if the student wants progress saved to their name.

## Teacher flow

1. Sign in with Google.
2. Teacher/admin access is enabled with an `admins/{uid}` document.
3. Create a deck.
4. Click **Copy Link**.
5. Paste the link into Google Classroom.
6. Use **Progress** on the deck to see named student progress.

## Important Firestore change

This version uses:
- `decks`
- `progress`
- `users`
- `admins`

It no longer uses:
- `classes`
- `classCodes`
- class membership documents

Replace your current Firestore Rules with the contents of `firestore.rules` and click **Publish**.

## Teacher/admin setup

If your teacher account is not already enabled:

1. Sign in to the site.
2. Copy the Firebase UID shown.
3. In Firestore, create collection `admins`.
4. Create a document whose Document ID is exactly the teacher UID.
5. Add any field such as `enabled = true`.
6. Refresh the site and click **Check Teacher Access**.

## GitHub files

Upload these files together in the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`

The following can remain in the repo for reference:
- `firestore.rules`
- `SETUP.md`
