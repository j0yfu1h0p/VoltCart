(() => {
  const page = (
    location.pathname.split("/").pop() || "index.html"
  ).toLowerCase();
  const user = JSON.parse(localStorage.getItem("auth_user") || "null");

  const links = [
    ["index.html", "Home"],
    ["product.html", "Products"],
    ["cart.html", "Cart"],
    ["checkout.html", "Checkout"],
    ["tracking.html", "Tracking"],
    ["account.html", "Account"],
    ["admin.html", "Admin"],
    ["login.html", "Login"],
  ];

  const navLinks = links
    .filter(([href]) => href !== "admin.html" || user?.role === "admin")
    .filter(([href]) => href !== "login.html" || !user)
    .filter(([href]) => href !== "account.html" || !!user);

  const topbar = document.createElement("header");
  topbar.className = "site-topbar";
  topbar.innerHTML = `
    <div class="site-left">
      <button class="drawer-btn" id="drawerToggle" aria-label="Open menu" aria-expanded="false" aria-controls="siteDrawer">☰</button>
      <h2 class="site-title">Volt<span>Cart</span> Experience</h2>
    </div>
    <nav class="site-links" aria-label="Primary navigation">
      ${navLinks
        .filter(([href]) => href !== "login.html")
        .map(
          ([href, label]) =>
            `<a href="${href}" class="${page === href ? "active" : ""}">${label}</a>`,
        )
        .join("")}
    </nav>
    <a class="site-cta" href="${user ? "account.html" : "login.html"}">${user ? "My Account" : "Sign In"}</a>
  `;

  const overlay = document.createElement("div");
  overlay.className = "site-drawer-overlay";

  const drawer = document.createElement("aside");
  drawer.className = "site-drawer";
  drawer.id = "siteDrawer";
  drawer.innerHTML = `
    <div class="site-drawer-head">Navigate VoltCart</div>
    <nav class="site-drawer-nav">
      ${navLinks
        .map(
          ([href, label]) =>
            `<a href="${href}" class="${page === href ? "active" : ""}">${label}</a>`,
        )
        .join("")}
    </nav>
  `;

  document.body.classList.add("has-shell");
  document.body.prepend(overlay);
  document.body.prepend(drawer);
  document.body.prepend(topbar);

  const close = () => {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    document
      .getElementById("drawerToggle")
      ?.setAttribute("aria-expanded", "false");
  };

  document.getElementById("drawerToggle")?.addEventListener("click", () => {
    drawer.classList.add("open");
    overlay.classList.add("open");
    document
      .getElementById("drawerToggle")
      ?.setAttribute("aria-expanded", "true");
  });

  overlay.addEventListener("click", close);
  drawer
    .querySelectorAll("a")
    .forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
})();
