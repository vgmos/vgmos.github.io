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
  var navInFlight = false;
  var prefetched = {};
  root.classList.add("js-on");

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

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
    if (doc.querySelector("main.page-content script")) return true;
    if (doc.querySelector("link[href*='katex'], script[src*='katex']")) return true;
    return false;
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

  function completeNavigation(url, doc, replaceHistory, transientHash) {
    var nextMain = doc.querySelector("main.page-content");
    var currentMain = document.querySelector("main.page-content");
    var historyUrl = transientHash && url.hash ? urlWithoutHash(url) : url.href;

    if (!nextMain || !currentMain) {
      fallbackNavigate(url);
      return false;
    }

    syncHead(doc);
    currentMain.replaceWith(nextMain.cloneNode(true));
    if (replaceHistory) {
      history.replaceState({ soft: true }, "", historyUrl);
    } else {
      history.pushState({ soft: true }, "", historyUrl);
    }

    setupScrollSpy();
    syncCurrentFromLocation(false);
    closeMobileNav();

    if (url.hash) {
      if (scrollToHash(url.hash, false) && transientHash) {
        setCurrent(navLinks.filter(function (a) { return hashOf(a) === url.hash.replace(/^#/, ""); })[0] || current, false);
      }
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    focusMain(document.querySelector("main.page-content"));
    return true;
  }

  function softNavigate(url, replaceHistory, transientHash) {
    if (navInFlight) return;
    navInFlight = true;

    fetchDocument(url).then(function (doc) {
      if (pageNeedsNormalLoad(doc)) {
        fallbackNavigate(url);
        return Promise.reject("fallback");
      }

      var exitLayer = makeExitLayer(document.querySelector("main.page-content"));
      root.classList.add("is-content-entering");

      if (!completeNavigation(url, doc, replaceHistory, transientHash)) {
        return Promise.reject("fallback");
      }

      var main = document.querySelector("main.page-content");
      if (main) void main.offsetWidth;

      root.classList.remove("is-content-entering");
      if (exitLayer) {
        void exitLayer.offsetWidth;
        exitLayer.classList.add("is-fading");
        window.setTimeout(function () {
          if (exitLayer.parentNode) exitLayer.parentNode.removeChild(exitLayer);
        }, contentTransitionMs + 80);
      }

      return delay(contentTransitionMs + 80);
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

  window.addEventListener("popstate", function () {
    softNavigate(new URL(window.location.href), true, false);
  });

  syncCurrentFromLocation(false);
  setupScrollSpy();
})();
