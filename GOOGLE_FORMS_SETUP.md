# One-time Google Forms Export Setup

The Flashcards website can create a real Google Forms Quiz through the Google Forms API.

## 1. Enable the Google Forms API

Use the same Google Cloud / Firebase project as Flashcards:

- Project ID: `flashcards-8390f`

In Google Cloud Console:

1. Open **APIs & Services → Library**.
2. Search for **Google Forms API**.
3. Click **Enable**.

## 2. OAuth consent / Data Access

The exporter requests this scope only when the class owner clicks Export:

`https://www.googleapis.com/auth/forms.body`

This scope lets the app create and edit Google Forms.

In the Google Auth / OAuth consent configuration for the project, make sure the Forms scope is permitted for the app.

If the OAuth app is still in Testing, add the Google accounts that will test the export as test users.

Public production use of Google user-data scopes can require Google OAuth verification.

## 3. Export from Flashcards

1. Open a class you own.
2. Click **Quiz** on the class or a deck.
3. Choose the quiz settings.
4. Optional: choose **Custom Question** and write a template using `{term}`.
5. Choose points per question.
6. Click **Export to Google Forms Quiz**.
7. Approve Google Forms access when prompted.
8. Click **Open Google Form Quiz** after export completes.

## Notes

- Multiple-choice questions are exported as Google Forms radio questions.
- Type Answer questions are exported as Google Forms short-answer questions.
- The correct answer key and point value are included.
- Google Forms short-answer grading requires an exact answer-key match.
- The export does not change the Flashcards deck or Firebase data.
