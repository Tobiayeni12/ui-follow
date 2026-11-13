/** A validation problem the dashboard should show as-is (HTTP 400), not a server fault. */
class InputError extends Error {}

module.exports = { InputError };
