# Flashcards → Google Forms using Google Apps Script

This version uses **Google Apps Script + FormApp**, similar to the Classroom Quiz workflow.

It does **not** require the Google Forms REST API to be enabled in the Flashcards Firebase project.

## Part 1 — Create the Apps Script

1. Go to Google Apps Script and create a **New project**.
2. Delete the starter code.
3. Paste everything from `GoogleFormsExport.gs`.
4. Save the project. A name such as **Flashcards Forms Export** is fine.
5. Run `doGet` once from the Apps Script editor.
6. Approve the Google permissions requested by the script.

## Part 2 — Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Choose **Web app**.
3. For **Execute as**, use **User accessing the web app** when your Google Workspace setup allows it.
   - This makes the Google Form belong to the Google account using the exporter.
4. For **Who has access**, choose the narrowest option that still includes the teacher account(s) that will export quizzes.
5. Click **Deploy**.
6. Copy the Web App URL ending in `/exec`.

If your school Workspace only allows a different deployment configuration, use the option permitted by your administrator.

## Part 3 — Connect Flashcards

1. Upload the updated Flashcards files to GitHub Pages.
2. Open a class you own.
3. Click **Quiz**.
4. In Quiz Setup, paste the Apps Script `/exec` URL in:
   **Google Apps Script Web App URL**
5. The browser saves that URL locally.
6. Click **Export with Google Apps Script**.

A new tab opens. The Apps Script creates the Google Form Quiz and gives you:

- **Open Form Editor**
- **Open Student Quiz**

## What exports automatically

### Multiple Choice
- Question text
- A–D / generated choices
- Correct answer
- Points
- Correct/incorrect feedback
- Required question

### Type Answer
- Question text
- Short-answer field
- Points
- Required question
- Intended answer stored as quiz feedback

Important: Apps Script's built-in `FormApp` service can set points on a short-answer question, but it does not expose an automatic short-answer answer-key setter. Review Type Answer questions in Google Forms before assigning them if you need automatic grading.

## Custom `{term}` questions

Custom question templates are preserved.

Example template:

`What is the Karen word for {term}?`

For a card:

`Bed = လီၢ်မံ`

the exported Google Form question becomes:

`What is the Karen word for Bed?`

## Updating the Apps Script later

When you change `GoogleFormsExport.gs`:

1. Open the Apps Script project.
2. Paste/save the updated code.
3. Choose **Deploy → Manage deployments**.
4. Edit the existing Web App deployment.
5. Create a **new version** and deploy.

The `/exec` URL normally stays the same for that deployment.
