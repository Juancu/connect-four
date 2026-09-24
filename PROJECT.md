# connectTag

A Connections-style game whose tiles are pictures, not words. Groups come from [Scryfall Tagger](https://tagger.scryfall.com/), a crowdsourced tag catalog for Magic: The Gathering cards and illustrations. The finished game should be playable in a browser first, and later as a Discord bot.

## How a round works

The player sees a 4×4 grid of picture buttons. Each button toggles between selected and unselected. There are four solution groups of four pictures, shuffled into the grid.

- **Submit** is used once four tiles are selected. If those four are a solution group, they leave the grid and join into one row at the top. That row shows the group title in bold (for example, **Animals**) and the four pictures together.
- Solved rows stack at the top. The remaining tiles stay in the grid below.
- **Shuffle** reorders the unsolved tiles.
- **Deselect all** clears the current selection.
- **Mistakes remaining** starts as four grey circles. Each wrong submit turns one circle red. The fifth wrong submit loses the game.

A win is solving all four groups before that fifth mistake.

## Build order

1. **Catalog tags.** POST `SearchTags` to `https://tagger.scryfall.com/graphql` and page through every tag. This is the current step. Output lives in `data/tags.json`, with a short breakdown in `data/tag-counts.json`.
2. **Choose interesting tags.** Open `tag-picker.html` (double-click). It lists tags with a tagging count from 9 through 200. Click rows to mark them, then **Copy JSON**. That array is the list to scrape for images. Rebuild the page with `npm run build:picker` after a new tag fetch.
3. **Read the cards in those tags.** `npm run puzzle` asks Tagger’s `FetchTag` query for artwork tags from `data/interesting-tags.json`, keeps four random pictures from each of four random tags, and writes a playable page.
4. **Program the game.** The first playable page is `puzzle.html`. Browser UI for the grid, solved rows, mistake circles, and Shuffle / Deselect all / Submit.
5. **Discord.** Present the same game as a bot after the browser version is solid.

## Tag fetch

Tagger’s GraphQL endpoint expects a browser session: a `_scryfall_tagger_session` cookie and the `csrf-token` from the homepage, sent as `x-csrf-token`. A bare POST is rejected with `invalid authenticity token`.

The search input used here is `{ "name": null, "page": N }`. Page size is fixed by the server (100). `name: null` returns the full catalog rather than a name filter.

```bash
npm run fetch:tags
```

That runs `scripts/fetch-tags.mjs`. It resumes from `data/tags.checkpoint.json` if a previous run stopped early. The checkpoint is local scratch and is gitignored; `data/tags.json` is the catalog to keep.

Each tag keeps the `TagAttrs` fields from Tagger plus `taggingCount`: `category`, `createdAt`, `creatorId`, `id`, `name`, `namespace`, `pendingRevisions`, `slug`, `status`, `type`, `hasExemplaryTagging`, `description`.

Requests go one page at a time, with a short pause between them, and a user agent that identifies this project. A rate-limit response waits and retries instead of skipping the page.

## Catalog snapshot

Fetched 2026-09-24 (UTC). Tagger reported 16,301 tags and the saved file has 16,301, with no duplicate ids. `data/tags.json` is about 5.7 MB.

| Namespace | Type | Tags |
| --- | --- | --- |
| artwork | `ILLUSTRATION_TAG` | 11,603 |
| card | `ORACLE_CARD_TAG` | 4,557 |
| print | `PRINTING_TAG` | 141 |

Every tag in this pull is `GOOD_STANDING`. 165 are marked as categories, 3,287 have a description, and 3,226 have exemplary tagging. `data/tag-counts.json` is the same breakdown in machine-readable form.

Artwork tags describe illustrations (good picture groups). Card tags describe rules and oracle text. Print tags describe a specific printing. The classification step should pick which of these are fun groups before we download any card images.

## Tag picker

`tag-picker.html` is a self-contained page, so it opens from disk. Picks are remembered in this browser (`localStorage`) until cleared. **Copy JSON** writes only the tag names, so the list is easy to paste back:

```json
[
  "3d render (medium)",
  "a skeleton is in you"
]
```

Slugs and namespaces are stored in `data/interesting-tags.json` after a paste, so we can fetch pages. **Copy JSON** itself is only names. Artwork images come from `https://tagger.scryfall.com/tags/artwork/{slug}` via the `FetchTag` GraphQL query. **View** on a row opens that tag on Scryfall Tagger.

## Test puzzle

`data/interesting-tags.json` is the current selection: 215 tags, 212 of them artwork. The three card tags (`abrade`, `activate from graveyard`, `coin flip`) are not artwork pages, so picture puzzles skip them.

```bash
npm run puzzle
```

That picks four artwork tags at random, downloads four distinct art crops for each into `puzzle/images/`, and writes `puzzle.html`. Open that file by double-click. Running the command again replaces the puzzle. This random mode stays.

## Daily puzzle

`npm run mine` downloads every picture for the artwork tags in `data/interesting-tags.json`, slowly, into `data/art/`. Progress is kept in `data/artwork-index.json`, so a stopped run can continue. It refreshes `designer.html` along the way.

Open `designer.html` and click 4 pictures in a category. The row scrolls sideways. **Export** copies JSON for the categories that have 4 pictures. Selections last only until you close or reload the page, so the previous daily does not stay checked.

The current daily is hardcoded in `data/daily.json`. `npm run daily` writes `daily.html` for playing on this computer, and a small `site/` folder for hosting. `site/` contains only today’s page and its 16 pictures.

## Hosting and Discord

Host the `site` folder on any static HTTPS host (Cloudflare Pages, Netlify, or GitHub Pages). The public URL is the daily everyone can open in a browser.

The same page is the Discord activity. Each person who launches it plays the daily on their own board. A shared board for the whole channel would need a server, which this page does not have.

1. Create an application at https://discord.com/developers/applications.
2. Open **Activities** and add a URL mapping from `/` to the hosted site, including the trailing path Discord asks for.
3. Put that application’s numeric client id in `data/discord.json`, run `npm run daily`, and upload `site/` again.
4. Install the app on your server, then launch it from a channel’s app menu.

Until the client id is set, `site/index.html` is only the web page. Discord shows a loading spinner until the page calls the activity SDK, which happens only after that id is filled in.

## Tag picker

The tag table remembers marked rows in this browser. If that memory is empty, it marks the names already saved in `data/interesting-tags.json`. The last row you click is labeled in the toolbar. The saved list from the first pass is alphabetical and ends at **curved horizon**.

## What we are not doing yet

- A new daily replaces `data/daily.json` when the next export is pasted in, then `npm run daily` refreshes both `daily.html` and `site/`.
- The Discord application itself is created in the developer portal. This repo only has the page it loads.
- Players in one channel do not share a single board.
