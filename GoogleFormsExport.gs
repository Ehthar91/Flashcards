/**
 * Flashcards → Google Forms Quiz exporter
 *
 * Deploy this as a Google Apps Script Web App.
 * The Flashcards website sends a native POST request containing quiz JSON.
 *
 * This version uses Apps Script's built-in FormApp service only.
 * It does NOT require the Google Forms REST API to be enabled.
 */

function doGet() {
  return HtmlService.createHtmlOutput(
    buildInfoPage_(
      'Flashcards Google Forms Export',
      'This web app is ready. Return to Flashcards and use Export with Google Apps Script.'
    )
  ).setTitle('Flashcards Google Forms Export');
}

function doPost(e) {
  try {
    if (!e || !e.parameter || !e.parameter.payload) {
      throw new Error('No quiz payload was received.');
    }

    var payload = JSON.parse(e.parameter.payload);
    validatePayload_(payload);

    var title = cleanText_(payload.title) || 'Flashcards Quiz';
    var className = cleanText_(payload.className);
    var pointsEach = normalizePoints_(payload.pointsEach);
    var questions = payload.questions;

    var form = FormApp.create(title);
    form
      .setIsQuiz(true)
      .setDescription(
        'Created from Flashcards' +
        (className ? ' — ' + className : '') +
        '. ' + questions.length + ' question' +
        (questions.length === 1 ? '' : 's') + '.'
      )
      .setProgressBar(true)
      .setShuffleQuestions(false)
      .setConfirmationMessage('Your quiz has been submitted.');

    var typedCount = 0;

    questions.forEach(function(q, index) {
      var prompt = cleanText_(q.prompt);
      var answer = String(q.answer == null ? '' : q.answer).trim();
      var deckName = cleanText_(q.deckName);

      if (!prompt) {
        throw new Error('Question ' + (index + 1) + ' has no question text.');
      }

      if (!answer) {
        throw new Error('Question ' + (index + 1) + ' has no answer.');
      }

      if (q.type === 'multiple' && Array.isArray(q.options)) {
        addMultipleChoiceQuestion_(
          form,
          prompt,
          answer,
          q.options,
          deckName,
          pointsEach
        );
      } else {
        typedCount += 1;
        addTypedQuestion_(
          form,
          prompt,
          answer,
          deckName,
          pointsEach
        );
      }
    });

    var editUrl = form.getEditUrl();
    var respondUrl = form.getPublishedUrl();

    return HtmlService.createHtmlOutput(
      buildSuccessPage_(title, questions.length, typedCount, editUrl, respondUrl)
    ).setTitle('Google Form Quiz Created');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      buildErrorPage_(err && err.message ? err.message : String(err))
    ).setTitle('Flashcards Export Error');
  }
}

function addMultipleChoiceQuestion_(form, prompt, answer, options, deckName, points) {
  var unique = uniqueStrings_(options);
  var normalizedAnswer = normalize_(answer);

  if (!unique.some(function(v) { return normalize_(v) === normalizedAnswer; })) {
    unique.push(answer);
  }

  if (unique.length < 2) {
    addTypedQuestion_(form, prompt, answer, deckName, points);
    return;
  }

  var item = form.addMultipleChoiceItem();
  item
    .setTitle(prompt)
    .setRequired(true)
    .setPoints(points);

  if (deckName) item.setHelpText('Deck: ' + deckName);

  var choices = unique.map(function(value) {
    return item.createChoice(value, normalize_(value) === normalizedAnswer);
  });

  item.setChoices(choices);

  var rightFeedback = FormApp.createFeedback()
    .setText('Correct.')
    .build();

  var wrongFeedback = FormApp.createFeedback()
    .setText('Correct answer: ' + answer)
    .build();

  item
    .setFeedbackForCorrect(rightFeedback)
    .setFeedbackForIncorrect(wrongFeedback);
}

function addTypedQuestion_(form, prompt, answer, deckName, points) {
  var item = form.addTextItem();
  item
    .setTitle(prompt)
    .setRequired(true)
    .setPoints(points);

  if (deckName) item.setHelpText('Deck: ' + deckName);

  // The built-in FormApp TextItem service can assign points, but it does not
  // expose an answer-key setter for automatic short-answer grading.
  // Store the intended answer in general quiz feedback for the teacher.
  var feedback = FormApp.createFeedback()
    .setText('Answer key: ' + answer)
    .build();

  item.setGeneralFeedback(feedback);
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The quiz payload is invalid.');
  }

  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    throw new Error('The quiz does not contain any questions.');
  }

  if (payload.questions.length > 300) {
    throw new Error('This exporter supports up to 300 questions at a time.');
  }
}

function normalizePoints_(value) {
  var n = Number(value);
  if (!isFinite(n)) n = 1;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanText_(value) {
  return String(value == null ? '' : value).trim();
}

function normalize_(value) {
  return cleanText_(value).toLowerCase().replace(/\s+/g, ' ');
}

function uniqueStrings_(values) {
  var seen = {};
  var out = [];

  (values || []).forEach(function(value) {
    var text = cleanText_(value);
    var key = normalize_(text);

    if (!text || seen[key]) return;

    seen[key] = true;
    out.push(text);
  });

  return out;
}

function buildSuccessPage_(title, questionCount, typedCount, editUrl, respondUrl) {
  var typedNote = typedCount
    ? '<div class="note"><strong>Typed-answer note:</strong> ' +
      typedCount + ' short-answer question' + (typedCount === 1 ? '' : 's') +
      ' were created with points, but Google Apps Script FormApp does not provide ' +
      'an automatic short-answer answer-key setter. Review those questions in Forms before assigning.</div>'
    : '';

  return pageShell_(
    'Google Form Quiz Created',
    '<div class="successMark">✓</div>' +
    '<h1>Google Form Quiz Created</h1>' +
    '<p class="lead">' + htmlEscape_(title) + '</p>' +
    '<div class="stat">' + questionCount + ' question' +
      (questionCount === 1 ? '' : 's') + '</div>' +
    typedNote +
    '<div class="actions">' +
      '<a class="primary" href="' + htmlAttr_(editUrl) + '" target="_blank">Open Form Editor</a>' +
      '<a class="secondary" href="' + htmlAttr_(respondUrl) + '" target="_blank">Open Student Quiz</a>' +
    '</div>' +
    '<p class="small">You can close this tab after opening the Form.</p>'
  );
}

function buildErrorPage_(message) {
  return pageShell_(
    'Export Error',
    '<div class="errorMark">!</div>' +
    '<h1>Could not create the Google Form</h1>' +
    '<p class="lead">' + htmlEscape_(message) + '</p>' +
    '<p class="small">Return to Flashcards, check the Apps Script deployment, and try again.</p>'
  );
}

function buildInfoPage_(title, message) {
  return pageShell_(
    title,
    '<h1>' + htmlEscape_(title) + '</h1>' +
    '<p class="lead">' + htmlEscape_(message) + '</p>'
  );
}

function pageShell_(title, body) {
  return '<!doctype html>' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + htmlEscape_(title) + '</title>' +
    '<style>' +
      'body{margin:0;font-family:Arial,sans-serif;background:#eef3f7;color:#19354d}' +
      '.wrap{max-width:680px;margin:70px auto;padding:34px;background:#fff;border-radius:20px;' +
      'box-shadow:0 14px 34px rgba(24,50,74,.12);text-align:center}' +
      'h1{margin:8px 0 10px} .lead{font-size:18px;color:#667f91}' +
      '.successMark,.errorMark{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;' +
      'display:grid;place-items:center;color:#fff;font-size:32px;font-weight:700}' +
      '.successMark{background:#40b7a2}.errorMark{background:#d85d66}' +
      '.stat{display:inline-block;margin:12px 0;padding:8px 13px;border-radius:999px;background:#e9f5fa}' +
      '.note{margin:18px 0;padding:14px;border-radius:12px;background:#fff5e6;text-align:left;line-height:1.5}' +
      '.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}' +
      'a{padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700}' +
      '.primary{background:#4eb9df;color:#fff}.secondary{background:#eaf8f5;color:#247b6e}' +
      '.small{margin-top:20px;font-size:13px;color:#7d909e}' +
    '</style></head><body><main class="wrap">' + body + '</main></body></html>';
}

function htmlEscape_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlAttr_(value) {
  return htmlEscape_(value);
}
