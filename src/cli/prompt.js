import inquirer from 'inquirer';

/**
 * Platarium Network CLI prompt standard: "Label:?"
 * - no leading "?" from inquirer; question mark after colon.
 */
export const PROMPT_SUFFIX = ':?';

export function promptMsg(text) {
  const trimmed = String(text).replace(/\?+$/, '').replace(/:+$/, '');
  return `${trimmed}${PROMPT_SUFFIX}`;
}

export async function ask(questions) {
  const list = Array.isArray(questions) ? questions : [questions];
  const normalized = list.map((q) => ({
    ...q,
    prefix: '',
    message: typeof q.message === 'string' ? promptMsg(q.message) : q.message,
  }));
  return inquirer.prompt(normalized);
}
