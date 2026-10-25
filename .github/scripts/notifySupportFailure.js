// Independent of Firebase and third-party packages so failed price/config reads can still notify.
import { createHmac } from 'node:crypto';

async function main() {
  const endpoint = process.env.SUPPORT_ALERT_WEBHOOK;
  const key = process.env.SUPPORT_ALERT_WEBHOOK_KEY;
  if (!endpoint || !key) throw new Error('Support failure-notification connection is missing');
  const target = new URL(endpoint);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid notification endpoint');
  const test = process.argv.includes('--test');
  const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const payload = JSON.stringify({
    to_email: 'portfolio_owner', symbol: 'WORKFLOW FAILURE', name: 'Daily support check', test,
    action: test ? 'TEST — simulated workflow failure; no live failure occurred' : 'The daily support-alert job failed',
    plan_notes: test ? 'This is an isolated failure-notification delivery test. No portfolio data or alert state was changed.' :
      `Check the portfolio sync status and GitHub run: ${runUrl}. A failed run may leave support checks incomplete.`,
    triggered_at: new Date().toLocaleString('en-SG', {timeZone:'Asia/Singapore'}),
    request_timestamp: Date.now(),
  });
  const signature = createHmac('sha256',key).update(payload).digest('hex');
  const response = await fetch(target, {method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({payload,signature})});
  if (!response.ok) throw new Error(`Failure notifier HTTP ${response.status}`);
  let result;
  try {result=await response.json();} catch {throw new Error('Failure notifier did not confirm delivery');}
  if (result?.delivered !== true) throw new Error('Failure notifier did not confirm delivery');
  console.log(test ? 'Failure-notification test accepted; no portfolio changes' : 'Workflow-failure notification accepted');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
