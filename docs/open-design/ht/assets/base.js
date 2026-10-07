(function () {
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function copyText(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      if (!button) return;
      const prev = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = prev; }, 1200);
    });
  }

  function bindTabs() {
    qa("[data-tabs]").forEach((wrap) => {
      const tabs = qa("[data-tab]", wrap);
      const panels = qa("[data-tab-panel]", wrap);
      const activate = (id) => {
        tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.tab === id)));
        panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.tabPanel === id));
      };
      tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.tab)));
      activate((tabs[0] && tabs[0].dataset.tab) || "");
    });
  }

  function bindSegments() {
    qa("[data-segmented]").forEach((wrap) => {
      const buttons = qa("button", wrap);
      buttons.forEach((button) => button.addEventListener("click", () => {
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        const key = button.dataset.filter;
        const target = wrap.dataset.filterTarget
          ? document.querySelector(wrap.dataset.filterTarget)
          : wrap.closest("[data-filter-root]");
        if (!target) return;
        qa("[data-filter-item]", target).forEach((item) => {
          const keep = key === "all" || item.dataset.filter.includes(key);
          item.hidden = !keep;
        });
      }));
    });
  }

  function bindCopyButtons() {
    qa("[data-copy-text]").forEach((button) => {
      button.addEventListener("click", () => copyText(button.dataset.copyText, button));
    });
  }

  function bindTaskActions() {
    qa("[data-task-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-task-card]");
        if (!card) return;
        const status = q("[data-task-status]", card);
        const dot = q("[data-status-dot]", card);
        const next = button.dataset.taskAction;
        if (status) status.textContent = button.textContent.trim();
        if (dot) {
          dot.classList.remove("success", "danger");
          if (next === "completed") dot.classList.add("success");
          if (next === "blocked" || next === "interrupt") dot.classList.add("danger");
        }
      });
    });
  }

  function bindNavToggle() {
    const btn = q("[data-toggle-nav]");
    if (!btn) return;
    btn.addEventListener("click", () => {
      document.documentElement.classList.toggle("nav-open");
      const sidebar = q(".sidebar");
      if (sidebar) sidebar.style.display = getComputedStyle(sidebar).display === "none" ? "" : "none";
    });
  }

  function bindFormLike() {
    qa("[data-save-draft]").forEach((button) => {
      button.addEventListener("click", () => {
        button.textContent = "Saved";
        button.disabled = true;
      });
    });
  }

  bindTabs();
  bindSegments();
  bindCopyButtons();
  bindTaskActions();
  bindNavToggle();
  bindFormLike();
})();
