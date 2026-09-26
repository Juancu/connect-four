// ==UserScript==
// @name         connectTag artwork picker
// @namespace    connecttag
// @version      1.0.0
// @description  Select Scryfall Tagger artwork, keep it across pages, reorder it, and copy the first four ids.
// @match        https://tagger.scryfall.com/tags/artwork/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Install: Tampermonkey or Violentmonkey → Create new script → paste this file.
// On an artwork tag page, click a picture to select it. The button at the top right
// opens your picks. Drag to reorder. Copy sends the first four ids.

(function () {
  const STORAGE_PREFIX = "connecttag.picks:";

  const style = document.createElement("style");
  style.textContent = `
    .connecttag-picked { outline: 3px solid #f0c14b; outline-offset: 2px; }
    .card-grid-item { position: relative; }
    .connecttag-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 2;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: #3c3832;
      color: #f6f1e7;
      font: 700 12px/22px "Segoe UI", system-ui, sans-serif;
      text-align: center;
      pointer-events: none;
    }
    .connecttag-badge-kept { background: #f0c14b; color: #1c160b; }
    #connecttag-open {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483646;
      height: 40px;
      padding: 0 14px;
      border: 0;
      border-radius: 999px;
      background: #f0c14b;
      color: #1c160b;
      font: 700 14px/40px "Segoe UI", system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    }
    #connecttag-panel {
      position: fixed;
      top: 64px;
      right: 16px;
      z-index: 2147483646;
      width: min(360px, calc(100vw - 32px));
      max-height: min(70vh, 640px);
      display: flex;
      flex-direction: column;
      padding: 14px;
      border-radius: 16px;
      background: #221f1b;
      color: #f6f1e7;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
      font: 14px/1.4 "Segoe UI", system-ui, sans-serif;
    }
    #connecttag-panel[hidden] { display: none; }
    #connecttag-panel h2 { margin: 0 0 4px; font-size: 16px; }
    #connecttag-panel p { margin: 0 0 10px; color: #b7b0a4; font-size: 13px; }
    #connecttag-list { overflow: auto; display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .connecttag-pick {
      display: grid;
      grid-template-columns: 28px 72px 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 6px;
      border-radius: 10px;
      background: #2c2823;
      cursor: grab;
    }
    .connecttag-pick.is-kept { box-shadow: inset 0 0 0 2px #f0c14b; }
    .connecttag-pick img { width: 72px; height: 58px; object-fit: contain; background: #141311; border-radius: 6px; }
    .connecttag-pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .connecttag-pick button {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #f6f1e7;
      cursor: pointer;
    }
    #connecttag-actions { display: flex; gap: 8px; margin-top: 12px; }
    #connecttag-actions button {
      flex: 1;
      height: 36px;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    #connecttag-copy { background: #f0c14b; color: #1c160b; }
    #connecttag-copy:disabled { opacity: 0.45; cursor: not-allowed; }
    #connecttag-clear { background: transparent; color: #f6f1e7; box-shadow: inset 0 0 0 1px #5c564c; }
    #connecttag-note { min-height: 1.2em; margin: 8px 0 0; color: #f0c14b; font-weight: 700; }
  `;
  document.documentElement.append(style);

  function storageKey() {
    return STORAGE_PREFIX + location.pathname;
  }

  function loadPicks() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey()) || "[]");
      return Array.isArray(stored) ? stored.filter((pick) => pick && typeof pick.id === "string") : [];
    } catch {
      return [];
    }
  }

  function savePicks() {
    localStorage.setItem(storageKey(), JSON.stringify(picks));
  }

  function idFromImage(image) {
    const src = image.currentSrc || image.src || image.getAttribute("data-src") || "";
    return src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
  }

  let picks = loadPicks();
  let dragId = "";

  const openButton = document.createElement("button");
  openButton.id = "connecttag-open";
  openButton.type = "button";
  const panel = document.createElement("aside");
  panel.id = "connecttag-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Selected art</h2>
    <p>Drag to reorder. Copy uses the first four, in this order. Picks stay when you change pages.</p>
    <ol id="connecttag-list"></ol>
    <div id="connecttag-actions">
      <button type="button" id="connecttag-copy">Copy first 4</button>
      <button type="button" id="connecttag-clear">Clear</button>
    </div>
    <p id="connecttag-note" role="status"></p>
  `;
  document.documentElement.append(openButton, panel);
  const list = panel.querySelector("#connecttag-list");
  const copyButton = panel.querySelector("#connecttag-copy");
  const note = panel.querySelector("#connecttag-note");

  function paintGrid() {
    const order = new Map(picks.map((pick, index) => [pick.id, index + 1]));
    for (const item of document.querySelectorAll(".card-grid-item")) {
      const image = item.querySelector("a.artwork img");
      const id = image ? idFromImage(image) : "";
      const place = order.get(id) || 0;
      item.classList.toggle("connecttag-picked", place > 0);
      let badge = [...item.children].find((child) => child.classList?.contains("connecttag-badge"));
      if (!place) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "connecttag-badge";
        item.append(badge);
      }
      badge.textContent = String(place);
      badge.classList.toggle("connecttag-badge-kept", place <= 4);
    }
  }

  function renderPanel() {
    openButton.textContent = picks.length === 1 ? "1 pick" : `${picks.length} picks`;
    copyButton.disabled = picks.length === 0;
    copyButton.textContent = picks.length >= 4 ? "Copy first 4" : `Copy ${picks.length}`;
    list.replaceChildren();
    picks.forEach((pick, index) => {
      const row = document.createElement("li");
      row.className = "connecttag-pick";
      if (index < 4) row.classList.add("is-kept");
      row.draggable = true;
      row.dataset.id = pick.id;
      const number = document.createElement("strong");
      number.textContent = String(index + 1);
      const image = document.createElement("img");
      image.src = pick.src;
      image.alt = "";
      image.draggable = false;
      const name = document.createElement("span");
      name.textContent = pick.name || pick.id;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove");
      remove.addEventListener("click", () => {
        picks = picks.filter((item) => item.id !== pick.id);
        savePicks();
        renderPanel();
        paintGrid();
      });
      row.append(number, image, name, remove);
      row.addEventListener("dragstart", () => {
        dragId = pick.id;
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = picks.findIndex((item) => item.id === dragId);
        const to = picks.findIndex((item) => item.id === pick.id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = picks.splice(from, 1);
        picks.splice(to, 0, moved);
        savePicks();
        renderPanel();
        paintGrid();
      });
      list.append(row);
    });
  }

  function toggleFromArt(art) {
    const image = art.querySelector("img");
    if (!image) return;
    const id = idFromImage(image);
    if (!id) return;
    const existing = picks.findIndex((pick) => pick.id === id);
    if (existing >= 0) picks.splice(existing, 1);
    else {
      picks.push({
        id,
        src: image.currentSrc || image.src || image.getAttribute("data-src") || "",
        name: image.alt || art.closest(".card-grid-item")?.querySelector(".tag-row a")?.textContent?.trim() || "",
      });
    }
    savePicks();
    renderPanel();
    paintGrid();
  }

  document.addEventListener("click", (event) => {
    const art = event.target.closest?.(".card-grid-item a.artwork");
    if (!art) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFromArt(art);
  }, true);

  openButton.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    note.textContent = "";
  });

  copyButton.addEventListener("click", async () => {
    const ids = picks.slice(0, 4).map((pick) => pick.id);
    const text = JSON.stringify(ids, null, 2);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      area.remove();
    }
    note.textContent = copied
      ? `Copied ${ids.length} id${ids.length === 1 ? "" : "s"}.`
      : "Clipboard was blocked.";
  });

  panel.querySelector("#connecttag-clear").addEventListener("click", () => {
    picks = [];
    savePicks();
    note.textContent = "";
    renderPanel();
    paintGrid();
  });

  let path = location.pathname;
  function syncPath() {
    if (location.pathname === path) return;
    path = location.pathname;
    picks = loadPicks();
    renderPanel();
    paintGrid();
  }
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = pushState.apply(this, args);
    syncPath();
    return result;
  };
  history.replaceState = function (...args) {
    const result = replaceState.apply(this, args);
    syncPath();
    return result;
  };
  window.addEventListener("popstate", syncPath);

  let paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      paintGrid();
    });
  }
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => ![openButton, panel, style].includes(mutation.target) && !panel.contains(mutation.target))) {
      schedulePaint();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  renderPanel();
  paintGrid();
})();
