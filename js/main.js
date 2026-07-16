import { initCalendar } from "./calendar.js";
import { initNotes } from "./notes.js";
import { initTasks } from "./tasks.js";
import { initWeather } from "./weather.js";
import * as storage from "./storage.js";

// rowSpan drives placement (applyPositions sets grid-row explicitly, which
// wins over CSS). newtab.html's is-large/is-small classes just keep the
// pre-JS layout from flashing the wrong size for a beat on load.
const WIDGETS = {
  calendar: { elementId: "calendar-widget", init: initCalendar, rowSpan: 2 },
  tasks: { elementId: "tasks-widget", init: initTasks, rowSpan: 1 },
  notes: { elementId: "notes-widget", init: initNotes, rowSpan: 1 },
  weather: { elementId: "weather-widget", init: initWeather, rowSpan: 1 },
};

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function currentEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function addDragHandle(card) {
  const handle = document.createElement("div");
  handle.className = "card-drag-handle";
  handle.draggable = true;
  handle.setAttribute("aria-hidden", "true");
  handle.title = "Drag to reorder";
  card.prepend(handle);
}

/** Reads the grid's actual column count/width and row height straight from
 *  its computed styles, instead of duplicating those numbers as JS constants
 *  that would silently drift out of sync if layout.css's grid ever changes.
 *  Assumes uniform column widths, which auto-fill + 1fr always produces. */
function getGridMetrics(grid) {
  const style = getComputedStyle(grid);
  const columnWidths = style.gridTemplateColumns.split(" ").map(parseFloat);
  const gap = parseFloat(style.columnGap) || 0;
  const rowUnit = parseFloat(style.gridAutoRows) || 0;
  return { columnCount: columnWidths.length, columnStep: columnWidths[0] + gap, rowStep: rowUnit + gap };
}

function cellAt(grid, clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const { columnCount, columnStep, rowStep } = getGridMetrics(grid);
  const col = Math.min(columnCount, Math.max(1, Math.floor((clientX - rect.left) / columnStep) + 1));
  const row = Math.max(1, Math.floor((clientY - rect.top) / rowStep) + 1);
  return { col, row };
}

/** Fills in a {col, row} for any enabled widget missing one (first run, or a
 *  widget type introduced after the user last saved a layout) via simple
 *  row-major sparse packing -- same shape auto-flow would have produced. */
function fillMissingPositions(positions, enabledIds, columnCount) {
  const next = { ...positions };
  const occupied = new Set();
  const mark = (id, pos) => {
    for (let r = pos.row; r < pos.row + WIDGETS[id].rowSpan; r++) occupied.add(`${pos.col}:${r}`);
  };
  for (const [id, pos] of Object.entries(next)) {
    if (enabledIds.includes(id)) mark(id, pos);
  }

  for (const id of enabledIds) {
    if (next[id]) continue;
    const span = WIDGETS[id].rowSpan;
    let row = 1;
    let placed = false;
    while (!placed) {
      for (let col = 1; col <= columnCount; col++) {
        let fits = true;
        for (let r = row; r < row + span; r++) {
          if (occupied.has(`${col}:${r}`)) {
            fits = false;
            break;
          }
        }
        if (fits) {
          next[id] = { col, row };
          mark(id, { col, row });
          placed = true;
          break;
        }
      }
      row++;
    }
  }
  return next;
}

/** Finds the first free span-sized run of cells, scanning columns starting
 *  from preferCol (wrapping around) before advancing to the next row -- keeps
 *  a displaced widget in the same column when there's room there, only
 *  spilling into other columns once that column is full at that row. */
function findOpenCell(occupied, span, columnCount, preferCol) {
  let row = 1;
  while (true) {
    for (let offset = 0; offset < columnCount; offset++) {
      const col = ((preferCol - 1 + offset) % columnCount) + 1;
      let fits = true;
      for (let r = row; r < row + span; r++) {
        if (occupied.has(`${col}:${r}`)) {
          fits = false;
          break;
        }
      }
      if (fits) return { col, row };
    }
    row++;
  }
}

/** Places draggedId at targetCell. Any widget(s) whose footprint the target
 *  cell overlaps get bumped elsewhere -- plural, deliberately: a large
 *  (2-row) widget dropped where two different small widgets sit (one per
 *  row) overlaps both of them, and swapping with only the first match left
 *  the second one stuck underneath it. Each displaced widget prefers landing
 *  in the dragged widget's *old* spot (the intuitive "trade places" swap)
 *  when it actually fits there, and only falls back to scanning for the
 *  next open cell when it doesn't -- e.g. a 2-row widget can't fit into the
 *  1-row gap a small dragged widget left behind. */
function resolveDrop(positions, draggedId, targetCell, columnCount) {
  const next = { ...positions };
  const draggedOldPos = next[draggedId];
  const draggedSpan = WIDGETS[draggedId].rowSpan;
  delete next[draggedId];

  const displacedIds = Object.keys(next).filter((otherId) => {
    const pos = next[otherId];
    const span = WIDGETS[otherId].rowSpan;
    return targetCell.col === pos.col && targetCell.row < pos.row + span && targetCell.row + draggedSpan > pos.row;
  });
  for (const id of displacedIds) delete next[id];

  next[draggedId] = targetCell;

  const occupied = new Set();
  for (const [id, pos] of Object.entries(next)) {
    for (let r = pos.row; r < pos.row + WIDGETS[id].rowSpan; r++) occupied.add(`${pos.col}:${r}`);
  }

  const fitsAt = (col, row, span) => {
    for (let r = row; r < row + span; r++) {
      if (occupied.has(`${col}:${r}`)) return false;
    }
    return true;
  };

  for (const id of displacedIds) {
    const span = WIDGETS[id].rowSpan;
    const pos =
      draggedOldPos && fitsAt(draggedOldPos.col, draggedOldPos.row, span)
        ? { col: draggedOldPos.col, row: draggedOldPos.row }
        : findOpenCell(occupied, span, columnCount, targetCell.col);
    next[id] = pos;
    for (let r = pos.row; r < pos.row + span; r++) occupied.add(`${pos.col}:${r}`);
  }

  return next;
}

/** Clamping each widget's column independently (Math.min(pos.col, columnCount))
 *  stops it landing in a nonexistent column, but does nothing about two widgets
 *  whose columns clamp to the *same* value -- e.g. dropping from 3 columns to 2
 *  makes whatever lived in columns 2 and 3 both land on column 2, one hidden
 *  behind the other. This walks widgets in saved (col, row) order and slides
 *  any that collide with something already placed in that column down to the
 *  next open row. Purely a display-time transform -- positions (and storage)
 *  keep the original layout, so widening the window back out restores it
 *  exactly without needing to persist anything. */
function remapForColumnCount(positions, columnCount) {
  const entries = Object.entries(positions)
    .map(([id, pos]) => ({ id, col: Math.min(pos.col, columnCount), row: pos.row, span: WIDGETS[id].rowSpan }))
    .sort((a, b) => a.col - b.col || a.row - b.row);

  const occupied = new Set();
  const next = {};
  for (const entry of entries) {
    let row = entry.row;
    while (true) {
      let fits = true;
      for (let r = row; r < row + entry.span; r++) {
        if (occupied.has(`${entry.col}:${r}`)) {
          fits = false;
          break;
        }
      }
      if (fits) break;
      row++;
    }
    next[entry.id] = { col: entry.col, row };
    for (let r = row; r < row + entry.span; r++) occupied.add(`${entry.col}:${r}`);
  }
  return next;
}

/** Applies each widget's {col, row} as an explicit grid placement (not
 *  auto-flow) -- this is what actually lets a widget land in a specific
 *  empty cell instead of wherever row-major auto-flow would put it. */
function applyPositions(positions, columnCount) {
  const remapped = remapForColumnCount(positions, columnCount);
  for (const [id, widget] of Object.entries(WIDGETS)) {
    const el = document.getElementById(widget.elementId);
    const pos = remapped[id];
    if (!el || !pos) continue;
    el.style.gridColumn = String(pos.col);
    el.style.gridRow = `${pos.row} / span ${widget.rowSpan}`;
  }
}

/** Drag-and-drop where the drop target is a grid cell computed from pointer
 *  position, not another element -- lets a widget land in any empty gap, not
 *  just swap-adjacent-in-DOM-order. Actual placement (including displacing
 *  whatever's in the way) is resolveDrop()'s job. */
function initFreeDragReorder(grid, getPositions, onDrop) {
  let draggedId = null;

  // A dashed-border ghost tracking the target cell during drag -- explicit
  // grid-column/grid-row placement (same mechanism the cards themselves use)
  // means it's always pixel-perfect to the actual cell, no separate sizing
  // math needed. pointer-events: none keeps it from intercepting drag events.
  const indicator = document.createElement("div");
  indicator.className = "grid-drop-indicator";

  grid.addEventListener("dragstart", (e) => {
    if (!e.target.classList.contains("card-drag-handle")) return;
    const card = e.target.closest(".card");
    draggedId = card.dataset.widgetId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedId);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });

  grid.addEventListener("dragend", () => {
    draggedId = null;
    grid.querySelectorAll(".card").forEach((el) => el.classList.remove("dragging"));
    indicator.remove();
  });

  grid.addEventListener("dragover", (e) => {
    if (!draggedId) return;
    e.preventDefault();

    const cell = cellAt(grid, e.clientX, e.clientY);
    const span = WIDGETS[draggedId].rowSpan;
    indicator.style.gridColumn = String(cell.col);
    indicator.style.gridRow = `${cell.row} / span ${span}`;
    if (!indicator.isConnected) grid.appendChild(indicator);
  });

  grid.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!draggedId) return;
    const id = draggedId;
    draggedId = null;
    indicator.remove();

    const targetCell = cellAt(grid, e.clientX, e.clientY);
    const positions = resolveDrop(getPositions(), id, targetCell, getGridMetrics(grid).columnCount);

    await onDrop(positions);
  });
}

async function init() {
  const grid = document.querySelector(".grid");
  let positions;
  const activeCards = [];
  const initPromises = [];

  // Theme/positions come from async chrome.storage reads, so the page starts
  // hidden (see newtab.html/.page.is-loading) to avoid a flash of default
  // theme/order before they're applied. The finally guarantees it's revealed
  // even if something above throws, rather than leaving the page blank.
  try {
    const settings = await storage.getSettings();
    applyTheme(settings.theme);

    document.querySelector(".theme-toggle").addEventListener("click", async () => {
      const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      await storage.setSettings({ theme: next });
    });

    document.querySelector(".settings-btn").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    const widgetConfig = await storage.getWidgetConfig();
    const enabledIds = Object.keys(WIDGETS).filter((id) => widgetConfig.enabled[id]);
    // Drop any saved position for a widget id that no longer exists (e.g. a
    // removed widget) -- resolveDrop() has no per-id existence guard, so a
    // stale key here would throw partway through the next drag-and-drop.
    const savedPositions = Object.fromEntries(
      Object.entries(widgetConfig.positions).filter(([id]) => WIDGETS[id])
    );
    positions = fillMissingPositions(savedPositions, enabledIds, getGridMetrics(grid).columnCount);

    for (const [id, widget] of Object.entries(WIDGETS)) {
      const el = document.getElementById(widget.elementId);
      if (!el) continue;
      el.dataset.widgetId = id;
      if (!enabledIds.includes(id)) {
        el.classList.add("is-widget-disabled");
        continue;
      }
      activeCards.push(el);
      initPromises.push(id === "calendar" ? initCalendar(el, settings) : widget.init(el));
    }

    applyPositions(positions, getGridMetrics(grid).columnCount);
  } finally {
    document.querySelector(".page").classList.remove("is-loading");
  }

  await storage.setWidgetConfig({ positions });
  await Promise.all(initPromises);

  // Drag handles are added only after every widget has finished rendering --
  // each widget's init() wipes its root via innerHTML as its first step, which
  // would delete a handle added any earlier.
  for (const el of activeCards) addDragHandle(el);

  initFreeDragReorder(grid, () => positions, async (nextPositions) => {
    positions = nextPositions;
    applyPositions(positions, getGridMetrics(grid).columnCount);
    await storage.setWidgetConfig({ positions });
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyPositions(positions, getGridMetrics(grid).columnCount);
    }, 100);
  });
}

document.addEventListener("DOMContentLoaded", init);
