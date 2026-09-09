// Anjipsa Housing (AJH) — shared front-end behaviour (no backend yet)

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
  const caseCards = document.querySelectorAll("[data-case-category]");
  if (filterTabs.length && caseCards.length) {
    filterTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        filterTabs.forEach((t) => t.setAttribute("aria-pressed", "false"));
        tab.setAttribute("aria-pressed", "true");
        const type = tab.dataset.filter;
        caseCards.forEach((card) => {
          const match = type === "all" || card.dataset.caseCategory === type;
          card.style.display = match ? "" : "none";
        });
      });
    });
  }

  // estimate wizard (estimate.html) — front-end only, no data is sent anywhere yet
  const SPACE_LABELS = {
    apartment: "아파트",
    officetel: "오피스텔",
    store: "상가",
    villa: "빌라",
    academy: "학원 · 학교",
    hospital: "병원",
    etc: "기타",
  };

  const CATEGORY_LABELS = {
    repair: "각종 집수리",
    indoor: "실내 교체·설치·복원",
    outdoor: "실외 공간 복원",
    parking: "주차시설물 시공",
    pavers: "보도블록 시공",
    facade: "건물 외벽 복원",
    etc: "기타",
  };

  const LOCATION_LABELS = { indoor: "실내", outdoor: "실외", both: "실내+실외" };

  const STEP_LABELS = ["공간 유형", "시공 항목", "상세 내용", "지역 · 연락처"];

  const escapeHtml = (str) =>
    String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const wizard = document.querySelector("#estimate-wizard");
  const form = document.querySelector("#estimate-form");
  if (wizard && form) {
    const panels = [...wizard.querySelectorAll(".wizard-panel")];
    const total = panels.length;
    const progressBar = wizard.querySelector("#wizard-progress-bar");
    const stepLabel = wizard.querySelector("#wizard-step-label");
    const prevBtn = wizard.querySelector("#wizard-prev");
    const nextBtn = wizard.querySelector("#wizard-next");
    const submitBtn = wizard.querySelector("#wizard-submit");
    const errorEl = wizard.querySelector("#wizard-error");
    const spaceInput = form.querySelector("#space-type-value");
    const categoryInput = form.querySelector("#category-value");
    let step = 1;

    const syncHiddenInputs = () => {
      const spaceCard = wizard.querySelector('[data-select-group="space"] .option-card.is-selected');
      spaceInput.value = spaceCard ? spaceCard.dataset.value : "";
      const catCards = wizard.querySelectorAll('[data-select-group="category"] .option-card.is-selected');
      categoryInput.value = [...catCards].map((c) => c.dataset.value).join(",");
    };

    wizard.querySelectorAll("[data-select-group]").forEach((group) => {
      const mode = group.dataset.mode;
      group.querySelectorAll(".option-card").forEach((card) => {
        card.addEventListener("click", () => {
          if (mode === "single") {
            group.querySelectorAll(".option-card").forEach((c) => c.classList.remove("is-selected"));
            card.classList.add("is-selected");
          } else {
            card.classList.toggle("is-selected");
          }
          syncHiddenInputs();
          if (errorEl) errorEl.textContent = "";
        });
      });
    });

    const showStep = (n, { scroll = true } = {}) => {
      step = n;
      panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.step) === n));
      if (progressBar) progressBar.style.width = `${(n / total) * 100}%`;
      if (stepLabel) stepLabel.innerHTML = `STEP <strong>${n}</strong> / ${total} · ${STEP_LABELS[n - 1]}`;
      if (prevBtn) prevBtn.hidden = n === 1;
      if (nextBtn) nextBtn.hidden = n === total;
      if (submitBtn) submitBtn.hidden = n !== total;
      if (errorEl) errorEl.textContent = "";
      if (scroll) wizard.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const validateStep = (n) => {
      if (n === 1 && !spaceInput.value) {
        if (errorEl) errorEl.textContent = "공간 유형을 선택해 주세요.";
        return false;
      }
      if (n === 2 && !categoryInput.value) {
        if (errorEl) errorEl.textContent = "시공 항목을 하나 이상 선택해 주세요.";
        return false;
      }
      return true;
    };

    nextBtn?.addEventListener("click", () => {
      if (!validateStep(step)) return;
      if (step < total) showStep(step + 1);
    });

    prevBtn?.addEventListener("click", () => {
      if (step > 1) showStep(step - 1);
    });

    showStep(1, { scroll: false });

    const success = document.querySelector("#estimate-success");
    const summaryEl = document.querySelector("#estimate-summary");
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      if (summaryEl) {
        const data = new FormData(form);
        const categories = (categoryInput.value || "")
          .split(",")
          .filter(Boolean)
          .map((v) => CATEGORY_LABELS[v] || v)
          .join(", ");
        const rows = [
          ["공간 유형", SPACE_LABELS[spaceInput.value] || "-"],
          ["시공 항목", categories || "-"],
          ["시공 위치", LOCATION_LABELS[data.get("location")] || "-"],
          ["지역", [data.get("district"), data.get("address")].filter(Boolean).join(" ") || "-"],
          ["연락처", data.get("phone") || "-"],
        ];
        summaryEl.innerHTML = rows
          .map(([k, v]) => `<li><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></li>`)
          .join("");
      }

      wizard.hidden = true;
      if (success) success.classList.add("is-visible");
      success?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
});
