// Every chatgpt.com selector lives in this file. When ChatGPT changes its page, fixes go here only:
// run `docker compose run --rm gpt-checker npm run inspect -- --ask "test"` to see the current markup.
// Where an entry lists several selectors, the first is the current markup and the rest are older.

const ASSISTANT_CURRENT = 'li[data-message-role="assistant"]';

export const SELECTORS = {
  prompt: 'textarea[name="prompt"], #prompt-textarea',
  send: 'button[data-composer-submit][aria-label="Send message"], [data-testid="send-button"]',
  stop: 'button[data-composer-submit][aria-label="Stop generating"], [data-testid="stop-button"]',
  // The question as it appears in the chat once sent.
  userMessage: 'li[data-message-role="user"], [data-message-author-role="user"]',
  // One per answer, product cards included, in reading order.
  assistant: `${ASSISTANT_CURRENT}, [data-message-author-role="assistant"]`,
  assistantCurrent: ASSISTANT_CURRENT,
  // Attribute the current markup sets on an answer once it has finished streaming.
  completeAttribute: "data-message-complete",
  ads: "[data-conversation-ads-supplement]",
  // Source pills in an answer ("Mayo Clinic +2"). They open a popover; the links only load when it's
  // opened, so we record the names.
  sourcePill: '[data-d-component="popover-trigger"] [data-d-component="badge"]',
  authFlag: "[data-authenticated]",
  profileButton: '[data-testid="accounts-profile-button"]',
  loginButton: "[data-login-button]",
  challengeFrame: 'iframe[src*="challenges.cloudflare.com"]',
};

/** Page titles of verification interstitials. */
export const CHALLENGE_TITLE = /just a moment|attention required|verify you are human|performing security verification/i;

/** Page text that means ChatGPT won't answer any more right now. */
export const WALL_TEXT = /limit|too many requests|unusual activity|verify you are human|try again later/i;
