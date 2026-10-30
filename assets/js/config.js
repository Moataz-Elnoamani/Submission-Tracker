/*
 * Portal configuration — the ONLY file you normally edit.
 *
 * Nothing secret belongs here: this file is public on GitHub Pages.
 * The Opus service key, Google OAuth credentials and the manager passcode
 * live in the Cloudflare Worker (worker/), set as encrypted secrets.
 */
window.PORTAL_CONFIG = {
  // URL of the deployed worker, e.g. "https://mn-portal-api.<you>.workers.dev".
  // Leave empty to run the portal in DEMO mode with sample data (nothing is sent).
  API_BASE: "",

  // Display
  PORTAL_TITLE: "Submission Tracker",
  PROGRAM_NAME: "\"MN\" Weekly Workflow Exercise",

  // Opus workflow this portal feeds ("MN" Submission Tracker)
  WORKFLOW_ID: "23a4ac11-3fe8-4172-a317-4422e8040de6",
  WORKFLOW_BUILDER_URL:
    "https://app.opus.com/app/builder/workflow/23a4ac11-3fe8-4172-a317-4422e8040de6?builderType=OPUS_V2",

  // A builder link must contain this to be written as a hyperlink by the
  // "Log Submission To Tracker" node (same marker as the node's code).
  BUILDER_URL_MARKER: "https://app.opus.com/app/builder/workflow",

  // The workflow input "Sub-Workflow(s) Builder URL" is object{0,1,2} — 3 slots.
  // Raise this only after changing that input to a List in the Builder.
  MAX_SUB_WORKFLOWS: 3,
  MAX_FILES: 10,
  MAX_FILE_MB: 25,

  // A weekly tab is open for this many days after its date (next tab = deadline).
  WEEK_LENGTH_DAYS: 7,

  // How often the portal polls an Opus case after submitting (ms) and the give-up limit.
  POLL_INTERVAL_MS: 3000,
  POLL_TIMEOUT_MS: 5 * 60 * 1000,
};
