const SITE_CONFIG = {
  categories: {
    tools: [
      "Productivity",
      "Developer",
      "AI",
      "Finance",
      "Design",
      "Marketing",
      "Utilities"
    ],
    blog: [
      "Guides",
      "Comparisons",
      "Workflow",
      "Security",
      "Announcements"
    ]
  },
  tools: [
    {
      name: "Quick Note Cleaner",
      description: "Strip formatting noise from copied notes in one click.",
      categories: ["Productivity", "Utilities"],
      pricing: "Free",
      tags: ["notes", "cleanup"],
      link: "#"
    },
    {
      name: "Regex Tester Lite",
      description: "Test patterns with sample text and copy matches fast.",
      categories: ["Developer"],
      pricing: "Free",
      tags: ["regex", "dev"],
      link: "#"
    },
    {
      name: "Invoice Reminder Bot",
      description: "Track payment due dates with simple email nudges.",
      categories: ["Finance", "Productivity"],
      pricing: "Paid",
      tags: ["billing", "ops"],
      link: "#"
    },
    {
      name: "Screenshot Annotator",
      description: "Add arrows, blur, and labels to screenshots quickly.",
      categories: ["Design", "Utilities"],
      pricing: "Freemium",
      tags: ["image", "feedback"],
      link: "#"
    },
    {
      name: "Prompt Draft Helper",
      description: "Generate tighter AI prompts using role and outcome blocks.",
      categories: ["AI", "Productivity"],
      pricing: "Free",
      tags: ["prompt", "writing"],
      link: "#"
    },
    {
      name: "UTM Campaign Builder",
      description: "Create tagged campaign URLs with share-friendly presets.",
      categories: ["Marketing"],
      pricing: "Free",
      tags: ["utm", "analytics"],
      link: "#"
    },
    {
      name: "Latency Snapshot",
      description: "Run quick endpoint checks and compare response trends.",
      categories: ["Developer", "Utilities"],
      pricing: "Freemium",
      tags: ["api", "monitoring"],
      link: "#"
    },
    {
      name: "Portfolio Fee Check",
      description: "Estimate hidden broker fees across recurring trades.",
      categories: ["Finance"],
      pricing: "Paid",
      tags: ["investing", "calculator"],
      link: "#"
    },
    {
      name: "Color Pair Inspector",
      description: "Validate contrast and export brand-safe color pairs.",
      categories: ["Design"],
      pricing: "Free",
      tags: ["accessibility", "palette"],
      link: "#"
    },
    {
      name: "Schema Snippet Forge",
      description: "Build JSON-LD snippets for common site entities.",
      categories: ["Developer", "Marketing"],
      pricing: "Free",
      tags: ["seo", "structured-data"],
      link: "#"
    },
    {
      name: "Meeting Recap Draft",
      description: "Turn bullet notes into clean action-item summaries.",
      categories: ["AI", "Productivity"],
      pricing: "Freemium",
      tags: ["meetings", "summary"],
      link: "#"
    },
    {
      name: "File Name Guard",
      description: "Normalize uploads with predictable naming conventions.",
      categories: ["Utilities"],
      pricing: "Free",
      tags: ["files", "workflow"],
      link: "#"
    }
  ],
  blogPosts: [
    {
      title: "How to Pick the Right Utility Tool in 5 Minutes",
      date: "Feb 00, 2026",
      excerpt: "A fast decision framework for selecting practical tools without over-researching.",
      categories: ["Guides"],
      link: "#"
    },
    {
      title: "8 Browser Utilities We Keep in Daily Rotation",
      date: "Feb 00, 2026",
      excerpt: "A curated stack of extensions and web tools that save time every day.",
      categories: ["Workflow"],
      link: "#"
    },
    {
      title: "Tool Stack Audit: Cut 30% of Subscription Waste",
      date: "Jan 00, 2026",
      excerpt: "A practical method to remove overlap and keep only high-value software.",
      categories: ["Guides", "Comparisons"],
      link: "#"
    },
    {
      title: "AI Helpers vs Traditional Scripts: When to Use Which",
      date: "Jan 00, 2026",
      excerpt: "Comparing reliability, speed, and maintainability for common automation tasks.",
      categories: ["Comparisons"],
      link: "#"
    },
    {
      title: "A Better Way to Share Internal Tool Playbooks",
      date: "Jan 00, 2026",
      excerpt: "Structure templates your team can reuse for onboarding and handoffs.",
      categories: ["Workflow"],
      link: "#"
    },
    {
      title: "Security Basics for Everyday Utility Websites",
      date: "Dec 00, 2025",
      excerpt: "Simple hardening steps for static sites and lightweight scripts.",
      categories: ["Security", "Guides"],
      link: "#"
    },
    {
      title: "Why Fast Landing Pages Still Win in 2026",
      date: "Dec 00, 2025",
      excerpt: "Performance lessons from utility-focused sites with high repeat visits.",
      categories: ["Announcements"],
      link: "#"
    },
    {
      title: "Comparing Lightweight Search Patterns for Static Sites",
      date: "Nov 00, 2025",
      excerpt: "Pros and cons of query params, index files, and in-page filtering.",
      categories: ["Comparisons", "Workflow"],
      link: "#"
    },
    {
      title: "Content Checklist for Utility Tool Launches",
      date: "Nov 00, 2025",
      excerpt: "The minimum copy and metadata to publish confidently and iterate fast.",
      categories: ["Guides"],
      link: "#"
    },
    {
      title: "Small Site, Clear Brand: Practical Visual Rules",
      date: "Oct 00, 2025",
      excerpt: "How to keep a compact website visually coherent while adding new pages.",
      categories: ["Announcements"],
      link: "#"
    }
  ],
  trustPoints: [
    {
      title: "Practical by default",
      bullets: [
        "Focused on tools you can use immediately.",
        "No bloated directories or filler reviews."
      ]
    },
    {
      title: "Transparent picks",
      bullets: [
        "Clear Free/Paid placeholders and concise tags.",
        "Straightforward summaries with no hidden criteria."
      ]
    },
    {
      title: "Built for iteration",
      bullets: [
        "Categories live in one config object.",
        "Cards and filters are rendered from shared JS."
      ]
    }
  ]
};

window.UTILITY_BOX_CONFIG = SITE_CONFIG;

const PAGE = document.body.dataset.page || "home";
const TOOLS_PATH = document.body.dataset.toolsPath || "tools/";

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  syncFooterYear();

  const searchUI = initSearchOverlay();

  if (PAGE === "home") {
    renderHome();
  }

  if (PAGE === "tools") {
    initToolsPage(searchUI);
  }

  if (PAGE === "blog") {
    initBlogPage(searchUI);
  }
});

function initMobileNav() {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".primary-nav");

  if (!header || !toggle || !nav) return;

  const closeMenu = () => {
    header.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const nextState = !header.classList.contains("menu-open");
    header.classList.toggle("menu-open", nextState);
    toggle.setAttribute("aria-expanded", String(nextState));
  });

  nav.querySelectorAll("a, button").forEach((item) => {
    item.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    if (!header.classList.contains("menu-open")) return;
    if (!header.contains(event.target)) closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 860) closeMenu();
  });
}

function syncFooterYear() {
  document.querySelectorAll("[data-current-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
}

function initSearchOverlay() {
  const modal = document.getElementById("search-modal");
  const input = document.getElementById("site-search-input");
  const note = modal ? modal.querySelector("[data-search-note]") : null;
  const routing = modal ? modal.querySelector("[data-search-routing]") : null;
  const routeLink = modal ? modal.querySelector("[data-tools-route]") : null;
  const goButton = modal ? modal.querySelector("[data-search-go]") : null;

  let inlineHandler = null;

  if (!modal || !input) {
    return {
      setInlineHandler: () => {},
      setQuery: () => {},
      getQuery: () => ""
    };
  }

  const listingPage = PAGE === "tools" || PAGE === "blog";

  if (routeLink) {
    routeLink.setAttribute("href", TOOLS_PATH);
  }

  if (note) {
    note.textContent = listingPage
      ? "Type to filter cards on this page."
      : "Search works on Tools and Blog pages.";
  }

  if (routing) {
    routing.classList.toggle("visible", !listingPage);
  }

  const syncRoute = () => {
    if (!routeLink) return;
    const query = input.value.trim();
    routeLink.setAttribute("href", query ? `${TOOLS_PATH}?q=${encodeURIComponent(query)}` : TOOLS_PATH);
  };

  const openModal = () => {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    syncRoute();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  const closeModal = () => {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  const routeToTools = () => {
    const query = input.value.trim();
    window.location.href = query ? `${TOOLS_PATH}?q=${encodeURIComponent(query)}` : TOOLS_PATH;
  };

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", openModal);
  });

  document.querySelectorAll("[data-search-close]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    syncRoute();
    if (inlineHandler) inlineHandler(query);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !listingPage) {
      event.preventDefault();
      routeToTools();
    }
  });

  if (goButton) {
    goButton.addEventListener("click", routeToTools);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  return {
    setInlineHandler(handler) {
      inlineHandler = handler;
      handler(input.value.trim().toLowerCase());
    },
    setQuery(query) {
      input.value = query;
      syncRoute();
      if (inlineHandler) inlineHandler(query.trim().toLowerCase());
    },
    getQuery() {
      return input.value.trim().toLowerCase();
    }
  };
}

function renderHome() {
  const toolsMount = document.getElementById("home-featured-tools");
  const postsMount = document.getElementById("home-latest-posts");
  const trustMount = document.getElementById("home-trust-grid");

  if (toolsMount) {
    const featured = SITE_CONFIG.tools.slice(0, 6);
    toolsMount.innerHTML = featured.map(renderToolCard).join("");
  }

  if (postsMount) {
    const latest = SITE_CONFIG.blogPosts.slice(0, 3);
    postsMount.innerHTML = latest.map(renderBlogCard).join("");
  }

  if (trustMount) {
    trustMount.innerHTML = SITE_CONFIG.trustPoints
      .map(
        (point) => `
          <article class="card bullet-card">
            <h3>${escapeHtml(point.title)}</h3>
            <ul>
              ${point.bullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
            </ul>
          </article>
        `
      )
      .join("");
  }
}

function initToolsPage(searchUI) {
  const chipMount = document.getElementById("tools-categories");
  const gridMount = document.getElementById("tools-grid");
  const countNode = document.getElementById("tools-count");
  let activeCategory = "All";
  let searchQuery = "";

  if (!chipMount || !gridMount || !countNode) return;

  renderCategoryChips(chipMount, SITE_CONFIG.categories.tools, (category) => {
    activeCategory = category;
    applyFilters();
  });

  const queryFromUrl = getQueryParam();
  if (queryFromUrl) {
    searchUI.setQuery(queryFromUrl);
  }

  searchUI.setInlineHandler((query) => {
    searchQuery = query;
    applyFilters();
  });

  function applyFilters() {
    const filtered = SITE_CONFIG.tools.filter((tool) => {
      const categoryMatch = activeCategory === "All" || tool.categories.includes(activeCategory);
      const haystack = [tool.name, tool.description, tool.pricing, ...tool.categories, ...tool.tags]
        .join(" ")
        .toLowerCase();
      const queryMatch = !searchQuery || haystack.includes(searchQuery);
      return categoryMatch && queryMatch;
    });

    countNode.textContent = `${filtered.length} tool${filtered.length === 1 ? "" : "s"} shown`;
    gridMount.innerHTML = filtered.length
      ? filtered.map(renderToolCard).join("")
      : '<p class="empty-state">No tools match this filter yet. Try another category or search term.</p>';
  }
}

function initBlogPage(searchUI) {
  const chipMount = document.getElementById("blog-categories");
  const gridMount = document.getElementById("blog-grid");
  const countNode = document.getElementById("blog-count");
  let activeCategory = "All";
  let searchQuery = "";

  if (!chipMount || !gridMount || !countNode) return;

  renderCategoryChips(chipMount, SITE_CONFIG.categories.blog, (category) => {
    activeCategory = category;
    applyFilters();
  });

  const queryFromUrl = getQueryParam();
  if (queryFromUrl) {
    searchUI.setQuery(queryFromUrl);
  }

  searchUI.setInlineHandler((query) => {
    searchQuery = query;
    applyFilters();
  });

  function applyFilters() {
    const filtered = SITE_CONFIG.blogPosts.filter((post) => {
      const categoryMatch = activeCategory === "All" || post.categories.includes(activeCategory);
      const haystack = [post.title, post.date, post.excerpt, ...post.categories].join(" ").toLowerCase();
      const queryMatch = !searchQuery || haystack.includes(searchQuery);
      return categoryMatch && queryMatch;
    });

    countNode.textContent = `${filtered.length} post${filtered.length === 1 ? "" : "s"} shown`;
    gridMount.innerHTML = filtered.length
      ? filtered.map(renderBlogCard).join("")
      : '<p class="empty-state">No posts match this filter yet. Try another category or search term.</p>';
  }
}

function renderCategoryChips(container, categories, onSelect) {
  const chips = ["All", ...categories];
  container.innerHTML = "";

  chips.forEach((chip, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.textContent = chip;
    button.setAttribute("aria-pressed", String(index === 0));

    button.addEventListener("click", () => {
      container.querySelectorAll(".filter-chip").forEach((item) => {
        item.setAttribute("aria-pressed", "false");
      });
      button.setAttribute("aria-pressed", "true");
      onSelect(chip);
    });

    container.appendChild(button);
  });
}

function renderToolCard(tool) {
  return `
    <article class="card tool-card">
      <h3>${escapeHtml(tool.name)}</h3>
      <p>${escapeHtml(tool.description)}</p>
      <div class="card-meta">
        ${tool.categories.map((category) => `<span class="tag">${escapeHtml(category)}</span>`).join("")}
        ${tool.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}
        <span class="tag pricing">${escapeHtml(tool.pricing)}</span>
      </div>
      <div class="card-actions">
        <a class="btn btn-secondary" href="${escapeAttribute(tool.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeAttribute(tool.name)} external link">Visit Tool</a>
      </div>
    </article>
  `;
}

function renderBlogCard(post) {
  return `
    <article class="card blog-card">
      <h3>${escapeHtml(post.title)}</h3>
      <p><strong>${escapeHtml(post.date)}</strong></p>
      <p>${escapeHtml(post.excerpt)}</p>
      <div class="card-meta">
        ${post.categories.map((category) => `<span class="tag">${escapeHtml(category)}</span>`).join("")}
      </div>
      <div class="card-actions">
        <a class="btn btn-tertiary" href="${escapeAttribute(post.link)}" aria-label="Read ${escapeAttribute(post.title)}">Read</a>
      </div>
    </article>
  `;
}

function getQueryParam() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("q") || "").trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
