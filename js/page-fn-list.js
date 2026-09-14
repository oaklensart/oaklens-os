// FN//Blog listing page. Loaded deferred, after site-common.js. Externalized
// from an inline <script> so the page satisfies a strict script-src (no
// 'unsafe-inline'); see docs/os-launch-plan.md.

// FN// list renders hero thumbs from the archive CDN section.
const CDN_SECTION = 'archive';
function cdnSrc(filename, size) { return cdnUrl(CDN_SECTION, filename, size); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function loadPosts() {
  const list = document.getElementById('fn-list');
  const countEl = document.getElementById('fn-count');

  let posts;
  try {
    const res = await fetch('/data/posts.json');
    if (res.ok) {
      posts = await res.json();
    } else throw new Error('no json');
  } catch {
    posts = getSamplePosts();
  }

  // A posts file that loaded fine but holds nothing is the state every fresh
  // instance starts in — say so instead of rendering a blank page.
  if (!posts.length) {
    list.innerHTML =
      '<div class="page-empty">// NO FIELD NOTES YET' +
      '<span class="page-empty-hint">Write the first one in the Field Console.</span></div>';
    countEl.innerHTML = '<span class="accent">0</span> FIELD NOTES';
    return;
  }

  // Sort by date descending
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  posts.forEach((post, i) => {
    const entry = document.createElement('a');
    entry.href = `/field-notes/post?slug=${post.fn_id || post.id}`;
    entry.className = 'fn-entry reveal';
    entry.style.animationDelay = `${Math.min(i * 0.05, 0.5)}s`;

    const thumbHtml = post.hero
      ? `<img class="fn-entry-thumb" src="${cdnSrc(post.hero, 480)}" alt="" loading="lazy"${post.focus ? ` style="object-position:${post.focus}"` : ''}>`
      : `<div class="fn-entry-thumb no-hero">// NO HERO</div>`;

    entry.innerHTML = `
      ${thumbHtml}
      <div class="fn-entry-body">
        <div class="fn-entry-id">${post.fn_id || ''}</div>
        <div class="fn-entry-name">${post.title}</div>
        <div class="fn-entry-meta">
          ${post.location}<span class="sep">·</span>${formatDate(post.date)}
        </div>
      </div>
    `;
    list.appendChild(entry);
  });

  countEl.innerHTML = `<span class="accent">${posts.length}</span> FIELD NOTES`;
}

function getSamplePosts() {
  // A MISSING posts.json is an un-seeded fork, so list the bundled CC0 sample
  // note (posts/fn-sample.md — the post page serves it like any published
  // note, and its hero renders through the /api/cdn sample fallback). This
  // used to be a synthetic offline-error row, shown to every fresh fork. An
  // EMPTY posts.json still gets the honest "NO FIELD NOTES YET" state above;
  // publish a real note and the sample steps aside. Metadata mirrors the .md
  // frontmatter; the homepage (js/recent-index.js sampleNote) carries the
  // same note.
  return [
    { fn_id: 'fn-sample', title: 'Learning to See Again', location: 'Sample City', date: '2026-01-03', hero: 'sample-03.webp' }
  ];
}

loadPosts();
