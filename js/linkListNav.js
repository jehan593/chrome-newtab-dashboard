/** Arrow-key navigation for the History and Bookmarks result lists. */
export function installListNavigation(card, list, search) {
  let activeIndex = -1;
  let hovering = false;

  function rows() {
    return [...list.querySelectorAll(".links-row")];
  }

  function setActive(index) {
    const items = rows();
    if (items.length === 0) return;
    activeIndex = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((row, i) => row.classList.toggle("is-active", i === activeIndex));
    items[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function clearActive() {
    activeIndex = -1;
    rows().forEach((row) => row.classList.remove("is-active"));
  }

  // Keydown only reaches focused elements, so listen on the document while the
  // pointer is inside this card. That lets arrows work without clicking first.
  card.addEventListener("mouseenter", () => {
    hovering = true;
  });

  card.addEventListener("mouseleave", () => {
    hovering = false;
    clearActive();
  });

  document.addEventListener("keydown", (e) => {
    if (!hovering) return;
    const items = rows();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setActive(activeIndex < 0 ? 0 : (activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setActive(activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      const target = e.target;
      // Don't hijack Enter on the clear/remove buttons.
      if (target instanceof Element && target.closest(".links-clear, .card-close")) return;
      e.preventDefault();
      const link = items[activeIndex]?.querySelector(".links-item");
      if (link) link.click();
    } else if (e.key === "Escape") {
      clearActive();
    }
  });

  search.addEventListener("input", clearActive);

  return { clearActive };
}
