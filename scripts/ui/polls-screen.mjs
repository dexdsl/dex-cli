import prompts from 'prompts';
import { readPollsFile } from '../lib/polls-store.mjs';

function formatPollRow(poll) {
  const close = poll.closeAt ? new Date(poll.closeAt).toISOString().slice(0, 10) : 'n/a';
  return `${poll.id.padEnd(36)}  ${String(poll.status).padEnd(6)}  ${String(poll.visibility).padEnd(7)}  ${close}  ${poll.question}`;
}

function printSummary(data) {
  const polls = Array.isArray(data.polls) ? data.polls : [];
  const header = `${'id'.padEnd(36)}  ${'status'.padEnd(6)}  ${'scope'.padEnd(7)}  closeAt      question`;
  console.log(header);
  console.log('-'.repeat(Math.max(header.length, 120)));
  for (const poll of polls) {
    console.log(formatPollRow(poll));
  }
}

export async function runPollsScreen() {
  const { data, filePath } = await readPollsFile();
  console.log(`\nDex Polls dashboard (${filePath})\n`);
  printSummary(data);

  const answer = await prompts({
    type: 'select',
    name: 'action',
    message: 'Choose next action',
    choices: [
      { title: 'Validate', value: 'validate' },
      { title: 'Create poll', value: 'create' },
      { title: 'Edit poll', value: 'edit' },
      { title: 'Close poll', value: 'close' },
      { title: 'Open poll', value: 'open' },
      { title: 'Publish (test)', value: 'publish-test' },
      { title: 'Publish (prod)', value: 'publish-prod' },
      { title: 'Exit', value: 'exit' },
    ],
    initial: 0,
  });

  return answer.action || 'exit';
}
