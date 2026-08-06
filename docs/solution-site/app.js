const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const diagramTabs = [...document.querySelectorAll("[data-diagram]")];
const diagramPanel = document.querySelector("#diagram-panel");
const diagramImage = document.querySelector("[data-diagram-image]");
const diagramTitle = document.querySelector("[data-diagram-title]");
const diagramDescription = document.querySelector("[data-diagram-description]");
const openSvgLink = document.querySelector("[data-open-svg]");
const dialog = document.querySelector("[data-diagram-dialog]");
const dialogImage = document.querySelector("[data-dialog-image]");
const dialogTitle = document.querySelector("[data-dialog-title]");
const openDiagramButton = document.querySelector("[data-open-diagram]");
const closeDiagramButton = document.querySelector("[data-close-diagram]");

function syncHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeNavigation() {
  nav?.classList.remove("is-open");
  navToggle?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-nav-open");
}

function selectDiagram(tab) {
  const source = tab.dataset.diagram;
  const title = tab.dataset.title;
  const description = tab.dataset.description;

  if (!source || !title || !description || !diagramImage) return;

  for (const candidate of diagramTabs) {
    const active = candidate === tab;
    candidate.classList.toggle("is-active", active);
    candidate.setAttribute("aria-selected", String(active));
    candidate.tabIndex = active ? 0 : -1;
  }

  diagramImage.src = source;
  diagramImage.alt = `${title} do SystemOps Core`;
  if (diagramTitle) diagramTitle.textContent = title;
  if (diagramDescription) diagramDescription.textContent = description;
  if (openSvgLink) openSvgLink.href = source;
  if (diagramPanel) diagramPanel.setAttribute("aria-labelledby", tab.id);
  if (dialogImage) dialogImage.src = source;
  if (dialogTitle) dialogTitle.textContent = title;
}

function openDiagram() {
  if (!dialog || !diagramImage || !dialogImage) return;
  dialogImage.src = diagramImage.src;
  document.body.classList.add("is-dialog-open");
  dialog.showModal();
}

function closeDiagram() {
  if (!dialog?.open) return;
  dialog.close();
  document.body.classList.remove("is-dialog-open");
}

window.addEventListener("scroll", syncHeader, { passive: true });
syncHeader();

navToggle?.addEventListener("click", () => {
  const willOpen = !nav?.classList.contains("is-open");
  nav?.classList.toggle("is-open", willOpen);
  navToggle.setAttribute("aria-expanded", String(willOpen));
  document.body.classList.toggle("is-nav-open", willOpen);
});

nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNavigation));

diagramTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectDiagram(tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + diagramTabs.length) % diagramTabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % diagramTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = diagramTabs.length - 1;

    diagramTabs[nextIndex].focus();
    selectDiagram(diagramTabs[nextIndex]);
  });
});

openDiagramButton?.addEventListener("click", openDiagram);
closeDiagramButton?.addEventListener("click", closeDiagram);
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) closeDiagram();
});
dialog?.addEventListener("close", () => document.body.classList.remove("is-dialog-open"));

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = [...document.querySelectorAll(".reveal")];

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 },
  );
  revealItems.forEach((item) => observer.observe(item));
}
