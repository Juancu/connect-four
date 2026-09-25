import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const HOME = "https://tagger.scryfall.com/";
const ENDPOINT = "https://tagger.scryfall.com/graphql";
const USER_AGENT = "connectTag/0.1 (personal Connections-style tag game)";
const ROOT = path.resolve(import.meta.dirname, "..");
const IMAGE_DIR = path.join(ROOT, "puzzle", "images");
const PAUSE_MS = 250;

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
          card { id name artImageUrl illustrationId }
          preferredCard { id name artImageUrl illustrationId }
        }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function displayName(name) {
  return name.replace(/\p{L}+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
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
  for (let attempt = 1; attempt <= 5; attempt += 1) {
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
        variables: {
          type: "ILLUSTRATION_TAG",
          slug,
          page: pageNumber,
          descendants: false,
        },
      }),
    });

    if (response.status === 422 || response.status === 401 || response.status === 403) {
      const fresh = await openSession();
      session.cookie = fresh.cookie;
      session.token = fresh.token;
      lastError = new Error(`Auth failed for ${slug} page ${pageNumber}`);
      await sleep(500 * attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`${slug} page ${pageNumber} returned ${response.status}`);
      await sleep(1000 * attempt);
      continue;
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      lastError = new Error(payload.errors.map((error) => error.message).join("; "));
      await sleep(500 * attempt);
      continue;
    }
    const tag = payload?.data?.tag;
    if (!tag?.taggings) {
      lastError = new Error(`No taggings for ${slug}`);
      await sleep(500 * attempt);
      continue;
    }
    return tag;
  }
  throw lastError ?? new Error(`Failed to fetch ${slug}`);
}

async function fetchCards(session, tag) {
  const byIllustration = new Map();
  let pageNumber = 1;
  let total = Infinity;
  let perPage = 75;
  while ((pageNumber - 1) * perPage < total) {
    const tagPage = await fetchTagPage(session, tag.slug, pageNumber);
    total = tagPage.taggings.total;
    perPage = tagPage.taggings.perPage || perPage;
    for (const result of tagPage.taggings.results) {
      if (result.status !== "GOOD_STANDING") continue;
      const card = result.preferredCard?.artImageUrl ? result.preferredCard : result.card;
      if (!card?.artImageUrl || !card.illustrationId) continue;
      if (!byIllustration.has(card.illustrationId)) byIllustration.set(card.illustrationId, card);
    }
    if (tagPage.taggings.results.length === 0) break;
    pageNumber += 1;
    if ((pageNumber - 1) * perPage < total) await sleep(PAUSE_MS);
  }
  return [...byIllustration.values()];
}

async function downloadImage(url, file) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*" } });
    if (!response.ok) {
      lastError = new Error(`${url} returned ${response.status}`);
      await sleep(400 * attempt);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2000) {
      lastError = new Error(`${url} was too small to be an image`);
      await sleep(400 * attempt);
      continue;
    }
    await writeFile(file, bytes);
    return;
  }
  throw lastError ?? new Error(`Could not download ${url}`);
}

async function writePuzzle(puzzle) {
  const [template, client] = await Promise.all([
    readFile(path.join(ROOT, "scripts", "puzzle.template.html"), "utf8"),
    readFile(path.join(ROOT, "scripts", "puzzle-client.js"), "utf8"),
  ]);
  const data = JSON.stringify(puzzle).replace(/</g, "\\u003c");
  const html = template
    .replace("__PUZZLE_DATA__", () => data)
    .replace("/*__CLIENT__*/", () => client)
    .replace("__NAV__", () => "")
    .replace("__DISCORD__", () => "");
  await writeFile(path.join(ROOT, "puzzle.html"), html);
  console.log(`Puzzle groups: ${puzzle.groups.map((group) => group.name).join(", ")}`);
  console.log(`Wrote ${path.join(ROOT, "puzzle.html")}`);
}

async function readCurrentPuzzle() {
  const html = await readFile(path.join(ROOT, "puzzle.html"), "utf8");
  const marker = '<script id="puzzle-data" type="application/json">';
  const start = html.indexOf(marker);
  const end = html.indexOf("</script>", start);
  if (start < 0 || end < 0) throw new Error("Current puzzle data was not found.");
  return JSON.parse(html.slice(start + marker.length, end));
}

async function replaceGroup(slug) {
  const puzzle = await readCurrentPuzzle();
  const index = puzzle.groups.findIndex((group) => group.id === slug);
  if (index < 0) throw new Error(`This puzzle has no group "${slug}".`);

  for (const card of puzzle.groups[index].cards) {
    await rm(path.join(IMAGE_DIR, `${card.id}.jpg`), { force: true });
  }

  const used = new Set(
    puzzle.groups
      .filter((group) => group.id !== slug)
      .flatMap((group) => group.cards.map((card) => card.id)),
  );
  const tags = JSON.parse(await readFile(path.join(ROOT, "data", "interesting-tags.json"), "utf8"));
  const taken = new Set(puzzle.groups.map((group) => group.id));
  const artwork = tags.filter((tag) => tag.namespace === "artwork" && !taken.has(tag.slug));
  const session = await openSession();

  for (const tag of shuffle(artwork)) {
    const cards = await fetchCards(session, tag);
    const available = cards.filter((card) => !used.has(card.illustrationId));
    console.log(`${tag.name}: ${cards.length} pictures, ${available.length} unused`);
    if (available.length < 4) continue;
    const picked = shuffle(available).slice(0, 4);
    const saved = [];
    for (const card of picked) {
      const fileName = `${card.illustrationId}.jpg`;
      await downloadImage(card.artImageUrl, path.join(IMAGE_DIR, fileName));
      saved.push({ id: card.illustrationId, src: `puzzle/images/${fileName}` });
      await sleep(80);
    }
    puzzle.groups[index] = { id: tag.slug, name: displayName(tag.name), cards: saved };
    await writePuzzle(puzzle);
    return;
  }

  throw new Error(`Could not replace ${slug}.`);
}

async function main() {
  const replaceIndex = process.argv.indexOf("--replace");
  if (replaceIndex !== -1) {
    const slug = process.argv[replaceIndex + 1];
    if (!slug) throw new Error("Pass the group slug to replace, for example --replace cocoon");
    await replaceGroup(slug);
    return;
  }

  const tags = JSON.parse(await readFile(path.join(ROOT, "data", "interesting-tags.json"), "utf8"));
  const artwork = tags.filter((tag) => tag.namespace === "artwork");
  if (artwork.length < 4) throw new Error("Need at least 4 artwork tags.");

  const session = await openSession();
  const groups = [];
  const used = new Set();

  for (const tag of shuffle(artwork)) {
    if (groups.length === 4) break;
    const cards = await fetchCards(session, tag);
    const available = cards.filter((card) => !used.has(card.illustrationId));
    console.log(`${tag.name}: ${cards.length} pictures, ${available.length} unused`);
    if (available.length < 4) continue;
    const picked = shuffle(available).slice(0, 4);
    for (const card of picked) used.add(card.illustrationId);
    groups.push({ tag, cards: picked });
    if (groups.length < 4) await sleep(PAUSE_MS);
  }

  if (groups.length < 4) throw new Error("Could not fill four groups with distinct pictures.");

  await rm(IMAGE_DIR, { recursive: true, force: true });
  await mkdir(IMAGE_DIR, { recursive: true });

  const puzzle = { groups: [] };
  for (const group of groups) {
    const cards = [];
    for (const card of group.cards) {
      const fileName = `${card.illustrationId}.jpg`;
      await downloadImage(card.artImageUrl, path.join(IMAGE_DIR, fileName));
      cards.push({ id: card.illustrationId, src: `puzzle/images/${fileName}` });
      await sleep(80);
    }
    puzzle.groups.push({
      id: group.tag.slug,
      name: displayName(group.tag.name),
      cards,
    });
  }

  await writePuzzle(puzzle);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
