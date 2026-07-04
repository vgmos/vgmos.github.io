/* =====================================================================
   ui.js — single-page hub behaviour for vgmos.github.io
     1. sliding nav underline (desktop) driven by scroll position + hover
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
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var desktop = window.matchMedia("(min-width: 601px)");
  var pageTransitionKey = "vgmos-page-transition";
  var pageTransitionOutMs = 70;
  var pageTransitionInMs = 110;
  var contentTransitionMs = 240;
  var mathDelimiters = [
    { left: "$$", right: "$$", display: true },
    { left: "\\(", right: "\\)", display: false }
  ];
  var navInFlight = false;
  var prefetched = {};
  var scrollSaveTimer = 0;
  root.classList.add("js-on");

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
    }, 120);
  }

  function flushScrollSave() {
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = 0;
    }
    saveCurrentScroll();
  }

  saveCurrentScroll();

  window.addEventListener("scroll", scheduleScrollSave, { passive: true });
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
    if (!link || !desktop.matches) { underline.style.width = "0"; return; }
    if (!animate) underline.style.transition = "none";
    underline.style.width = link.offsetWidth + "px";
    underline.style.transform = "translateX(" + link.offsetLeft + "px)";
    if (!animate) { void underline.offsetWidth; underline.style.transition = ""; }
  }

  function setCurrent(link, animate) {
    current = link;
    navLinks.forEach(function (a) { a.classList.toggle("page-link--active", a === link); });
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

  function urlWithoutHash(url) {
    return url.pathname + url.search;
  }

  function clearHashFromAddress() {
    if (!history.replaceState || !window.location.hash) return;
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
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
    scrollToHash(id, true);
    clearHashFromAddress();
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

  function renderMath(main) {
    if (typeof window.renderMathInElement !== "function") return;
    try {
      window.renderMathInElement(main || document.body, {
        delimiters: mathDelimiters,
        throwOnError: false
      });
    } catch (error) {}
  }

  function runMainScripts(main) {
    if (!main) return;
    Array.prototype.slice.call(main.querySelectorAll("script")).forEach(function (oldScript) {
      var next = document.createElement("script");
      copyAttributes(oldScript, next);
      next.text = oldScript.text || oldScript.textContent || "";
      oldScript.replaceWith(next);
    });
  }

  function hydratePage(doc, main) {
    runMainScripts(main);
    return ensureMathAssets(doc).then(function () {
      renderMath(main);
    }).catch(function () {
      renderMath(main);
    });
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

  function fallbackNavigate(url) {
    flushScrollSave();
    try {
      sessionStorage.setItem(pageTransitionKey, "1");
    } catch (error) {}
    root.classList.add("is-transitioning-out");
    window.setTimeout(function () { window.location.href = url.href; }, pageTransitionOutMs);
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

  function makeExitLayer(main) {
    if (!main) return null;

    var rect = main.getBoundingClientRect();
    var layer = document.createElement("div");
    var clone = main.cloneNode(true);

    layer.className = "page-exit-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.style.top = rect.top + "px";
    layer.style.left = rect.left + "px";
    layer.style.width = rect.width + "px";
    layer.style.height = rect.height + "px";

    clone.removeAttribute("tabindex");
    layer.appendChild(clone);
    document.body.appendChild(layer);

    return layer;
  }

  function completeNavigation(url, doc, replaceHistory, transientHash, restoreScroll) {
    var nextMain = doc.querySelector("main.page-content");
    var currentMain = document.querySelector("main.page-content");
    var historyUrl = transientHash && url.hash ? urlWithoutHash(url) : url.href;
    var nextScroll = restoreScroll || { x: 0, y: 0 };

    if (!nextMain || !currentMain) {
      fallbackNavigate(url);
      return false;
    }

    syncHead(doc);
    currentMain.replaceWith(nextMain.cloneNode(true));
    if (replaceHistory) {
      history.replaceState(makeHistoryState(history.state, nextScroll), "", historyUrl);
    } else {
      history.pushState(makeHistoryState(null, nextScroll), "", historyUrl);
    }

    setupScrollSpy();
    syncCurrentFromLocation(false);
    closeMobileNav();
    focusMain(document.querySelector("main.page-content"));

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
    return true;
  }

  function softNavigate(url, replaceHistory, transientHash, restoreScroll) {
    if (navInFlight) return;
    navInFlight = true;

    fetchDocument(url).then(function (doc) {
      if (pageNeedsNormalLoad(doc)) {
        fallbackNavigate(url);
        return Promise.reject("fallback");
      }

      var exitLayer = makeExitLayer(document.querySelector("main.page-content"));
      root.classList.add("is-content-entering");

      if (!completeNavigation(url, doc, replaceHistory, transientHash, restoreScroll)) {
        return Promise.reject("fallback");
      }

      var main = document.querySelector("main.page-content");
      return hydratePage(doc, main).then(function () {
        if (main) void main.offsetWidth;

        root.classList.remove("is-content-entering");
        if (exitLayer) {
          void exitLayer.offsetWidth;
          exitLayer.classList.add("is-fading");
          window.setTimeout(function () {
            if (exitLayer.parentNode) exitLayer.parentNode.removeChild(exitLayer);
          }, contentTransitionMs + 80);
        }

        return delay(contentTransitionMs + 80).then(function () {
          if (restoreScroll) {
            scrollToPosition(restoreScroll);
            saveCurrentScroll();
          }
        });
      });
    }).catch(function (error) {
      root.classList.remove("is-content-entering");
      Array.prototype.slice.call(document.querySelectorAll(".page-exit-layer")).forEach(function (layer) {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      });
      if (error !== "fallback") fallbackNavigate(url);
    }).then(function () {
      navInFlight = false;
    });
  }

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
    softNavigate(new URL(window.location.href), true, false, scrollFromState(event.state));
  });

  syncCurrentFromLocation(false);
  setupScrollSpy();
})();
