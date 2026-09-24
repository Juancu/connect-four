const puzzle = JSON.parse(document.getElementById("puzzle-data").textContent);

const board = document.querySelector("#board");
const solvedRows = document.querySelector("#solved");
const grid = document.querySelector("#grid");
const dots = [...document.querySelectorAll(".dot")];
const message = document.querySelector("#message");
const shuffleButton = document.querySelector("#shuffle");
const deselectButton = document.querySelector("#deselect");
const submitButton = document.querySelector("#submit");

const cards = new Map();
for (const group of puzzle.groups) {
  for (const card of group.cards) {
    cards.set(card.id, { ...card, groupId: group.id });
  }
}

let unsolved = shuffle([...cards.keys()]);
const selected = new Set();
const solved = [];
let mistakes = 0;
let ended = false;
let busy = false;
let wrongIds = new Set();

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

function selectedGroup() {
  if (selected.size !== 4) return null;
  return puzzle.groups.find((group) => group.cards.every((card) => selected.has(card.id))) ?? null;
}

function render() {
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
    for (const card of group.cards) row.append(picture(card.src));
    const title = document.createElement("strong");
    title.textContent = group.name;
    row.append(title);
    solvedRows.append(row);
  }

  grid.replaceChildren();
  if (ended) {
    grid.hidden = true;
  } else {
    grid.hidden = false;
    clearLoupeTimer();
    for (const id of unsolved) {
      const card = cards.get(id);
      const wrap = document.createElement("div");
      wrap.className = "tile-wrap";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      if (wrongIds.has(id)) button.classList.add("is-wrong");
      button.setAttribute("aria-pressed", String(selected.has(id)));
      button.append(picture(card.src));
      button.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        toggle(id);
      });
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || ended || busy) return;
        const startX = event.clientX;
        const startY = event.clientY;
        const hold = setTimeout(() => {
          suppressClick = true;
          openZoom(id);
        }, 500);
        const cancelHold = (move) => {
          if (move?.type === "pointermove" && Math.hypot(move.clientX - startX, move.clientY - startY) < 12) return;
          clearTimeout(hold);
          button.removeEventListener("pointermove", cancelHold);
          button.removeEventListener("pointerup", cancelHold);
          button.removeEventListener("pointercancel", cancelHold);
        };
        button.addEventListener("pointermove", cancelHold);
        button.addEventListener("pointerup", cancelHold);
        button.addEventListener("pointercancel", cancelHold);
      });
      wrap.append(button, loupeButton(id));
      wrap.addEventListener("pointerenter", () => {
        clearLoupeTimer();
        loupeTimer = setTimeout(() => wrap.classList.add("is-loupe"), 1000);
      });
      wrap.addEventListener("pointerleave", () => {
        clearLoupeTimer();
        wrap.classList.remove("is-loupe");
      });
      grid.append(wrap);
    }
  }

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-wrong", index < Math.min(mistakes, dots.length));
  });

  if (ended === "won") message.textContent = "You found all four groups.";
  else if (ended === "lost") message.textContent = "Five mistakes. The groups are shown above.";
  else if (wrongIds.size) message.textContent = "That isn’t one of the groups.";
  else message.textContent = "";

  shuffleButton.disabled = ended || unsolved.length < 2;
  deselectButton.disabled = ended || selected.size === 0;
  submitButton.disabled = ended || busy || selected.size !== 4;
}

const zoom = document.querySelector("#zoom");
const zoomImage = zoom.querySelector("img");
let loupeTimer = null;
let suppressClick = false;
let zoomIds = [];
let zoomIndex = 0;
let zoomSwipe = null;

function clearLoupeTimer() {
  clearTimeout(loupeTimer);
  loupeTimer = null;
}

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
  clearLoupeTimer();
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

function toggle(id) {
  if (ended || busy) return;
  if (selected.has(id)) selected.delete(id);
  else if (selected.size < 4) selected.add(id);
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
  selected.clear();
  wrongIds = new Set();
  render();
});

submitButton.addEventListener("click", async () => {
  if (ended || busy || selected.size !== 4) return;
  const match = selectedGroup();
  if (match) {
    solved.push(match.id);
    unsolved = unsolved.filter((id) => !selected.has(id));
    selected.clear();
    wrongIds = new Set();
    if (solved.length === puzzle.groups.length) ended = "won";
    render();
    return;
  }

  busy = true;
  mistakes += 1;
  wrongIds = new Set(selected);
  render();
  if (mistakes >= 5) {
    ended = "lost";
    selected.clear();
    wrongIds = new Set();
    busy = false;
    render();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 550));
  selected.clear();
  wrongIds = new Set();
  busy = false;
  render();
});

render();
