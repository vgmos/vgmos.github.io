// Figure inspection is remounted after soft navigation and leaves static images usable without JavaScript.
(function () {
  "use strict";

  var root = document.documentElement;
  var activeMount = null;
  var inspector = createInspectorController();

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

    var viewport = dialog.querySelector("[data-figure-inspector-viewport]");
    var caption = dialog.querySelector("[data-figure-inspector-caption]");
    var closeButton = dialog.querySelector("[data-figure-inspector-close]");
    var sourceTrigger = null;
    var scrollY = 0;

    function focusElement(element) {
      if (!element || !element.isConnected) return;
      try { element.focus({ preventScroll: true }); }
      catch (error) { element.focus(); }
    }

    function open(trigger) {
      if (!trigger || dialog.open) return;
      var image = trigger.querySelector("img");
      if (!image) return;
      sourceTrigger = trigger;
      scrollY = window.pageYOffset || 0;
      var copy = image.cloneNode(false);
      copy.removeAttribute("id");
      copy.removeAttribute("loading");
      copy.className = "figure-inspector__image";
      copy.setAttribute("data-figure-inspector-image", "");
      viewport.replaceChildren(copy);
      var sourceCaption = trigger.closest(".source-figure").querySelector("figcaption");
      caption.replaceChildren();
      if (sourceCaption) Array.prototype.forEach.call(sourceCaption.childNodes, function (node) {
        caption.appendChild(node.cloneNode(true));
      });
      root.classList.add("has-modal-dialog");
      try { dialog.showModal(); }
      catch (error) {
        root.classList.remove("has-modal-dialog");
        viewport.replaceChildren();
        caption.replaceChildren();
        sourceTrigger = null;
        return;
      }
      dialog.setAttribute("data-figure-inspector-state", "open");
      focusElement(closeButton);
    }

    function close(restoreFocus) {
      if (!dialog.open) return;
      var trigger = sourceTrigger;
      dialog.close();
      dialog.setAttribute("data-figure-inspector-state", "closed");
      root.classList.remove("has-modal-dialog");
      viewport.replaceChildren();
      caption.replaceChildren();
      sourceTrigger = null;
      window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
      if (restoreFocus) focusElement(trigger && trigger.isConnected ? trigger : document.querySelector("main.page-content"));
    }

    closeButton.addEventListener("click", function () { close(true); });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      close(true);
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
      if (event.target === dialog) close(true);
    });

    return {
      dialog: dialog,
      open: open,
      close: close
    };
  }

  function unmountMain(closeDialog) {
    if (!activeMount) {
      if (closeDialog && inspector) inspector.close(false);
      return;
    }

    activeMount.controller.abort();
    activeMount = null;
    if (closeDialog && inspector) inspector.close(false);
  }

  function mountMain(main) {
    if (!main) return;
    unmountMain(false);

    var mount = {
      controller: new AbortController()
    };
    activeMount = mount;
    enhanceFigures(main, mount);
    // WebKit does not consistently scroll a focused overflow region with arrow keys.
    main.addEventListener("keydown", function (event) {
      if (!event.target.matches(".project-table") || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.target.scrollLeft += event.key === "ArrowRight" ? 48 : -48;
    }, { signal: mount.controller.signal });
  }

  document.addEventListener("vgmos:beforemainchange", function () {
    unmountMain(true);
  });

  document.addEventListener("vgmos:mainchange", function (event) {
    mountMain(event.detail && event.detail.main
      ? event.detail.main
      : document.querySelector("main.page-content"));
  });

  mountMain(document.querySelector("main.page-content"));
}());
