// Luna House Care — shared front-end behaviour (no backend yet)

document.addEventListener("DOMContentLoaded", () => {
  // mobile nav toggle
  const header = document.querySelector(".site-header");
  const navToggle = document.querySelector(".nav-toggle");
  if (header && navToggle) {
    navToggle.addEventListener("click", () => {
      const isOpen = header.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });
    header.querySelectorAll(".main-nav a").forEach((link) => {
      link.addEventListener("click", () => header.classList.remove("is-open"));
    });
  }

  // scroll reveal
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  // case filter tabs (cases.html)
  const filterTabs = document.querySelectorAll(".filter-tab");
  const caseCards = document.querySelectorAll("[data-case-type]");
  if (filterTabs.length && caseCards.length) {
    filterTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        filterTabs.forEach((t) => t.setAttribute("aria-pressed", "false"));
        tab.setAttribute("aria-pressed", "true");
        const type = tab.dataset.filter;
        caseCards.forEach((card) => {
          const match = type === "all" || card.dataset.caseType === type;
          card.style.display = match ? "" : "none";
        });
      });
    });
  }

  // estimate form (estimate.html) — front-end only, no data is sent anywhere yet
  const form = document.querySelector("#estimate-form");
  if (form) {
    const success = document.querySelector("#estimate-success");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      form.hidden = true;
      if (success) success.classList.add("is-visible");
      success?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
});
