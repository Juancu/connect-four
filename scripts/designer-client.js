const TAGS = JSON.parse(document.getElementById("designer-data").textContent);
const MAX_PER_TAG = 4;

const categories = document.querySelector("#categories");
const browseButton = document.querySelector("#browse");
const browseLayer = document.querySelector("#browse-layer");
const browseBody = document.querySelector("#browse-body");
const exportButton = document.querySelector("#export");
const status = document.querySelector("#status");
const jsonOut = document.querySelector("#json-out");
const summary = document.querySelector("#summary");
const zoom = document.querySelector("#zoom");
const zoomImage = zoom.querySelector("img");

const picks = {};
try {
  localStorage.removeItem("connecttag.dailyPicks");
} catch {
  // Nothing stored to clear.
}

function selectedIds(slug) {
  const ids = picks[slug];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

function render() {
  categories.replaceChildren();
  if (TAGS.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Pictures are still downloading. Reload this page in a little while.";
    categories.append(empty);
    updateSummary();
    return;
  }

  for (const tag of TAGS) {
    const chosen = new Set(selectedIds(tag.slug).filter((id) => tag.images.includes(id)));
    picks[tag.slug] = [...chosen];

    const section = document.createElement("section");
    section.className = "category";
    section.dataset.slug = tag.slug;

    const header = document.createElement("div");
    header.className = "category-head";
    const title = document.createElement("h2");
    title.textContent = tag.name;
    const count = document.createElement("span");
    count.textContent = `${chosen.size}/${MAX_PER_TAG}`;
    header.append(title, count);

    const row = document.createElement("div");
    row.className = "carousel";
    for (const id of tag.images) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shot";
      button.dataset.id = id;
      button.setAttribute("aria-pressed", String(chosen.has(id)));
      button.append(picture(id));
      button.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        toggle(tag.slug, id);
      });
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        const startX = event.clientX;
        const startY = event.clientY;
        const hold = setTimeout(() => {
          suppressClick = true;
          openZoom(tag.images, id);
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
      const wrap = document.createElement("div");
      wrap.className = "shot-wrap";
      wrap.append(button, loupeButton(tag.images, id));
      watchLoupe(wrap);
      row.append(wrap);
    }

    section.append(header, row);
    categories.append(section);
  }
  updateSummary();
}

function toggle(slug, id) {
  const tag = TAGS.find((item) => item.slug === slug);
  const current = selectedIds(slug).filter((item) => tag.images.includes(item));
  const index = current.indexOf(id);
  if (index >= 0) current.splice(index, 1);
  else if (current.length < MAX_PER_TAG) current.push(id);
  picks[slug] = current;
  const section = categories.querySelector(`section[data-slug="${CSS.escape(slug)}"]`);
  if (!section) {
    render();
    return;
  }
  section.querySelector(".category-head span").textContent = `${current.length}/${MAX_PER_TAG}`;
  for (const button of section.querySelectorAll(".shot")) {
    button.setAttribute("aria-pressed", String(current.includes(button.dataset.id)));
  }
  updateSummary();
}

function readyGroups() {
  return TAGS
    .map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      images: selectedIds(tag.slug).filter((id) => tag.images.includes(id)),
    }))
    .filter((group) => group.images.length === MAX_PER_TAG);
}

function updateSummary() {
  const ready = readyGroups().length;
  summary.textContent = `${ready} ${ready === 1 ? "category" : "categories"} with 4 pictures`;
  exportButton.disabled = ready === 0;
}

function setStatus(message) {
  status.textContent = message;
}

function picture(id) {
  const image = document.createElement("img");
  image.src = `data/art/${id}.jpg`;
  image.alt = "";
  image.draggable = false;
  image.loading = "lazy";
  return image;
}

function watchLoupe(wrap) {
  wrap.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    wrap.classList.add("is-loupe");
  });
  wrap.addEventListener("pointerleave", () => wrap.classList.remove("is-loupe"));
}

function loupeButton(ids, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "loupe";
  button.setAttribute("aria-label", "Zoom picture");
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.2 15.2 L20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openZoom(ids, id);
  });
  return button;
}

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
  zoomImage.src = `data/art/${zoomIds[zoomIndex]}.jpg`;
  zoom.hidden = false;
}

function openZoom(ids, id) {
  zoomIds = [...ids];
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

function pickedGroups() {
  return TAGS
    .map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      images: selectedIds(tag.slug).filter((id) => tag.images.includes(id)),
    }))
    .filter((group) => group.images.length > 0);
}

function openBrowse() {
  browseBody.replaceChildren();
  const groups = pickedGroups();
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No pictures selected yet.";
    browseBody.append(empty);
  } else {
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "browse-group";
      const title = document.createElement("h3");
      title.textContent = `${group.name} ${group.images.length}/${MAX_PER_TAG}`;
      const row = document.createElement("div");
      row.className = "browse-row";
      for (const id of group.images) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "shot";
        button.append(picture(id));
        button.addEventListener("click", () => openZoom(group.images, id));
        const wrap = document.createElement("div");
        wrap.className = "shot-wrap";
        wrap.append(button, loupeButton(group.images, id));
        watchLoupe(wrap);
        row.append(wrap);
      }
      section.append(title, row);
      browseBody.append(section);
    }
  }
  browseLayer.hidden = false;
}

function closeBrowse() {
  browseLayer.hidden = true;
  browseBody.replaceChildren();
}

async function copyJson() {
  const groups = readyGroups();
  if (groups.length === 0) {
    setStatus("Pick 4 pictures in a category first.");
    return;
  }
  const text = JSON.stringify(groups, null, 2);
  jsonOut.hidden = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied ${groups.length} ${groups.length === 1 ? "category" : "categories"}.`);
      return;
    }
  } catch {
    // file:// pages often block the clipboard API.
  }
  jsonOut.hidden = false;
  jsonOut.value = text;
  jsonOut.focus();
  jsonOut.select();
  const copied = document.execCommand("copy");
  setStatus(copied
    ? `Copied ${groups.length} ${groups.length === 1 ? "category" : "categories"}.`
    : "Clipboard was blocked. The JSON is selected below — press Ctrl+C.");
}

browseButton.addEventListener("click", openBrowse);
document.querySelector("#browse-close").addEventListener("click", closeBrowse);
browseLayer.addEventListener("click", (event) => {
  if (event.target === browseLayer) closeBrowse();
});

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
  if (!zoom.hidden) {
    if (event.key === "Escape") closeZoom();
    if (event.key === "ArrowLeft") stepZoom(-1);
    if (event.key === "ArrowRight") stepZoom(1);
    return;
  }
  if (!browseLayer.hidden && event.key === "Escape") closeBrowse();
});

exportButton.addEventListener("click", () => {
  copyJson();
});

render();
