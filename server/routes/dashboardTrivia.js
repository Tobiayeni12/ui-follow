// Protected dashboard API for the trivia game: run the game (ask / reveal /
// clear), manage the question bank, the leaderboard and the settings.
// Starting a question here goes straight to the live overlay — the dashboard
// preview is just another listener on the same game.
const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const store = require('../services/triviaStore');
const game = require('../services/triviaGame');
const configStore = require('../services/tiktokLiveConfigStore');
const { parseBulk } = require('../services/triviaLogic');
const hub = require('../websocket/hub');

const router = express.Router();
router.use(requireAuth);
router.use(express.json({ limit: '200kb' }));

// Express 4 doesn't catch rejected promises from async handlers. Input
// problems (TriviaInputError) are the dashboard's to show as a 400; anything
// else is logged and returned as a plain 500 so it can't crash the server.
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof store.TriviaInputError) return res.status(400).json({ error: err.message });
    console.error('[trivia] request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
};

const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);

async function fullState() {
  const [questions, leaderboard, settings, host] = await Promise.all([
    store.listQuestions(),
    store.getLeaderboard(50),
    store.getSettings(),
    configStore.getUsername(),
  ]);
  return { questions, leaderboard, settings, defaults: store.DEFAULT_SETTINGS, host, round: game.adminRound() };
}

// Re-publish so the overlay's board/settings follow dashboard edits.
const republish = () => game.publish().catch(() => {});

router.get('/dashboard/trivia', wrap(async (req, res) => {
  res.json(await fullState());
}));

// small, polled by the dashboard while it's open
router.get('/dashboard/trivia/round', wrap(async (req, res) => {
  res.json({ round: game.adminRound(), leaderboard: await store.getLeaderboard(10) });
}));

router.post('/dashboard/trivia/start', wrap(async (req, res) => {
  const round = await game.start({ id: req.body && req.body.id ? str(req.body.id, 80) : undefined });
  res.json({ round, questions: await store.listQuestions() });
}));

router.post('/dashboard/trivia/reveal', wrap(async (req, res) => {
  res.json({ round: await game.reveal() });
}));

// The playlist: runs through the ticked questions on its own until it ends or
// is stopped. `afterCurrent` lets the question on screen finish first.
router.post('/dashboard/trivia/playlist/start', wrap(async (req, res) => {
  const round = await game.startPlaylist();
  res.json({ round, questions: await store.listQuestions() });
}));

router.post('/dashboard/trivia/playlist/stop', wrap(async (req, res) => {
  res.json({ round: await game.stopPlaylist({ afterCurrent: !!(req.body && req.body.afterCurrent) }) });
}));

router.post('/dashboard/trivia/clear', wrap(async (req, res) => {
  res.json({ round: await game.clear() });
}));

// ------------------------------------------------------------- questions

router.post('/dashboard/trivia/questions', wrap(async (req, res) => {
  const b = req.body || {};
  await store.addQuestion({ text: b.text, answers: b.answers, points: b.points });
  res.json({ questions: await store.listQuestions() });
}));

router.post('/dashboard/trivia/questions/import', wrap(async (req, res) => {
  const settings = await store.getSettings();
  const { questions, skipped } = parseBulk(str(req.body && req.body.text, 100000), settings.defaultPoints);
  if (!questions.length) {
    throw new store.TriviaInputError('No questions found. Use one per line: question | answer | alternate answer');
  }
  const { added, dropped } = await store.addQuestions(questions);
  res.json({ added, dropped, skipped, questions: await store.listQuestions() });
}));

router.post('/dashboard/trivia/questions/reorder', wrap(async (req, res) => {
  const ids = req.body && Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map((id) => str(id, 80)) : [];
  await store.reorderQuestions(ids);
  res.json({ questions: await store.listQuestions() });
}));

// tick / untick every question for the playlist
router.post('/dashboard/trivia/questions/playlist', wrap(async (req, res) => {
  await store.setAllInPlaylist(!!(req.body && req.body.value));
  res.json({ questions: await store.listQuestions() });
}));

router.post('/dashboard/trivia/questions/reset-asked', wrap(async (req, res) => {
  await store.resetAsked();
  res.json({ questions: await store.listQuestions() });
}));

router.patch('/dashboard/trivia/questions/:id', wrap(async (req, res) => {
  const b = req.body || {};
  await store.updateQuestion(req.params.id, {
    text: b.text,
    answers: b.answers,
    points: b.points,
    inPlaylist: typeof b.inPlaylist === 'boolean' ? b.inPlaylist : undefined,
  });
  res.json({ questions: await store.listQuestions() });
}));

router.delete('/dashboard/trivia/questions/:id', wrap(async (req, res) => {
  await store.deleteQuestion(req.params.id);
  res.json({ questions: await store.listQuestions() });
}));

// ----------------------------------------------------------- leaderboard

router.post('/dashboard/trivia/leaderboard/reset', wrap(async (req, res) => {
  await store.resetLeaderboard();
  await republish();
  res.json({ leaderboard: [] });
}));

router.delete('/dashboard/trivia/leaderboard/:uniqueId', wrap(async (req, res) => {
  await store.removeFromLeaderboard(req.params.uniqueId);
  await republish();
  res.json({ leaderboard: await store.getLeaderboard(50) });
}));

// -------------------------------------------------------------- settings

router.post('/dashboard/trivia/settings', wrap(async (req, res) => {
  const settings = await store.updateSettings(req.body || {});
  await republish();
  res.json(settings);
}));

// ------------------------------------------------------------ fake chat

// Plays a chat message into the game exactly as a real one would, so the
// whole thing can be rehearsed off-stream. (It scores real points — use
// "Reset leaderboard" before going live.)
router.post('/dashboard/trivia/test-chat', wrap(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40).trim().replace(/^@/, '') || 'testviewer';
  const text = str(b.text, 300).trim();
  if (!text) throw new store.TriviaInputError('Type a chat message to send.');
  const claimed = game.handleChat({ uniqueId: username, nickname: username, comment: text }, { isTest: true });
  if (claimed) await claimed;
  res.json({ round: game.adminRound(), leaderboard: await store.getLeaderboard(10) });
}));

module.exports = router;
