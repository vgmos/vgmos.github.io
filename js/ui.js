/* =====================================================================
   ui.js — single-page hub behaviour for vgmos.github.io
     1. sliding nav underline driven by scroll position + hover
     2. smooth in-page scrolling for nav + hero anchors (with header offset)
     3. scroll-spy: the underline follows the section you're reading
     4. lightweight same-origin content swaps with a normal-load fallback
   Degrades cleanly: content is only hidden during page changes, in-page
   links fall back to normal navigation when motion is reduced, and
   prefers-reduced-motion is fully respected.
   ===================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  var motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduce = motionPreference.matches;
  var pageTransitionKey = "vgmos-page-transition";
  var pageTransitionOutMs = 70;
  var pageTransitionInMs = 110;
  var contentTransitionMs = 240;
  var mathDelimiters = [
    { left: "$$", right: "$$", display: true },
    { left: "\\(", right: "\\)", display: false }
  ];
  var navInFlight = false;
  var pendingNavigation = null;
  var activeNavigation = null;
  var historyEntrySequence = 0;
  var prefetched = {};
  var pageStyleLoads = {};
  var fallbackNavigationTimer = 0;
  var fallbackNavigationUrl = null;
  var scrollSaveTimer = 0;
  var scrollSaveDelayMs = 250;
  var pageScopes = new WeakMap();
  var activePageScope = null;
  var scriptHydrationSequence = 0;
  var exitLayerSequence = 0;
  var lifecycleBootstrap = window.vgmosPageLifecycle;
  var queuedPageCleanups = lifecycleBootstrap && Array.isArray(lifecycleBootstrap.queue)
    ? lifecycleBootstrap.queue.slice()
    : [];
  root.classList.add("js-on");

  var syncMotionPreference = function (event) { reduce = event.matches; };
  if (motionPreference.addEventListener) motionPreference.addEventListener("change", syncMotionPreference);
  else if (motionPreference.addListener) motionPreference.addListener(syncMotionPreference);

  /* --------------------------------------------- swapped-page lifecycle */
  function mainForOwner(owner) {
    if (owner && owner.nodeType === 1) {
      if (owner.matches && owner.matches("main.page-content")) return owner;
      if (owner.closest) {
        var parentMain = owner.closest("main.page-content");
        if (parentMain) return parentMain;
      }
    }
    return activePageScope && activePageScope.main && activePageScope.main.isConnected
      ? activePageScope.main
      : document.querySelector("main.page-content");
  }

  function makePageScope(main) {
    var controller = new AbortController();
    var cleanups = [];
    var destroyed = false;
    var scope = {
      main: main,
      signal: controller.signal,
      onCleanup: function (cleanup) {
        if (typeof cleanup !== "function") return function () {};
        if (destroyed || controller.signal.aborted) {
          try { cleanup(); } catch (error) {}
          return function () {};
        }
        cleanups.push(cleanup);
        return function () {
          var index = cleanups.indexOf(cleanup);
          if (index >= 0) cleanups.splice(index, 1);
        };
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        controller.abort();
        cleanups.slice().reverse().forEach(function (cleanup) {
          try { cleanup(); } catch (error) {}
        });
        cleanups = [];
        if (activePageScope === scope) activePageScope = null;
      }
    };
    pageScopes.set(main, scope);
    return scope;
  }

  function pageScopeFor(owner) {
    var main = mainForOwner(owner);
    if (!main) return null;
    var scope = pageScopes.get(main);
    if (!scope) {
      if (!main.isConnected) return null;
      scope = makePageScope(main);
    }
    if (main.isConnected && !scope.signal.aborted) activePageScope = scope;
    return scope;
  }

  function registerPageCleanup(cleanup, owner) {
    var scope = pageScopeFor(owner);
    if (scope) return scope.onCleanup(cleanup);
    if (typeof cleanup === "function") {
      try { cleanup(); } catch (error) {}
    }
    return function () {};
  }

  window.vgmosPageLifecycle = {
    scope: pageScopeFor,
    register: registerPageCleanup
  };

  pageScopeFor(document.querySelector("main.page-content"));
  queuedPageCleanups.forEach(function (entry) {
    if (!entry || entry.cancelled) return;
    entry.unregister = registerPageCleanup(entry.cleanup, entry.owner);
  });
  queuedPageCleanups.length = 0;
  if (lifecycleBootstrap && Array.isArray(lifecycleBootstrap.queue)) {
    lifecycleBootstrap.queue.length = 0;
  }

  /* ----------------------------------------------------- colour theme */
  var themeStorageKey = "vgmos-theme";
  var themeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function readStoredTheme() {
    try {
      var stored = window.localStorage.getItem(themeStorageKey);
      return stored === "dark" || stored === "light" ? stored : null;
    } catch (error) {
      return null;
    }
  }

  function preferredTheme() {
    return themeQuery && themeQuery.matches ? "dark" : "light";
  }

  function updateThemeToggle(theme) {
    var isDark = theme === "dark";
    var label = isDark ? "Switch to light mode" : "Switch to dark mode";
    Array.prototype.slice.call(document.querySelectorAll(".theme-toggle")).forEach(function (button) {
      button.setAttribute("aria-pressed", isDark ? "true" : "false");
      button.setAttribute("aria-label", label);

      var labelNode = button.querySelector(".theme-toggle__label");
      if (labelNode) labelNode.textContent = label;
    });
  }

  function setTheme(theme, persist) {
    var next = theme === "dark" || theme === "light" ? theme : preferredTheme();
    root.setAttribute("data-theme", next);
    updateThemeToggle(next);

    try {
      document.dispatchEvent(new CustomEvent("vgmos:themechange", {
        detail: { theme: next, persisted: !!persist }
      }));
    } catch (error) {}

    if (!persist) return;
    try {
      window.localStorage.setItem(themeStorageKey, next);
    } catch (error) {}
  }

  setTheme(readStoredTheme() || preferredTheme(), false);

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest(".theme-toggle") : null;
    if (!button) return;

    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(next, true);

    button.classList.remove("is-flipping");
    void button.offsetWidth;
    if (!reduce) button.classList.add("is-flipping");
  });

  if (themeQuery) {
    var syncSystemTheme = function () {
      if (!readStoredTheme()) setTheme(preferredTheme(), false);
    };

    if (themeQuery.addEventListener) {
      themeQuery.addEventListener("change", syncSystemTheme);
    } else if (themeQuery.addListener) {
      themeQuery.addListener(syncSystemTheme);
    }
  }

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  function currentScrollPosition() {
    return {
      x: window.pageXOffset || document.documentElement.scrollLeft || 0,
      y: window.pageYOffset || document.documentElement.scrollTop || 0
    };
  }

  function copyState(state) {
    var next = {};
    if (!state || typeof state !== "object") return next;
    Object.keys(state).forEach(function (key) {
      next[key] = state[key];
    });
    return next;
  }

  function makeHistoryState(state, scroll) {
    var next = copyState(state);
    next.soft = true;
    next.scroll = scroll || { x: 0, y: 0 };
    return next;
  }

  function nextSoftEntryId() {
    historyEntrySequence += 1;
    return "vgmos-" + Date.now().toString(36) + "-" + historyEntrySequence.toString(36);
  }

  function scrollFromState(state) {
    var scroll = state && state.scroll;
    if (!scroll || typeof scroll.y !== "number") return null;
    return {
      x: typeof scroll.x === "number" ? scroll.x : 0,
      y: scroll.y
    };
  }

  function scrollToPosition(scroll) {
    if (!scroll) return;
    window.scrollTo({
      top: Math.max(0, scroll.y),
      left: Math.max(0, scroll.x),
      behavior: "auto"
    });
  }

  function saveCurrentScroll() {
    if (!history.replaceState) return;
    try {
      history.replaceState(
        makeHistoryState(history.state, currentScrollPosition()),
        "",
        window.location.href
      );
    } catch (error) {}
  }

  function scheduleScrollSave() {
    if (navInFlight || scrollSaveTimer) return;
    scrollSaveTimer = window.setTimeout(function () {
      scrollSaveTimer = 0;
      saveCurrentScroll();
    }, scrollSaveDelayMs);
  }

  function flushScrollSave() {
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = 0;
    }
    saveCurrentScroll();
  }

  var initialScroll = scrollFromState(history.state);
  if (initialScroll) scrollToPosition(initialScroll);
  saveCurrentScroll();

  if ("onscrollend" in window) {
    window.addEventListener("scrollend", flushScrollSave, { passive: true });
  } else {
    window.addEventListener("scroll", scheduleScrollSave, { passive: true });
  }
  window.addEventListener("load", function () {
    if (!initialScroll || Math.abs((window.pageYOffset || document.documentElement.scrollTop || 0) - initialScroll.y) <= 4) return;
    scrollToPosition(initialScroll);
    saveCurrentScroll();
  });
  window.addEventListener("pagehide", flushScrollSave);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushScrollSave();
  });

  if (root.classList.contains("is-transitioning-in")) {
    try {
      sessionStorage.removeItem(pageTransitionKey);
    } catch (error) {}

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        root.classList.add("is-transition-ready");
        window.setTimeout(function () {
          root.classList.remove("is-transitioning-in");
          root.classList.remove("is-transition-ready");
        }, pageTransitionInMs + 50);
      });
    });
  }

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      root.classList.remove("is-transitioning-out");
      root.classList.remove("is-transitioning-in");
      root.classList.remove("is-transition-ready");
    }
  });

  function hashOf(a) {
    var h = a.getAttribute("href") || "";
    var i = h.indexOf("#");
    return i >= 0 ? h.slice(i + 1) : "";
  }

  /* ---------------------------------------- nav underline (follows current) */
  var nav = document.querySelector(".site-nav");
  var trigger = nav && nav.querySelector(".trigger");
  var underline = nav && nav.querySelector(".nav-underline");
  var navLinks = trigger ? Array.prototype.slice.call(trigger.querySelectorAll(".page-link")) : [];
  var current = navLinks.filter(function (a) { return a.classList.contains("page-link--active"); })[0] || null;
  var suppressSpyUntil = 0;
  var sectionSpy = null;

  function place(link, animate) {
    if (!underline) return;
    if (!link) { underline.style.width = "0"; return; }
    if (!animate) underline.style.transition = "none";
    underline.style.width = link.offsetWidth + "px";
    underline.style.transform = "translateX(" + link.offsetLeft + "px)";
    if (!animate) { void underline.offsetWidth; underline.style.transition = ""; }
  }

  function setCurrent(link, animate) {
    current = link;
    navLinks.forEach(function (a) {
      var isCurrent = a === link;
      a.classList.toggle("page-link--active", isCurrent);
      if (isCurrent) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
    place(link, animate);
  }

  function cleanPath(pathname) {
    return pathname.replace(/\/index\.html$/, "/");
  }

  function homePath() {
    var home = document.querySelector(".site-title");
    try {
      return cleanPath(new URL(home ? home.href : "/", window.location.href).pathname);
    } catch (error) {
      return "/";
    }
  }

  function linkPath(a) {
    try {
      return cleanPath(new URL(a.href, window.location.href).pathname);
    } catch (error) {
      return "";
    }
  }

  function syncCurrentFromLocation(animate) {
    var path = cleanPath(window.location.pathname);
    var hash = window.location.hash.replace(/^#/, "");
    var active = null;

    if (path === homePath() && hash) {
      active = navLinks.filter(function (a) { return hashOf(a) === hash; })[0] || null;
    } else {
      active = navLinks.filter(function (a) {
        return !hashOf(a) && linkPath(a) === path;
      })[0] || null;

      if (!active) {
        var parentSection = "";
        if (/\/tools(?:\/|$)/.test(path)) parentSection = "tools";
        else if (/\/projects(?:\/|$)/.test(path)) parentSection = "projects";
        else if (/\/writing(?:\/|$)/.test(path) || /\/\d{4}\/\d{2}\/\d{2}\//.test(path)) parentSection = "notebook";

        if (parentSection) {
          active = navLinks.filter(function (a) { return hashOf(a) === parentSection; })[0] || null;
        }
      }
    }

    setCurrent(active, animate);
  }

  if (underline && navLinks.length) {
    place(current, false);
    navLinks.forEach(function (a) {
      a.addEventListener("mouseenter", function () { if (!reduce) place(a, true); });
      a.addEventListener("focus", function () { place(a, !reduce); });
    });
    nav.addEventListener("mouseleave", function () { place(current, !reduce); });

    var recalc = function () { place(current, false); };
    window.addEventListener("resize", recalc, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recalc);
  }

  function closeMobileNav() {
    var toggle = document.getElementById("nav-trigger");
    if (toggle) toggle.checked = false;
  }

  function scrollToHash(hash, smooth) {
    var id = (hash || "").replace(/^#/, "");
    var target = id && document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: smooth && !reduce ? "smooth" : "auto", block: "start" });
    return true;
  }

  function preserveHashInAddress(a) {
    if (!history.pushState) return;
    var next;
    try {
      next = new URL(a.href, window.location.href);
    } catch (error) {
      return;
    }
    if (!next.hash || next.hash === window.location.hash) return;
    flushScrollSave();
    history.pushState(
      makeHistoryState(null, currentScrollPosition()),
      "",
      next.pathname + next.search + next.hash
    );
  }

  /* ---------------------------- smooth scroll for any in-page anchor link */
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[data-scroll]") : null;
    if (!a) return;

    var id = hashOf(a);
    var target = id && document.getElementById(id);
    if (!target) return; // section isn't on this page; page navigation handles it

    event.preventDefault();
    if (a.classList.contains("page-link")) {
      suppressSpyUntil = Date.now() + 1200;
      setCurrent(a, !reduce);
    }
    preserveHashInAddress(a);
    scrollToHash(id, true);
    closeMobileNav();
  });

  /* -------------------------------- lightweight same-origin page transition */
  function transitionableLink(a, event) {
    if (!a || reduce || event.defaultPrevented || event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    if (a.hasAttribute("download")) return null;
    if (a.target && a.target !== "_self") return null;

    var url;
    try {
      url = new URL(a.href, window.location.href);
    } catch (error) {
      return null;
    }

    if (url.origin !== window.location.origin) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash) return null;
    if (url.href === window.location.href) return null;

    return url;
  }

  function delay(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function fetchDocument(url) {
    var key = url.href;
    if (!prefetched[key]) {
      prefetched[key] = window.fetch(key, {
        credentials: "same-origin",
        headers: { "Accept": "text/html" }
      }).then(function (response) {
        if (!response.ok) throw new Error("Navigation failed");
        var type = response.headers.get("content-type") || "";
        if (type.indexOf("text/html") === -1) throw new Error("Not an HTML page");
        return response.text();
      }).then(function (html) {
        return new DOMParser().parseFromString(html, "text/html");
      }).catch(function (error) {
        delete prefetched[key];
        throw error;
      });
    }
    return prefetched[key];
  }

  function pageNeedsNormalLoad(doc) {
    if (!doc || !doc.querySelector("main.page-content")) return true;
    return false;
  }

  function hasHeadAsset(tag, attr, value) {
    return Array.prototype.slice.call(document.head.querySelectorAll(tag)).some(function (node) {
      return node[attr] === value;
    });
  }

  function copyAttributes(from, to, skip) {
    Array.prototype.slice.call(from.attributes || []).forEach(function (attr) {
      if (!skip || skip.indexOf(attr.name) === -1) to.setAttribute(attr.name, attr.value);
    });
  }

  function ensureStylesheet(link) {
    if (!link || !link.href || hasHeadAsset("link", "href", link.href)) return;
    var next = document.createElement("link");
    copyAttributes(link, next);
    document.head.appendChild(next);
  }

  function pageStyleHrefs(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll("link[data-vgmos-page-style][rel='stylesheet']"))
      .map(function (link) { return link.href; })
      .filter(function (href, index, hrefs) { return hrefs.indexOf(href) === index; });
  }

  function pageStyleNode(href) {
    return Array.prototype.slice.call(document.head.querySelectorAll("link[data-vgmos-page-style][rel='stylesheet']"))
      .filter(function (link) { return link.href === href; })[0] || null;
  }

  function pageStyleReady(link) {
    if (!link) return false;
    try {
      return !!link.sheet;
    } catch (error) {
      // A stylesheet whose rules are not inspectable can still be fully loaded.
      return true;
    }
  }

  function waitForPageStyle(source) {
    var href = source.href;
    var existing = pageStyleNode(href);
    var record = pageStyleLoads[href];

    if (record && (!record.node.isConnected || record.node !== existing)) {
      delete pageStyleLoads[href];
      record = null;
    }
    if (record) {
      if (record.status === "loading" && pageStyleReady(record.node)) record.resolve();
      return record.promise;
    }

    var node = existing;
    if (!node) {
      node = document.createElement("link");
      copyAttributes(source, node);
    }

    record = {
      node: node,
      status: pageStyleReady(node) ? "loaded" : "loading",
      promise: null,
      resolve: function () {},
      reject: function () {}
    };
    record.promise = new Promise(function (resolve, reject) {
      function cleanup() {
        node.removeEventListener("load", loaded);
        node.removeEventListener("error", failed);
      }
      function loaded() {
        if (record.status !== "loading") return;
        record.status = "loaded";
        cleanup();
        resolve();
      }
      function failed() {
        if (record.status !== "loading") return;
        record.status = "error";
        cleanup();
        if (pageStyleLoads[href] === record) delete pageStyleLoads[href];
        if (node.parentNode) node.parentNode.removeChild(node);
        reject(new Error("Page stylesheet failed to load"));
      }
      record.resolve = loaded;
      record.reject = failed;
      if (record.status === "loaded") resolve();
      else {
        node.addEventListener("load", loaded, { once: true });
        node.addEventListener("error", failed, { once: true });
      }
    });
    pageStyleLoads[href] = record;
    if (!existing) document.head.appendChild(node);
    return record.promise;
  }

  function preparePageStyles(doc) {
    var expected = pageStyleHrefs(doc);
    var loads = Array.prototype.slice.call(doc.querySelectorAll("link[data-vgmos-page-style][rel='stylesheet']"))
      .filter(function (link) { return !!link.href; })
      .map(waitForPageStyle);

    return Promise.all(loads).then(function () { return expected; });
  }

  function finalizePageStyles(expected) {
    var keep = expected || [];
    Array.prototype.slice.call(document.head.querySelectorAll("link[data-vgmos-page-style][rel='stylesheet']"))
      .forEach(function (link) {
        if (keep.indexOf(link.href) !== -1) return;
        var record = pageStyleLoads[link.href];
        if (record && record.node === link) {
          delete pageStyleLoads[link.href];
          if (record.status === "loading") record.reject();
        }
        if (link.parentNode) link.parentNode.removeChild(link);
      });
  }

  function ensureScript(script) {
    if (!script || !script.src || hasHeadAsset("script", "src", script.src)) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var next = document.createElement("script");
      copyAttributes(script, next, ["onload"]);
      next.async = false;
      next.onload = resolve;
      next.onerror = reject;
      document.head.appendChild(next);
    });
  }

  function waitForMathReady() {
    if (typeof window.renderMathInElement === "function") return Promise.resolve();
    return new Promise(function (resolve) {
      var tries = 0;
      var timer = window.setInterval(function () {
        tries += 1;
        if (typeof window.renderMathInElement === "function" || tries >= 40) {
          window.clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  }

  function ensureMathAssets(doc) {
    if (!doc || !doc.querySelector("link[href*='katex'], script[src*='katex']")) {
      return Promise.resolve();
    }

    Array.prototype.slice.call(doc.querySelectorAll("link[href*='katex']")).forEach(ensureStylesheet);

    return Array.prototype.slice.call(doc.querySelectorAll("script[src*='katex'], script[src*='auto-render']"))
      .reduce(function (ready, script) {
        return ready.then(function () { return ensureScript(script); });
      }, Promise.resolve())
      .then(waitForMathReady);
  }

  var mathResizeBound = false;

  function updateMathOverflow(scope) {
    var container = scope && scope.querySelectorAll ? scope : document;
    Array.prototype.slice.call(container.querySelectorAll(".katex-display")).forEach(function (display) {
      if (display.scrollWidth > display.clientWidth + 1) display.tabIndex = 0;
      else display.removeAttribute("tabindex");
    });
  }

  function renderMath(main) {
    if (typeof window.renderMathInElement === "function") {
      try {
        window.renderMathInElement(main || document.body, {
          delimiters: mathDelimiters,
          throwOnError: false
        });
      } catch (error) {}
    }

    var update = function () { updateMathOverflow(main || document); };
    window.requestAnimationFrame(update);
    window.setTimeout(update, 250);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
    if (!mathResizeBound) {
      mathResizeBound = true;
      window.addEventListener("resize", function () {
        updateMathOverflow(document.querySelector("main.page-content") || document);
      }, { passive: true });
    }
  }

  function runMainScripts(main) {
    if (!main) return Promise.resolve();
    return Array.prototype.slice.call(main.querySelectorAll("script")).reduce(function (ready, oldScript) {
      return ready.then(function () {
        return new Promise(function (resolve, reject) {
          var next = document.createElement("script");
          var inlineModule = oldScript.type === "module" && !oldScript.src;
          var waitsForEvaluation = inlineModule || !!oldScript.src;
          var settled = false;
          var timeout = 0;
          var token = inlineModule ? "module-" + (++scriptHydrationSequence) : "";

          function finish(error) {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            if (inlineModule) window.removeEventListener("vgmos:inline-module-ready", moduleReady);
            if (error) reject(error);
            else resolve();
          }

          function moduleReady(event) {
            if (event.detail && event.detail.token === token) finish();
          }

          copyAttributes(oldScript, next);
          if (waitsForEvaluation) {
            next.addEventListener("load", function () { finish(); }, { once: true });
            next.addEventListener("error", function () {
              finish(new Error("Page script failed to load"));
            }, { once: true });
          }
          if (inlineModule) {
            window.addEventListener("vgmos:inline-module-ready", moduleReady);
            next.text = (oldScript.text || oldScript.textContent || "") +
              "\nwindow.dispatchEvent(new CustomEvent('vgmos:inline-module-ready',{detail:{token:" +
              JSON.stringify(token) + "}}));";
          } else {
            next.text = oldScript.text || oldScript.textContent || "";
          }
          if (waitsForEvaluation) {
            timeout = window.setTimeout(function () {
              finish(new Error("Page script hydration timed out"));
            }, 15000);
          }
          oldScript.replaceWith(next);
          if (!waitsForEvaluation) finish();
        });
      });
    }, Promise.resolve());
  }

  function hydratePage(doc, main) {
    return runMainScripts(main).then(function () {
      return ensureMathAssets(doc).catch(function () {});
    }).then(function () {
      renderMath(main);
    });
  }

  function dispatchMainLifecycle(name, main) {
    try {
      document.dispatchEvent(new CustomEvent(name, {
        detail: { main: main || null }
      }));
    } catch (error) {}
  }

  function syncHead(doc) {
    var nextTitle = doc.querySelector("title");
    if (nextTitle) document.title = nextTitle.textContent;

    [
      "meta[name='description']",
      "link[rel='canonical']",
      "meta[property='og:title']",
      "meta[property='og:description']",
      "meta[property='og:url']",
      "meta[property='og:type']",
      "meta[name='twitter:card']",
      "meta[property='twitter:title']"
    ].forEach(function (selector) {
      var currentNode = document.head.querySelector(selector);
      var nextNode = doc.head.querySelector(selector);
      if (currentNode && nextNode) currentNode.replaceWith(nextNode.cloneNode(true));
      else if (!currentNode && nextNode) document.head.appendChild(nextNode.cloneNode(true));
      else if (currentNode && !nextNode) currentNode.remove();
    });
  }

  function focusMain(main) {
    if (!main) return;
    main.setAttribute("tabindex", "-1");
    try {
      main.focus({ preventScroll: true });
    } catch (error) {
      main.focus();
    }
  }

  function fallbackNavigate(url, saveScroll) {
    if (saveScroll !== false) flushScrollSave();
    try {
      sessionStorage.setItem(pageTransitionKey, "1");
    } catch (error) {}
    root.classList.add("is-transitioning-out");
    fallbackNavigationUrl = new URL(url.href);
    if (fallbackNavigationTimer) window.clearTimeout(fallbackNavigationTimer);
    fallbackNavigationTimer = window.setTimeout(function () {
      var destination = fallbackNavigationUrl;
      fallbackNavigationTimer = 0;
      fallbackNavigationUrl = null;
      if (destination) window.location.href = destination.href;
    }, pageTransitionOutMs);
  }

  function setupScrollSpy() {
    if (sectionSpy) {
      sectionSpy.disconnect();
      sectionSpy = null;
    }

    var spyLinks = navLinks.filter(function (a) {
      return a.hasAttribute("data-scroll") && document.getElementById(hashOf(a));
    });
    var linkFor = {};
    spyLinks.forEach(function (a) { linkFor[hashOf(a)] = a; });
    var sections = spyLinks.map(function (a) { return document.getElementById(hashOf(a)); });

    if ("IntersectionObserver" in window && sections.length) {
      sectionSpy = new IntersectionObserver(function (entries) {
        if (Date.now() < suppressSpyUntil) return;
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var link = linkFor[en.target.id];
            if (link && link !== current) setCurrent(link, !reduce);
          }
        });
      }, { rootMargin: "-96px 0px -70% 0px", threshold: 0 });
      sections.forEach(function (s) { sectionSpy.observe(s); });
    }
  }

  function isolateExitLayerIds(clone) {
    var prefix = "vgmos-exit-" + (++exitLayerSequence) + "-";
    var idMap = {};
    var identified = [];
    if (clone.id) identified.push(clone);
    identified = identified.concat(Array.prototype.slice.call(clone.querySelectorAll("[id]")));
    identified.forEach(function (node) {
      var previous = node.id;
      var next = prefix + previous;
      idMap[previous] = next;
      node.id = next;
    });

    var ids = Object.keys(idMap).sort(function (a, b) { return b.length - a.length; });
    var tokenAttributes = [
      "for", "headers", "list", "aria-activedescendant", "aria-controls",
      "aria-describedby", "aria-details", "aria-errormessage", "aria-flowto",
      "aria-labelledby", "aria-owns"
    ];

    [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*"))).forEach(function (node) {
      tokenAttributes.forEach(function (name) {
        if (!node.hasAttribute(name)) return;
        var tokens = (node.getAttribute(name) || "").split(/\s+/).filter(Boolean);
        node.setAttribute(name, tokens.map(function (token) { return idMap[token] || token; }).join(" "));
      });

      ["href", "xlink:href"].forEach(function (name) {
        var value = node.getAttribute(name);
        if (value && value.charAt(0) === "#" && idMap[value.slice(1)]) {
          node.setAttribute(name, "#" + idMap[value.slice(1)]);
        }
      });

      Array.prototype.slice.call(node.attributes || []).forEach(function (attribute) {
        var value = attribute.value;
        ids.forEach(function (id) {
          value = value.split("url(#" + id + ")").join("url(#" + idMap[id] + ")");
        });
        if (value !== attribute.value) node.setAttribute(attribute.name, value);
      });
    });

    Array.prototype.slice.call(clone.querySelectorAll("style")).forEach(function (style) {
      var css = style.textContent || "";
      ids.forEach(function (id) {
        css = css.split("#" + id).join("#" + idMap[id]);
      });
      style.textContent = css;
    });
  }

  function makeExitLayer(main) {
    if (!main) return null;

    var rect = main.getBoundingClientRect();
    var layer = document.createElement("div");
    var clone = main.cloneNode(true);
    isolateExitLayerIds(clone);

    layer.className = "page-exit-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("inert", "");
    layer.inert = true;
    layer.style.top = rect.top + "px";
    layer.style.left = rect.left + "px";
    layer.style.width = rect.width + "px";
    layer.style.height = rect.height + "px";

    clone.removeAttribute("tabindex");
    layer.appendChild(clone);
    document.body.appendChild(layer);

    return layer;
  }

  function completeNavigation(
    url,
    doc,
    replaceHistory,
    transientHash,
    restoreScroll,
    destinationState,
    hasDestinationState,
    freshReplace
  ) {
    var nextMain = doc.querySelector("main.page-content");
    var currentMain = document.querySelector("main.page-content");
    var historyUrl = url.href;
    var nextScroll = restoreScroll || { x: 0, y: 0 };

    if (!nextMain || !currentMain) return null;

    syncHead(doc);
    var replacementMain = nextMain.cloneNode(true);
    replacementMain.setAttribute("inert", "");
    replacementMain.inert = true;
    currentMain.replaceWith(replacementMain);
    if (replaceHistory) {
      var stateSource = freshReplace
        ? null
        : hasDestinationState ? destinationState : history.state;
      var replacedState = makeHistoryState(stateSource, nextScroll);
      if (freshReplace) replacedState.softEntryId = nextSoftEntryId();
      history.replaceState(replacedState, "", historyUrl);
    } else {
      var pushedState = makeHistoryState(null, nextScroll);
      pushedState.softEntryId = nextSoftEntryId();
      history.pushState(pushedState, "", historyUrl);
    }
    activePageScope = pageScopeFor(replacementMain);
    dispatchMainLifecycle("vgmos:mainchange", replacementMain);

    setupScrollSpy();
    syncCurrentFromLocation(false);
    closeMobileNav();

    if (url.hash) {
      if (scrollToHash(url.hash, false) && transientHash) {
        setCurrent(navLinks.filter(function (a) { return hashOf(a) === url.hash.replace(/^#/, ""); })[0] || current, false);
      }
    } else if (restoreScroll) {
      scrollToPosition(restoreScroll);
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    saveCurrentScroll();
    return replacementMain;
  }

  var navigationFallback = {};
  var navigationSuperseded = {};

  function makeNavigationAttempt() {
    var rejectCancellation;
    var cancelled = false;
    var cancellation = new Promise(function (_, reject) {
      rejectCancellation = reject;
    });

    return {
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
        rejectCancellation(navigationSuperseded);
      },
      race: function (operation) {
        return Promise.race([operation, cancellation]);
      }
    };
  }

  function softNavigate(
    url,
    replaceHistory,
    transientHash,
    restoreScroll,
    destinationState,
    hasDestinationState,
    freshReplace
  ) {
    // Once a soft navigation has fallen back, finish with a native load. A
    // newer request may supersede its destination, but must not race the old
    // delayed redirect or restart work behind the transition overlay.
    if (fallbackNavigationTimer) {
      fallbackNavigate(url, false);
      return;
    }
    if (replaceHistory) {
      if (scrollSaveTimer) {
        window.clearTimeout(scrollSaveTimer);
        scrollSaveTimer = 0;
      }
    } else {
      flushScrollSave();
    }
    if (navInFlight) {
      pendingNavigation = {
        url: new URL(url.href),
        replaceHistory: replaceHistory,
        transientHash: transientHash,
        restoreScroll: restoreScroll,
        destinationState: destinationState,
        hasDestinationState: !!hasDestinationState,
        freshReplace: !!freshReplace
      };
      // The address bar changes before popstate fires. Do not leave a Back or
      // Forward destination queued behind an earlier page's fetch, hydration,
      // or exit-delay timer: stop awaiting that work and drain the newest
      // request immediately. The underlying promise may still settle, but its
      // stale continuation can no longer swap the document.
      if (activeNavigation) activeNavigation.cancel();
      return;
    }
    navInFlight = true;
    var navigation = makeNavigationAttempt();
    activeNavigation = navigation;

    var expectedPageStyles = [];
    var ownsTransientEntry = false;
    var committedHistoryUrl = null;
    var committedHistoryEntryId = null;
    var didSwapMain = false;
    var fallbackStarted = false;
    var departingMain = document.querySelector("main.page-content");
    dispatchMainLifecycle("vgmos:beforemainchange", departingMain);
    if (activePageScope) activePageScope.destroy();
    if (departingMain) {
      departingMain.setAttribute("inert", "");
      departingMain.inert = true;
    }

    navigation.race(fetchDocument(url)).then(function (doc) {
      if (pendingNavigation) return Promise.reject(navigationSuperseded);
      if (pageNeedsNormalLoad(doc)) {
        fallbackStarted = true;
        fallbackNavigate(url, !replaceHistory);
        return Promise.reject(navigationFallback);
      }

      return navigation.race(preparePageStyles(doc)).then(function (styles) {
        if (pendingNavigation) return Promise.reject(navigationSuperseded);
        expectedPageStyles = styles;
        var currentMain = document.querySelector("main.page-content");
        var exitLayer = makeExitLayer(currentMain);
        root.classList.add("is-content-entering");

        var main = completeNavigation(
          url,
          doc,
          replaceHistory,
          transientHash,
          restoreScroll,
          destinationState,
          !!hasDestinationState,
          !!freshReplace
        );
        if (!main) {
          fallbackStarted = true;
          fallbackNavigate(url, !replaceHistory);
          return Promise.reject(navigationFallback);
        }
        didSwapMain = true;
        ownsTransientEntry = !replaceHistory || !!freshReplace;
        if (ownsTransientEntry) {
          committedHistoryUrl = window.location.href;
          committedHistoryEntryId = history.state && history.state.softEntryId;
        }

        return navigation.race(hydratePage(doc, main)).then(function () {
          if (main) void main.offsetWidth;

          root.classList.remove("is-content-entering");
          if (exitLayer) {
            void exitLayer.offsetWidth;
            exitLayer.classList.add("is-fading");
            window.setTimeout(function () {
              if (exitLayer.parentNode) exitLayer.parentNode.removeChild(exitLayer);
            }, contentTransitionMs + 80);
          }

          return navigation.race(delay(contentTransitionMs + 80)).then(function () {
            finalizePageStyles(expectedPageStyles);
            if (restoreScroll) {
              scrollToPosition(restoreScroll);
              saveCurrentScroll();
            }
            if (!pendingNavigation && main && main.isConnected) {
              main.inert = false;
              main.removeAttribute("inert");
              focusMain(main);
            }
          });
        });
      });
    }).catch(function (error) {
      root.classList.remove("is-content-entering");
      Array.prototype.slice.call(document.querySelectorAll(".page-exit-layer")).forEach(function (layer) {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      });
      if (error !== navigationFallback && error !== navigationSuperseded) {
        if (pendingNavigation) error = navigationSuperseded;
        else {
          fallbackStarted = true;
          fallbackNavigate(url, !replaceHistory);
        }
      }
    }).then(function () {
      if (activeNavigation === navigation) activeNavigation = null;
      navInFlight = false;
      if (fallbackStarted) {
        pendingNavigation = null;
        return;
      }
      if (pendingNavigation) {
        var nextNavigation = pendingNavigation;
        pendingNavigation = null;
        var currentHistoryState = history.state;
        var stillOnCommittedEntry = ownsTransientEntry &&
          window.location.href === committedHistoryUrl &&
          currentHistoryState &&
          currentHistoryState.softEntryId === committedHistoryEntryId;
        if (stillOnCommittedEntry && !nextNavigation.replaceHistory) {
          nextNavigation.replaceHistory = true;
          nextNavigation.freshReplace = true;
          nextNavigation.destinationState = null;
          nextNavigation.hasDestinationState = false;
        }
        softNavigate(
          nextNavigation.url,
          nextNavigation.replaceHistory,
          nextNavigation.transientHash,
          nextNavigation.restoreScroll,
          nextNavigation.destinationState,
          nextNavigation.hasDestinationState,
          nextNavigation.freshReplace
        );
      } else if (!didSwapMain && departingMain && departingMain.isConnected) {
        departingMain.inert = false;
        departingMain.removeAttribute("inert");
      }
    });
  }

  window.vgmosNavigation = {
    navigate: function (href, options) {
      var url;
      try {
        url = new URL(href, window.location.href);
      } catch (error) {
        return false;
      }

      if (url.origin !== window.location.origin ||
          (url.protocol !== "http:" && url.protocol !== "https:")) {
        window.location.assign(url.href);
        return false;
      }
      if (fallbackNavigationTimer) {
        fallbackNavigate(url, false);
        return true;
      }
      if (url.href === window.location.href) return true;
      if (reduce) {
        window.location.assign(url.href);
        return true;
      }

      flushScrollSave();
      softNavigate(url, !!(options && options.replace), false, null);
      return true;
    }
  };

  function prefetchLink(a) {
    var url = transitionableLink(a, { defaultPrevented: false, button: 0 });
    if (!url) return;
    if (navigator.connection && navigator.connection.saveData) return;
    fetchDocument(url).catch(function () {});
  }

  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    var url = transitionableLink(a, event);
    if (!url) return;

    event.preventDefault();
    if (fallbackNavigationTimer) {
      fallbackNavigate(url, false);
      return;
    }
    flushScrollSave();
    softNavigate(url, false, a.hasAttribute("data-scroll"));
  });

  document.addEventListener("pointerenter", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (a) prefetchLink(a, event);
  }, true);
  document.addEventListener("focusin", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (a) prefetchLink(a, { defaultPrevented: false, button: 0 });
  });
  document.addEventListener("touchstart", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (a) prefetchLink(a, { defaultPrevented: false, button: 0 });
  }, { passive: true });

  window.addEventListener("popstate", function (event) {
    var destinationState = copyState(event.state);
    softNavigate(
      new URL(window.location.href),
      true,
      false,
      scrollFromState(destinationState),
      destinationState,
      true,
      false
    );
  });

  syncCurrentFromLocation(false);
  setupScrollSpy();
})();
