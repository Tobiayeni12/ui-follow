// The GTA 6 objectives checklist — its own list, separate from /objectives,
// so each overlay can show different things.
const { createObjectivesStore } = require('./objectivesStore');

module.exports = createObjectivesStore('gta6_objectives');
