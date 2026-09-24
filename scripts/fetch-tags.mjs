import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://tagger.scryfall.com/graphql";
const HOME = "https://tagger.scryfall.com/";
const USER_AGENT = "connectTag/0.1 (personal Connections-style tag game; tag catalog)";
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "tags.json");
const COUNTS_FILE = path.join(DATA_DIR, "tag-counts.json");
const CHECKPOINT_FILE = path.join(DATA_DIR, "tags.checkpoint.json");

const REQUEST_PAUSE_MS = 350;
const MAX_RETRIES = 8;

const QUERY = `
        query SearchTags($input: TagSearchInput!) {
          tags(input: $input) {
            page
            perPage
            results {
              ...TagAttrs
              taggingCount
            }
            total
          }
        }
        
  fragment TagAttrs on Tag {
    category
    createdAt
    creatorId
    id
    name
    namespace
    pendingRevisions
    slug
    status
    type
    hasExemplaryTagging
    description
  }

      `;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSession() {
  const page = await fetch(HOME, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html",
    },
  });
  if (!page.ok) {
    throw new Error(`Homepage failed: ${page.status}`);
  }
  const cookie = (page.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  const html = await page.text();
  const token = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  if (!cookie || !token) {
    throw new Error("Scryfall Tagger did not return a session cookie and CSRF token.");
  }
  return { cookie, token };
}

async function searchPage(session, pageNumber) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
        origin: "https://tagger.scryfall.com",
        referer: HOME,
        "x-csrf-token": session.token,
        cookie: session.cookie,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { input: { name: null, page: pageNumber } },
        operationName: "SearchTags",
      }),
    });

    if (response.status === 422 || response.status === 401 || response.status === 403) {
      const fresh = await openSession();
      session.cookie = fresh.cookie;
      session.token = fresh.token;
      lastError = new Error(`Auth failed on page ${pageNumber} (${response.status})`);
      await sleep(500 * attempt);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 5000 * attempt;
      lastError = new Error(`Page ${pageNumber} returned ${response.status}`);
      console.warn(`Page ${pageNumber} got ${response.status}; waiting ${waitMs}ms (attempt ${attempt}/${MAX_RETRIES}).`);
      await sleep(waitMs);
      continue;
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      lastError = new Error(payload.errors.map((error) => error.message).join("; "));
      await sleep(500 * attempt);
      continue;
    }

    const tags = payload?.data?.tags;
    if (!tags || !Array.isArray(tags.results)) {
      lastError = new Error(`Page ${pageNumber} had no tag results`);
      await sleep(500 * attempt);
      continue;
    }

    return tags;
  }

  throw lastError ?? new Error(`Failed to fetch page ${pageNumber}`);
}

async function loadCheckpoint() {
  try {
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function countBy(tags, key) {
  const counts = {};
  for (const tag of tags) {
    const value = tag[key] == null || tag[key] === "" ? "(none)" : String(tag[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const session = await openSession();
  const checkpoint = (await loadCheckpoint()) ?? { pages: {} };
  checkpoint.pages ??= {};

  if (!checkpoint.pages["1"]) {
    const first = await searchPage(session, 1);
    checkpoint.total = first.total;
    checkpoint.perPage = first.perPage;
    checkpoint.pages["1"] = { page: first.page, results: first.results };
  }
  const pageCount = Math.ceil(checkpoint.total / checkpoint.perPage);
  console.log(`Catalog: ${checkpoint.total} tags, ${checkpoint.perPage} per page, ${pageCount} pages.`);

  const pending = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (!checkpoint.pages[String(pageNumber)]) pending.push(pageNumber);
  }
  console.log(`${pending.length} pages left to fetch.`);

  for (let index = 0; index < pending.length; index += 1) {
    const pageNumber = pending[index];
    const page = await searchPage(session, pageNumber);
    checkpoint.pages[String(page.page)] = { page: page.page, results: page.results };
    if ((index + 1) % 5 === 0 || index === pending.length - 1) {
      await writeFile(CHECKPOINT_FILE, JSON.stringify({
        total: checkpoint.total,
        perPage: checkpoint.perPage,
        pages: checkpoint.pages,
      }));
      const done = pageCount - pending.length + index + 1;
      console.log(`Saved through ${done}/${pageCount} pages.`);
    }
    if (index < pending.length - 1) await sleep(REQUEST_PAUSE_MS);
  }

  const tags = [];
  const seen = new Set();
  let duplicates = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = checkpoint.pages[String(pageNumber)];
    if (!page) throw new Error(`Missing page ${pageNumber} after fetch.`);
    for (const tag of page.results) {
      if (seen.has(tag.id)) {
        duplicates += 1;
        continue;
      }
      seen.add(tag.id);
      tags.push(tag);
    }
  }

  const fetchedAt = new Date().toISOString();
  const catalog = {
    source: ENDPOINT,
    operationName: "SearchTags",
    fetchedAt,
    totalReported: checkpoint.total,
    perPage: checkpoint.perPage,
    pageCount,
    count: tags.length,
    duplicateIdsSkipped: duplicates,
    tags,
  };
  const counts = {
    fetchedAt,
    count: tags.length,
    totalReported: checkpoint.total,
    duplicateIdsSkipped: duplicates,
    byNamespace: countBy(tags, "namespace"),
    byType: countBy(tags, "type"),
    byStatus: countBy(tags, "status"),
    categories: tags.filter((tag) => tag.category).length,
    withDescription: tags.filter((tag) => tag.description).length,
    withExemplaryTagging: tags.filter((tag) => tag.hasExemplaryTagging).length,
  };

  await writeFile(OUT_FILE, JSON.stringify(catalog));
  await writeFile(COUNTS_FILE, JSON.stringify(counts, null, 2));
  console.log(`Wrote ${tags.length} tags to ${OUT_FILE}`);
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
