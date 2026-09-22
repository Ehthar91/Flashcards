# Flashcards Firebase Setup

This version uses Firebase Authentication and Cloud Firestore.

## 1. Create a Firebase project
Go to Firebase Console and create a project.

## 2. Register a Web App
Project settings → Your apps → Add app → Web.

Copy the `firebaseConfig` values into `firebase-config.js`.

## 3. Enable Google sign-in
Firebase Console → Authentication → Sign-in method → Google → Enable.

For GitHub Pages, also add your GitHub Pages hostname under Authentication → Settings → Authorized domains.

## 4. Create Cloud Firestore
Firebase Console → Firestore Database → Create database.

## 5. Publish the security rules
Open `firestore.rules`, copy its contents, and paste them into:
Firestore Database → Rules → Publish.

Do not use "allow read, write: if true" for production.

## 6. Make your account the teacher
1. Open your deployed Flashcards site.
2. Sign in with your Google account.
3. The app shows your Firebase UID.
4. In Firestore, create collection: `admins`
5. Create a document whose Document ID is exactly your Firebase UID.
6. Add any simple field, for example:
   - `enabled` = `true`
7. Refresh Flashcards and click "Check Teacher Access".

Students do NOT need an admins document.

## 7. Normal classroom flow

Teacher:
1. Sign in.
2. Create a class.
3. Share the generated class code.
4. Create a deck inside the class.

Student:
1. Sign in.
2. Enter the class code.
3. Open the class.
4. Study an assigned deck.

Teacher can open the Progress tab to see study totals and mastery.

## GitHub Pages files

Keep these files together in the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`

`firestore.rules` and `SETUP.md` may also stay in the repository root. They are not loaded by the web page.
