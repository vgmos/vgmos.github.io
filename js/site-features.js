/* =====================================================================
   site-features.js — restrained, progressive motion for editorial pages
     1. one-time homepage row choreography
     2. a finite buck-converter signal trace
     3. an accessible native-dialog figure inspector

   Every feature keeps a complete static/no-JavaScript presentation and is
   remounted when ui.js swaps the main content during soft navigation.
   ===================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  var motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  var activeMount = null;
  var homeSignalPlayed = false;
  var inspector = createInspectorController();

  function motionAllowed() {
    return !motionQuery.matches && typeof Element.prototype.animate === "function";
  }

  function animationFinished(animations, callback) {
    Promise.allSettled(animations.map(function (animation) { return animation.finished; }))
      .then(callback)
      .catch(callback);
  }

  function setRevealState(item, state, delay) {
    item.setAttribute("data-reveal-state", state);
    item.style.setProperty("--reveal-delay", state === "visible" ? (delay || 0) + "ms" : "0ms");
  }

  function mountReveals(main, mount) {
    var shell = main.querySelector(".home-shell");
    if (!shell) return;

    var items = Array.prototype.slice.call(shell.querySelectorAll("[data-reveal]"));
    if (!items.length) return;

    shell.classList.add("has-reveal-motion");

    function reveal(item, delay) {
      if (!item || item.getAttribute("data-reveal-state") === "visible") return;
      setRevealState(item, "visible", delay || 0);
      if (mount.revealObserver) mount.revealObserver.unobserve(item);
    }

    mount.revealAll = function () {
      items.forEach(function (item) { reveal(item, 0); });
    };

    if (motionQuery.matches || !("IntersectionObserver" in window)) {
      mount.revealAll();
      return;
    }

    items.forEach(function (item) { setRevealState(item, "pending", 0); });

    mount.revealObserver = new IntersectionObserver(function (entries) {
      var entering = entries.filter(function (entry) { return entry.isIntersecting; });
      entering.sort(function (left, right) {
        return items.indexOf(left.target) - items.indexOf(right.target);
      });
      entering.forEach(function (entry, index) {
        reveal(entry.target, Math.min(index, 3) * 45);
      });
    }, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08
    });

    items.forEach(function (item) { mount.revealObserver.observe(item); });
    main.addEventListener("focusin", function (event) {
      var item = event.target && event.target.closest
        ? event.target.closest("[data-reveal]")
        : null;
      if (item && shell.contains(item)) reveal(item, 0);
    }, { signal: mount.controller.signal });
  }

  function mountSignal(main, mount) {
    var svg = main.querySelector("[data-signal-path]");
    if (!svg) return;

    var pulse = svg.querySelector("[data-signal-path-pulse]");
    var wave = svg.querySelector("[data-signal-path-wave]");
    var animations = [];
    var settled = false;

    function settle() {
      if (settled) return;
      settled = true;
      animations.forEach(function (animation) { animation.cancel(); });
      animations = [];
      svg.setAttribute("data-signal-path-state", "complete");
    }

    mount.settleSignal = settle;
    homeSignalPlayed = true;

    if (!pulse || !wave || !motionAllowed() || mount.signalWasAlreadyPlayed) {
      settle();
      return;
    }

    svg.setAttribute("data-signal-path-state", "running");
    animations = [
      pulse.animate([
        { strokeDashoffset: "100", opacity: 0, offset: 0 },
        { strokeDashoffset: "92", opacity: 1, offset: 0.12 },
        { strokeDashoffset: "12", opacity: 1, offset: 0.78 },
        { strokeDashoffset: "0", opacity: 0, offset: 1 }
      ], {
        duration: 920,
        easing: "cubic-bezier(0.45, 0, 0.4, 1)",
        fill: "both",
        iterations: 1
      }),
      wave.animate([
        { strokeDashoffset: "1", opacity: 0 },
        { strokeDashoffset: "0", opacity: 0.88 }
      ], {
        duration: 450,
        delay: 540,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
        iterations: 1
      })
    ];

    animationFinished(animations, settle);
  }

  function figureName(figure, image) {
    var captionLead = figure.querySelector("figcaption strong, figcaption b");
    var label = captionLead ? captionLead.textContent.trim() : "";
    if (!label) label = (image.getAttribute("alt") || "technical figure").trim();
    return label.replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  }

  function enhanceFigures(main, mount) {
    if (!inspector || typeof inspector.dialog.showModal !== "function") return;

    var frames = Array.prototype.slice.call(
      main.querySelectorAll(".project-body .source-figure > .source-figure__frame")
    );

    frames.forEach(function (frame) {
      if (frame.hasAttribute("data-figure-inspector-ready")) return;
      var image = frame.querySelector(":scope > img");
      if (!image) return;

      var figure = frame.closest(".source-figure");
      var trigger = document.createElement("button");
      var hint = document.createElement("span");

      trigger.type = "button";
      trigger.className = "figure-inspect";
      trigger.setAttribute("data-figure-inspect", "");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-controls", inspector.dialog.id);
      trigger.setAttribute("aria-label", "Inspect figure: " + figureName(figure, image));

      hint.className = "figure-inspect__hint";
      hint.setAttribute("aria-hidden", "true");
      hint.innerHTML = "<svg viewBox=\"0 0 20 20\" focusable=\"false\"><path d=\"M8 3H3v5M12 3h5v5M17 12v5h-5M8 17H3v-5\"/></svg>";

      frame.insertBefore(trigger, image);
      trigger.appendChild(image);
      trigger.appendChild(hint);
      frame.setAttribute("data-figure-inspector-ready", "");
    });

    main.addEventListener("click", function (event) {
      var trigger = event.target && event.target.closest
        ? event.target.closest("[data-figure-inspect]")
        : null;
      if (!trigger || !main.contains(trigger)) return;
      inspector.open(trigger);
    }, { signal: mount.controller.signal });
  }

  function createInspectorController() {
    var dialog = document.querySelector("[data-figure-inspector]");
    if (!dialog || !window.HTMLDialogElement) return null;

    var panel = dialog.querySelector("[data-figure-inspector-panel]");
    var viewport = dialog.querySelector("[data-figure-inspector-viewport]");
    var caption = dialog.querySelector("[data-figure-inspector-caption]");
    var closeButton = dialog.querySelector("[data-figure-inspector-close]");
    var sourceTrigger = null;
    var sourceImage = null;
    var dialogImage = null;
    var flight = null;
    var animations = [];
    var scrollY = 0;
    var motionToken = 0;
    var isClosing = false;

    function usableRect(rect) {
      return rect && rect.width > 1 && rect.height > 1;
    }

    function clearContent() {
      while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
      while (caption.firstChild) caption.removeChild(caption.firstChild);
      dialogImage = null;
    }

    function cancelMotion() {
      motionToken += 1;
      animations.forEach(function (animation) { animation.cancel(); });
      animations = [];
      if (flight && flight.parentNode) flight.parentNode.removeChild(flight);
      flight = null;
      if (dialogImage) dialogImage.style.visibility = "";
      panel.style.opacity = "";
      panel.style.transform = "";
    }

    function copyCaption(trigger) {
      var sourceCaption = trigger.closest(".source-figure").querySelector("figcaption");
      if (!sourceCaption) return;
      Array.prototype.slice.call(sourceCaption.childNodes).forEach(function (node) {
        caption.appendChild(node.cloneNode(true));
      });
    }

    function makeDialogImage(image) {
      var clone = image.cloneNode(false);
      clone.removeAttribute("id");
      clone.removeAttribute("loading");
      clone.className = "figure-inspector__image";
      clone.setAttribute("data-figure-inspector-image", "");
      clone.setAttribute("decoding", "async");
      return clone;
    }

    function makeFlight(image, rect) {
      var clone = image.cloneNode(false);
      clone.removeAttribute("id");
      clone.removeAttribute("loading");
      clone.removeAttribute("data-figure-inspector-image");
      clone.className = "figure-inspector__flight";
      if (image.currentSrc) clone.src = image.currentSrc;
      clone.style.left = rect.left + "px";
      clone.style.top = rect.top + "px";
      clone.style.width = rect.width + "px";
      clone.style.height = rect.height + "px";
      dialog.appendChild(clone);
      return clone;
    }

    function animateFlight(image, fromRect, toRect, duration) {
      var dx = toRect.left - fromRect.left;
      var dy = toRect.top - fromRect.top;
      var scaleX = toRect.width / fromRect.width;
      var scaleY = toRect.height / fromRect.height;
      return image.animate([
        { transform: "translate3d(0, 0, 0) scale(1, 1)", opacity: 0.96 },
        { transform: "translate3d(" + dx + "px, " + dy + "px, 0) scale(" + scaleX + ", " + scaleY + ")", opacity: 1 }
      ], {
        duration: duration,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
        iterations: 1
      });
    }

    function focusElement(element) {
      if (!element || !element.isConnected) return;
      try {
        element.focus({ preventScroll: true });
      } catch (error) {
        element.focus();
      }
    }

    function finishOpen(token) {
      if (token !== motionToken || !dialog.open) return;
      cancelMotion();
      dialog.setAttribute("data-figure-inspector-state", "open");
    }

    function open(trigger) {
      if (!trigger || dialog.open) return;
      var image = trigger.querySelector("img");
      if (!image) return;

      cancelMotion();
      clearContent();
      sourceTrigger = trigger;
      sourceImage = image;
      scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      isClosing = false;

      var sourceRect = image.getBoundingClientRect();
      dialogImage = makeDialogImage(image);
      viewport.appendChild(dialogImage);
      copyCaption(trigger);
      root.classList.add("has-modal-dialog");

      try {
        dialog.showModal();
      } catch (error) {
        root.classList.remove("has-modal-dialog");
        clearContent();
        return;
      }

      dialog.setAttribute("data-figure-inspector-state", "opening");
      focusElement(closeButton);

      var destinationRect = dialogImage.getBoundingClientRect();
      if (!motionAllowed() || !usableRect(sourceRect) || !usableRect(destinationRect)) {
        dialog.setAttribute("data-figure-inspector-state", "open");
        return;
      }

      flight = makeFlight(image, sourceRect);
      dialogImage.style.visibility = "hidden";
      var token = ++motionToken;
      animations = [
        animateFlight(flight, sourceRect, destinationRect, 320),
        panel.animate([
          { opacity: 0.32, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" }
        ], {
          duration: 250,
          delay: 55,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "both",
          iterations: 1
        })
      ];
      animationFinished(animations, function () { finishOpen(token); });
    }

    function finishClose(restoreFocus) {
      var trigger = sourceTrigger;
      cancelMotion();
      if (dialog.open) dialog.close();
      dialog.setAttribute("data-figure-inspector-state", "closed");
      root.classList.remove("has-modal-dialog");
      isClosing = false;
      clearContent();
      sourceImage = null;
      sourceTrigger = null;
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });

      if (restoreFocus) {
        if (trigger && trigger.isConnected) focusElement(trigger);
        else focusElement(document.querySelector("main.page-content"));
      }
    }

    function close(restoreFocus, animate) {
      if (!dialog.open) return;
      if (isClosing) {
        if (animate === false) finishClose(restoreFocus);
        return;
      }
      cancelMotion();
      isClosing = true;
      dialog.setAttribute("data-figure-inspector-state", "closing");

      var fromRect = dialogImage && dialogImage.getBoundingClientRect();
      var toRect = sourceImage && sourceImage.isConnected
        ? sourceImage.getBoundingClientRect()
        : null;

      if (animate === false || !motionAllowed() || !dialogImage || !usableRect(fromRect) || !usableRect(toRect)) {
        finishClose(restoreFocus);
        return;
      }

      flight = makeFlight(dialogImage, fromRect);
      dialogImage.style.visibility = "hidden";
      var token = ++motionToken;
      animations = [
        animateFlight(flight, fromRect, toRect, 240),
        panel.animate([
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0.22, transform: "translateY(4px)" }
        ], {
          duration: 190,
          easing: "cubic-bezier(0.5, 0, 1, 1)",
          fill: "both",
          iterations: 1
        })
      ];

      animationFinished(animations, function () {
        if (token === motionToken && dialog.open) finishClose(restoreFocus);
      });
    }

    closeButton.addEventListener("click", function () { close(true, true); });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      close(true, true);
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key !== "Tab" || !dialog.open) return;
      var focusable = Array.prototype.slice.call(dialog.querySelectorAll(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
      )).filter(function (element) {
        return element.getClientRects().length > 0 && !element.hasAttribute("inert");
      });
      if (!focusable.length) return;

      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        focusElement(first);
      }
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) close(true, true);
    });

    return {
      dialog: dialog,
      open: open,
      close: close,
      settleMotion: function () {
        if (!dialog.open) return;
        if (isClosing) finishClose(true);
        else {
          cancelMotion();
          dialog.setAttribute("data-figure-inspector-state", "open");
        }
      }
    };
  }

  function unmountMain(closeDialog) {
    if (!activeMount) {
      if (closeDialog && inspector) inspector.close(false, false);
      return;
    }

    if (activeMount.revealAll) activeMount.revealAll();
    if (activeMount.revealObserver) activeMount.revealObserver.disconnect();
    if (activeMount.settleSignal) activeMount.settleSignal();
    activeMount.controller.abort();
    activeMount = null;
    if (closeDialog && inspector) inspector.close(false, false);
  }

  function mountMain(main) {
    if (!main) return;
    unmountMain(false);

    var mount = {
      controller: new AbortController(),
      revealObserver: null,
      revealAll: null,
      settleSignal: null,
      signalWasAlreadyPlayed: homeSignalPlayed
    };
    activeMount = mount;
    mountReveals(main, mount);
    mountSignal(main, mount);
    enhanceFigures(main, mount);
  }

  document.addEventListener("vgmos:beforemainchange", function () {
    unmountMain(true);
  });

  document.addEventListener("vgmos:mainchange", function (event) {
    mountMain(event.detail && event.detail.main
      ? event.detail.main
      : document.querySelector("main.page-content"));
  });

  var settleForReducedMotion = function (event) {
    if (!event.matches) return;
    if (activeMount && activeMount.revealAll) activeMount.revealAll();
    if (activeMount && activeMount.settleSignal) activeMount.settleSignal();
    if (inspector) inspector.settleMotion();
  };

  if (motionQuery.addEventListener) motionQuery.addEventListener("change", settleForReducedMotion);
  else if (motionQuery.addListener) motionQuery.addListener(settleForReducedMotion);

  mountMain(document.querySelector("main.page-content"));
}());
