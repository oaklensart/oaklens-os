// ---- Daily Wayback-Machine archival (cron) ----
//
// The `scheduled` trigger (wrangler.jsonc crons) submits every public page to
// the Internet Archive's Save Page Now API so the site has an independent
// off-Cloudflare copy. Submissions are spaced out to stay under SPN's
// per-minute rate limit; a 429 stops the run early and the next daily tick
// resumes. Extracted from worker.js (decomposition, manual §6.7).

import siteConfig from '../shared/config.js';
import { publicPages, pageDisabled } from '../shared/pages.js';

// Built from PUBLIC_PAGES (the sitemap list) against the configured canonical
// origin — cron ticks have no request to derive the origin from.
function archiveUrls(origin) {
  const urls = publicPages().map((p) => `${origin}${p}`);
  if (!pageDisabled('/archive/manifest.html')) urls.push(`${origin}/archive/manifest.html`);
  return urls;
}

// Space submissions out so we stay under Save Page Now's per-minute rate limit.
const ARCHIVE_SUBMIT_GAP_MS = 6000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Submit a single URL to Save Page Now. Returns true on success, false if it
// was rate-limited (so the caller can stop early and let the next tick resume).
async function submitArchiveCapture(env, target) {
  try {
    const res = await fetch('https://web.archive.org/save', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `LOW ${env.ARCHIVE_S3_ACCESS}:${env.ARCHIVE_S3_SECRET}`,
      },
      body: new URLSearchParams({
        url: target,
        skip_first_archive: '1',
        delay_wb_availability: '1',
      }).toString(),
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      console.warn(`[archive] rate-limited (429) on ${target}, retry-after=${retryAfter || 'n/a'}; stopping, will resume next daily tick`);
      return false;
    }

    if (!res.ok) {
      console.error(`[archive] capture POST failed for ${target}: HTTP ${res.status}`);
      return true;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      console.error(`[archive] response not JSON for ${target}`);
      return true;
    }

    if (data.job_id) {
      console.log(`[archive] capture submitted: job_id=${data.job_id} url=${target}`);
    } else {
      console.error(`[archive] no job_id for ${target}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return true;
  } catch (err) {
    console.error(`[archive] capture request failed for ${target}:`, err.message);
    return true;
  }
}

export async function runArchiveCapture(env) {
  // Off is a choice, not a fault: the Wayback capture is an optional feature,
  // and the first request's [health] line already lists it as off. This used to
  // console.error every day on every fork that never opted in (maintenance
  // review 2026-10-15, H3) — a daily red line in the logs for nothing broken.
  if (!env.ARCHIVE_S3_ACCESS || !env.ARCHIVE_S3_SECRET) return;
  if (!siteConfig.url) {
    console.warn('[archive] site.config url not set — skipping Wayback capture');
    return;
  }

  const targets = archiveUrls(siteConfig.url.replace(/\/+$/, ''));
  for (let i = 0; i < targets.length; i++) {
    const ok = await submitArchiveCapture(env, targets[i]);
    if (!ok) return; // hit the rate limit — bail and resume tomorrow
    if (i < targets.length - 1) await sleep(ARCHIVE_SUBMIT_GAP_MS);
  }
}
