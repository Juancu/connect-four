import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDesigner } from "./build-designer.mjs";

const HOME = "https://tagger.scryfall.com/";
const ENDPOINT = "https://tagger.scryfall.com/graphql";
const USER_AGENT = "connectTag/0.1 (personal Connections-style tag game; artwork archive)";
const ROOT = path.resolve(import.meta.dirname, "..");
const ART_DIR = path.join(ROOT, "data", "art");
const INDEX_FILE = path.join(ROOT, "data", "artwork-index.json");
const PAGE_PAUSE_MS = 700;
const IMAGE_PAUSE_MS = 350;
const TAG_PAUSE_MS = 800;

const QUERY = `
  query FetchTag($type: TagType!, $slug: String!, $page: Int = 1, $descendants: Boolean = false) {
    tag: tagBySlug(type: $type, slug: $slug, aliasing: true) {
      name
      slug
      taggings(page: $page, descendants: $descendants) {
        page
        perPage
        total
        results {
          status
          card { artImageUrl illustrationId }
          preferredCard { artImageUrl illustrationId }
        }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSession() {
  const page = await fetch(HOME, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!page.ok) throw new Error(`Tagger homepage failed: ${page.status}`);
  const cookie = (page.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
  const html = await page.text();
  const token = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
  if (!cookie || !token) throw new Error("Tagger did not return a session.");
  return { cookie, token };
}

async function fetchTagPage(session, slug, pageNumber) {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
        origin: "https://tagger.scryfall.com",
        referer: `${HOME}tags/artwork/${slug}`,
        "x-csrf-token": session.token,
        cookie: session.cookie,
      },
      body: JSON.stringify({
        query: QUERY,
        operationName: "FetchTag",
        variables: { type: "ILLUSTRATION_TAG", slug, page: pageNumber, descendants: false },
      }),
    });

    if (response.status === 422 || response.status === 401 || response.status === 403) {
      const fresh = await openSession();
      session.cookie = fresh.cookie;
      session.token = fresh.token;
      lastError = new Error(`Auth failed for ${slug} page ${pageNumber}`);
      await sleep(1000 * attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt;
      console.warn(`${slug} page ${pageNumber} got ${response.status}; waiting ${waitMs}ms`);
      lastError = new Error(`${slug} page ${pageNumber} returned ${response.status}`);
      await sleep(waitMs);
      continue;
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      lastError = new Error(payload.errors.map((error) => error.message).join("; "));
      await sleep(1000 * attempt);
      continue;
    }
    const tag = payload?.data?.tag;
    if (!tag?.taggings) {
      lastError = new Error(`No taggings for ${slug}`);
      await sleep(1000 * attempt);
      continue;
    }
    return tag;
  }
  throw lastError ?? new Error(`Failed to fetch ${slug}`);
}

async function fetchIllustrationIds(session, slug) {
  const ids = [];
  const seen = new Set();
  let pageNumber = 1;
  let total = Infinity;
  let perPage = 75;
  while ((pageNumber - 1) * perPage < total) {
    const tagPage = await fetchTagPage(session, slug, pageNumber);
    total = tagPage.taggings.total;
    perPage = tagPage.taggings.perPage || perPage;
    for (const result of tagPage.taggings.results) {
      if (result.status !== "GOOD_STANDING") continue;
      const card = result.preferredCard?.artImageUrl ? result.preferredCard : result.card;
      if (!card?.artImageUrl || !card.illustrationId || seen.has(card.illustrationId)) continue;
      seen.add(card.illustrationId);
      ids.push({ id: card.illustrationId, url: card.artImageUrl });
    }
    if (tagPage.taggings.results.length === 0) break;
    pageNumber += 1;
    if ((pageNumber - 1) * perPage < total) await sleep(PAGE_PAUSE_MS);
  }
  return ids;
}

async function fileReady(file) {
  try {
    const info = await stat(file);
    return info.size >= 2000;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function downloadImage(url, file) {
  if (await fileReady(file)) return;
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*" } });
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 4000 * attempt;
      console.warn(`Image got ${response.status}; waiting ${waitMs}ms`);
      lastError = new Error(`${url} returned ${response.status}`);
      await sleep(waitMs);
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`${url} returned ${response.status}`);
      await sleep(500 * attempt);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2000) {
      lastError = new Error(`${url} was too small to be an image`);
      await sleep(500 * attempt);
      continue;
    }
    await writeFile(file, bytes);
    return;
  }
  throw lastError ?? new Error(`Could not download ${url}`);
}

async function loadIndex() {
  try {
    return JSON.parse(await readFile(INDEX_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { updatedAt: null, tags: {} };
    throw error;
  }
}

async function saveIndex(index) {
  index.updatedAt = new Date().toISOString();
  const temp = `${INDEX_FILE}.tmp`;
  await writeFile(temp, JSON.stringify(index));
  await rename(temp, INDEX_FILE);
}

async function main() {
  const picks = JSON.parse(await readFile(path.join(ROOT, "data", "interesting-tags.json"), "utf8"));
  const artwork = picks.filter((tag) => tag.namespace === "artwork");
  const index = await loadIndex();
  index.tags ??= {};
  await mkdir(ART_DIR, { recursive: true });
  const session = await openSession();
  console.log(`Mining ${artwork.length} artwork tags. Already complete: ${artwork.filter((tag) => index.tags[tag.slug]?.complete).length}.`);

  let finishedThisRun = 0;
  for (let indexNumber = 0; indexNumber < artwork.length; indexNumber += 1) {
    const tag = artwork[indexNumber];
    if (index.tags[tag.slug]?.complete) continue;
    const pictures = await fetchIllustrationIds(session, tag.slug);
    for (const picture of pictures) {
      const file = path.join(ART_DIR, `${picture.id}.jpg`);
      const already = await fileReady(file);
      await downloadImage(picture.url, file);
      if (!already) await sleep(IMAGE_PAUSE_MS);
    }
    index.tags[tag.slug] = {
      name: tag.name,
      slug: tag.slug,
      complete: true,
      images: pictures.map((picture) => picture.id),
    };
    await saveIndex(index);
    finishedThisRun += 1;
    const done = artwork.filter((item) => index.tags[item.slug]?.complete).length;
    console.log(`saved ${done}/${artwork.length} ${tag.name} (${pictures.length} pictures)`);
    if (finishedThisRun === 1 || finishedThisRun % 5 === 0) await buildDesigner();
    if (indexNumber < artwork.length - 1) await sleep(TAG_PAUSE_MS);
  }

  await buildDesigner();
  console.log("Mining finished.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
