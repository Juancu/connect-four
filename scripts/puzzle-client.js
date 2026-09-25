const puzzle = JSON.parse(document.getElementById("puzzle-data").textContent);

const board = document.querySelector("#board");
const solvedRows = document.querySelector("#solved");
const grid = document.querySelector("#grid");
const dots = [...document.querySelectorAll(".dot")];
const message = document.querySelector("#message");
const toast = document.querySelector("#toast");
const closeTip = document.querySelector("#close-tip");
const shuffleButton = document.querySelector("#shuffle");
const deselectButton = document.querySelector("#deselect");
const submitButton = document.querySelector("#submit");
const resultsButton = document.querySelector("#results");
const resultsLayer = document.querySelector("#results-layer");
const infoLayer = document.querySelector("#info-layer");
const resultsHeading = document.querySelector("#results-heading");
const resultsGrid = document.querySelector(".results-grid");
const shareButton = document.querySelector("#share");
const copiedNote = document.querySelector(".copied");

const cards = new Map();
for (const group of puzzle.groups) {
  for (const card of group.cards) {
    cards.set(card.id, { ...card, groupId: group.id });
  }
}

let unsolved = shuffle([...cards.keys()]);
const selected = [];
const solved = [];
const attempts = [];
const guesses = [];
const JUMP_MS = 320;
const SUSPENSE_MS = 480;
const SHAKE_MS = 800;
const FLY_MS = 780;
const shareTitle = puzzle.number == null
  ? "Tag Connections"
  : `Tag Connections #${String(puzzle.number).padStart(3, "0")}`;
const categoryEmoji = ["🟩", "🟦", "🟨", "🟪"];
let mistakes = 0;
let ended = false;
let busy = false;
let wrongIds = new Set();
let recallIndex = -1;
let lastPointer = "mouse";
const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function groupById(id) {
  return puzzle.groups.find((group) => group.id === id);
}

function isSelected(id) {
  return selected.includes(id);
}

function selectedGroup() {
  if (selected.length !== 4) return null;
  return puzzle.groups.find((group) => group.cards.every((card) => isSelected(card.id))) ?? null;
}

function isOneAway(ids) {
  const counts = new Map();
  for (const id of ids) {
    const groupId = cards.get(id).groupId;
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return [...counts.values()].includes(3);
}

let toastTimer = 0;
function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}

function showToast(lines) {
  toast.replaceChildren();
  for (const line of lines) {
    const row = document.createElement("span");
    row.textContent = line;
    toast.append(row);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function emojiFor(id) {
  const index = puzzle.groups.findIndex((group) => group.id === cards.get(id).groupId);
  const rank = Number(puzzle.groups[index]?.difficulty);
  const colorIndex = rank >= 1 && rank <= 4 ? rank - 1 : index;
  return categoryEmoji[colorIndex] ?? "⬜";
}

function resultsText() {
  const rows = guesses.map((guess) => guess.map(emojiFor).join("")).join("\n");
  return `${shareTitle}\n${rows}`;
}

function render({ pendingTitleId = null } = {}) {
  solvedRows.replaceChildren();
  const shown = [...solved];
  if (ended && ended !== "won") {
    for (const group of puzzle.groups) {
      if (!shown.includes(group.id)) shown.push(group.id);
    }
  }
  for (const groupId of shown) {
    const group = groupById(groupId);
    const row = document.createElement("div");
    row.className = "solved-row";
    if (groupId === pendingTitleId) row.classList.add("is-pending", "is-flying");
    for (const card of group.cards) {
      const cell = document.createElement("div");
      cell.className = "solved-cell";
      cell.dataset.id = card.id;
      cell.append(picture(card.src));
      row.append(cell);
    }
    const title = document.createElement("strong");
    title.textContent = group.name;
    if (group.note) {
      const note = document.createElement("span");
      note.className = "solved-note";
      note.textContent = group.note;
      title.append(note);
    }
    if (groupId === pendingTitleId) title.setAttribute("aria-hidden", "true");
    row.append(title);
    solvedRows.append(row);
  }

  grid.replaceChildren();
  if (ended) {
    grid.hidden = true;
  } else {
    grid.hidden = false;
    for (const id of unsolved) {
      const card = cards.get(id);
      const wrap = document.createElement("div");
      wrap.className = "tile-wrap";
      wrap.dataset.id = id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      if (wrongIds.has(id)) button.classList.add("is-wrong");
      button.setAttribute("aria-pressed", String(isSelected(id)));
      button.append(picture(card.src));
      button.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        toggle(id);
      });
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("selectstart", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || ended || busy) return;
        window.getSelection()?.removeAllRanges();
        const startX = event.clientX;
        const startY = event.clientY;
        const clearSelect = setInterval(() => window.getSelection()?.removeAllRanges(), 40);
        const hold = setTimeout(() => {
          suppressClick = true;
          openZoom(id);
        }, 500);
        const cancelHold = (move) => {
          if (move?.type === "pointermove" && Math.hypot(move.clientX - startX, move.clientY - startY) < 12) return;
          clearTimeout(hold);
          clearInterval(clearSelect);
          button.removeEventListener("pointermove", cancelHold);
          button.removeEventListener("pointerup", cancelHold);
          button.removeEventListener("pointercancel", cancelHold);
        };
        button.addEventListener("pointermove", cancelHold);
        button.addEventListener("pointerup", cancelHold);
        button.addEventListener("pointercancel", cancelHold);
      });
      wrap.append(button, loupeButton(id));
      wrap.addEventListener("pointerenter", (event) => {
        if (busy || event.pointerType !== "mouse") return;
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        wrap.classList.add("is-loupe");
      });
      wrap.addEventListener("pointerleave", () => {
        wrap.classList.remove("is-loupe");
      });
      grid.append(wrap);
    }
  }

  paintDots();

  if (pendingTitleId) message.textContent = "";
  else if (ended === "won") message.textContent = "You found all four groups.";
  else if (ended === "lost") message.textContent = "Five mistakes. The groups are shown above.";
  else if (wrongIds.size) message.textContent = "That isn’t one of the groups.";
  else message.textContent = "";

  shuffleButton.disabled = ended || unsolved.length < 2;
  deselectButton.disabled = ended || selected.length === 0;
  submitButton.disabled = ended || busy || selected.length !== 4;
  setFinished(Boolean(ended) && !pendingTitleId);
  if (!pendingTitleId) applyRecall();
}

const zoom = document.querySelector("#zoom");
const zoomImage = zoom.querySelector("img");
let suppressClick = false;
let zoomIds = [];
let zoomIndex = 0;
let zoomSwipe = null;

function showZoom() {
  if (!zoomIds.length) {
    closeZoom();
    return;
  }
  zoomIndex = (zoomIndex + zoomIds.length) % zoomIds.length;
  zoomImage.src = cards.get(zoomIds[zoomIndex]).src;
  zoom.hidden = false;
}

function openZoom(id) {
  zoomIds = [...unsolved];
  zoomIndex = Math.max(0, zoomIds.indexOf(id));
  showZoom();
}

function stepZoom(delta) {
  zoomIndex += delta;
  showZoom();
}

function closeZoom() {
  zoom.hidden = true;
  zoomImage.removeAttribute("src");
  zoomIds = [];
  zoomSwipe = null;
}

zoom.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".zoom-prev, .zoom-next")) return;
  zoomSwipe = { x: event.clientX, y: event.clientY };
});

zoom.addEventListener("pointerup", (event) => {
  if (event.target.closest(".zoom-prev, .zoom-next") || !zoomSwipe) return;
  const dx = event.clientX - zoomSwipe.x;
  const dy = event.clientY - zoomSwipe.y;
  zoomSwipe = null;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
    stepZoom(dx < 0 ? 1 : -1);
    return;
  }
  closeZoom();
});

document.querySelector(".zoom-prev").addEventListener("click", (event) => {
  event.stopPropagation();
  stepZoom(-1);
});
document.querySelector(".zoom-next").addEventListener("click", (event) => {
  event.stopPropagation();
  stepZoom(1);
});

document.addEventListener("keydown", (event) => {
  if (infoLayer && !infoLayer.hidden && event.key === "Escape") {
    closeInfo();
    return;
  }
  if (!resultsLayer.hidden && event.key === "Escape") {
    closeResults();
    return;
  }
  if (zoom.hidden) return;
  if (event.key === "Escape") closeZoom();
  if (event.key === "ArrowLeft") stepZoom(-1);
  if (event.key === "ArrowRight") stepZoom(1);
});

function loupeButton(id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "loupe";
  button.setAttribute("aria-label", "Zoom picture");
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.2 15.2 L20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openZoom(id);
  });
  return button;
}
function picture(src) {
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  image.draggable = false;
  return image;
}

function paintDots() {
  dots.forEach((dot, index) => {
    const attempt = attempts[index];
    dot.classList.toggle("is-wrong", Boolean(attempt) && !attempt.close);
    dot.classList.toggle("is-close", Boolean(attempt?.close));
    dot.classList.toggle("has-attempt", Boolean(attempt));
    dot.tabIndex = attempt ? 0 : -1;
    dot.setAttribute("aria-pressed", String(recallIndex === index && Boolean(attempt)));
    dot.setAttribute("aria-label", attempt?.close ? "Show the near miss" : attempt ? `Show mistake ${index + 1}` : `Mistake ${index + 1}`);
  });
  closeTip.hidden = !attempts[recallIndex]?.close;
}

function applyRecall() {
  const ids = recallIndex >= 0 ? new Set(attempts[recallIndex]?.ids ?? []) : null;
  board.classList.toggle("is-recalling", Boolean(ids?.size));
  board.querySelectorAll(".recall-frame").forEach((frame) => frame.remove());
  for (const el of board.querySelectorAll("[data-id]")) {
    const on = Boolean(ids?.has(el.dataset.id));
    el.classList.toggle("is-recalled", on);
    el.classList.toggle("is-dimmed", Boolean(ids?.size) && !on);
  }
  paintDots();
  if (!ids?.size) return;
  for (const row of solvedRows.querySelectorAll(".solved-row")) {
    const rowRect = row.getBoundingClientRect();
    for (const cell of row.querySelectorAll(".solved-cell.is-recalled")) {
      const rect = cell.getBoundingClientRect();
      const frame = document.createElement("span");
      frame.className = "recall-frame";
      frame.style.left = `${rect.left - rowRect.left}px`;
      frame.style.top = `${rect.top - rowRect.top}px`;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
      row.append(frame);
    }
  }
}

window.addEventListener("resize", () => {
  if (recallIndex >= 0) applyRecall();
});

function showRecall(index) {
  if (busy || !attempts[index]) return;
  recallIndex = index;
  applyRecall();
}

function clearRecall() {
  if (recallIndex < 0) return;
  recallIndex = -1;
  applyRecall();
}

dots.forEach((dot, index) => {
  dot.addEventListener("pointerdown", (event) => {
    lastPointer = event.pointerType;
  });
  dot.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    showRecall(index);
  });
  dot.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    if (recallIndex === index) clearRecall();
  });
  dot.addEventListener("focus", () => {
    if (lastPointer === "touch") return;
    showRecall(index);
  });
  dot.addEventListener("blur", () => {
    if (recallIndex === index) clearRecall();
  });
  dot.addEventListener("click", () => {
    if (lastPointer !== "touch" || !attempts[index]) return;
    if (recallIndex === index) clearRecall();
    else showRecall(index);
  });
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function motionEnd(element, eventName, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms + 80);
    function finish() {
      clearTimeout(timer);
      element.removeEventListener(eventName, onEnd);
      resolve();
    }
    function onEnd(event) {
      if (event.target !== element) return;
      finish();
    }
    element.addEventListener(eventName, onEnd);
  });
}

function visualOrder(wraps) {
  return [...wraps].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
    return ra.left - rb.left;
  });
}

async function jumpInTurn(wraps) {
  for (const wrap of wraps) {
    const tile = wrap.querySelector(".tile");
    wrap.classList.add("is-jump");
    await motionEnd(tile, "animationend", JUMP_MS);
    wrap.classList.remove("is-jump");
  }
}

async function shakeTogether(wraps) {
  await Promise.all(wraps.map(async (wrap) => {
    const tile = wrap.querySelector(".tile");
    wrap.classList.add("is-shake");
    await motionEnd(tile, "animationend", SHAKE_MS);
    wrap.classList.remove("is-shake");
  }));
}

function captureBoard() {
  const places = new Map();
  for (const wrap of grid.querySelectorAll(".tile-wrap")) {
    places.set(wrap.dataset.id, wrap.getBoundingClientRect());
  }
  return places;
}

async function flyIntoPlace(places) {
  const animated = [];
  for (const el of board.querySelectorAll("[data-id]")) {
    const from = places.get(el.dataset.id);
    if (!from) continue;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = to.width ? from.width / to.width : 1;
    const sy = to.height ? from.height / to.height : 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    el.style.transformOrigin = "top left";
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    animated.push(el);
  }
  if (!animated.length) return;
  board.offsetWidth;
  for (const el of animated) {
    el.style.transition = `transform ${FLY_MS}ms cubic-bezier(.22, .8, .28, 1)`;
    el.style.transform = "translate(0px, 0px) scale(1, 1)";
  }
  await motionEnd(animated[0], "transitionend", FLY_MS);
  for (const el of animated) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.transformOrigin = "";
  }
}

function toggle(id) {
  if (ended || busy) return;
  const at = selected.indexOf(id);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length < 4) selected.push(id);
  wrongIds = new Set();
  render();
}

shuffleButton.addEventListener("click", () => {
  if (ended || busy) return;
  unsolved = shuffle(unsolved);
  render();
});

deselectButton.addEventListener("click", () => {
  if (ended || busy) return;
  selected.length = 0;
  wrongIds = new Set();
  render();
});

submitButton.addEventListener("click", async () => {
  if (ended || busy || selected.length !== 4) return;
  const guess = selected.slice();
  guesses.push(guess);
  hideToast();
  busy = true;
  recallIndex = -1;
  applyRecall();
  closeZoom();
  grid.querySelectorAll(".is-loupe").forEach((el) => el.classList.remove("is-loupe"));
  submitButton.disabled = true;
  shuffleButton.disabled = true;
  deselectButton.disabled = true;

  const wraps = visualOrder([...grid.querySelectorAll(".tile-wrap")].filter((wrap) => isSelected(wrap.dataset.id)));
  const match = selectedGroup();
  if (motionOk) await jumpInTurn(wraps);
  await wait(motionOk ? SUSPENSE_MS : 280);

  if (match) {
    const places = captureBoard();
    solved.push(match.id);
    unsolved = unsolved.filter((id) => !isSelected(id));
    selected.length = 0;
    wrongIds = new Set();
    if (solved.length === puzzle.groups.length) ended = "won";
    if (motionOk) {
      render({ pendingTitleId: match.id });
      await flyIntoPlace(places);
      const row = solvedRows.querySelector(".solved-row.is-pending");
      row?.classList.remove("is-flying");
      const title = row?.querySelector("strong");
      title?.classList.add("is-shown");
      title?.removeAttribute("aria-hidden");
      if (ended === "won") message.textContent = "You found all four groups.";
      await wait(400);
      row?.classList.remove("is-pending");
      title?.classList.remove("is-shown");
    }
    busy = false;
    if (ended) setFinished(true);
    else if (motionOk) {
      shuffleButton.disabled = unsolved.length < 2;
      deselectButton.disabled = true;
      submitButton.disabled = true;
    } else render();
    return;
  }

  mistakes += 1;
  const close = isOneAway(guess);
  attempts.push({ ids: guess, close });
  wrongIds = new Set(selected);
  message.textContent = "That isn’t one of the groups.";
  const notes = [];
  if (close) notes.push("So close! Three are matching!");
  if (mistakes === 4) notes.push("Last Chance!");
  if (notes.length) showToast(notes);
  paintDots();
  for (const wrap of wraps) wrap.querySelector(".tile").classList.add("is-wrong");
  if (motionOk) await shakeTogether(wraps);
  await wait(motionOk ? 850 : 1100);

  const lost = mistakes >= 5;
  selected.length = 0;
  wrongIds = new Set();
  busy = false;
  if (lost) {
    ended = "lost";
    render();
    return;
  }
  for (const wrap of grid.querySelectorAll(".tile-wrap")) {
    const tile = wrap.querySelector(".tile");
    wrap.classList.remove("is-jump", "is-shake");
    tile.classList.remove("is-wrong", "is-shake");
    tile.setAttribute("aria-pressed", "false");
  }
  message.textContent = "";
  shuffleButton.disabled = unsolved.length < 2;
  deselectButton.disabled = true;
  submitButton.disabled = true;
});

function setFinished(on) {
  shuffleButton.hidden = on;
  deselectButton.hidden = on;
  submitButton.hidden = on;
  resultsButton.hidden = !on;
}

function openResults() {
  resultsHeading.textContent = shareTitle;
  resultsGrid.textContent = guesses.map((guess) => guess.map(emojiFor).join("")).join("\n");
  copiedNote.classList.remove("is-shown");
  resultsLayer.hidden = false;
  shareButton.focus();
}

function closeResults() {
  resultsLayer.hidden = true;
  copiedNote.classList.remove("is-shown");
}

function copyWithTextarea(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.append(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

let copiedTimer = 0;
function showCopied() {
  copiedNote.classList.add("is-shown");
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => copiedNote.classList.remove("is-shown"), 1600);
}

function openInfo() {
  infoLayer.hidden = false;
}

function closeInfo() {
  infoLayer.hidden = true;
}

document.querySelector("#info")?.addEventListener("click", openInfo);
document.querySelector("#info-close").addEventListener("click", closeInfo);
infoLayer.addEventListener("click", (event) => {
  if (event.target === infoLayer) closeInfo();
});

resultsButton.addEventListener("click", openResults);
document.querySelector("#results-layer .results-close").addEventListener("click", closeResults);
resultsLayer.addEventListener("click", (event) => {
  if (event.target === resultsLayer) closeResults();
});
shareButton.addEventListener("click", () => {
  const text = resultsText();
  const legacy = copyWithTextarea(text);
  if (legacy) showCopied();
  const write = navigator.clipboard?.writeText(text);
  if (!write) return;
  write.then(() => {
    if (!legacy) showCopied();
  }).catch(() => {});
});

render();
