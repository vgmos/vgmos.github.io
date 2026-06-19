/* =====================================================================
   ui.js — single-page hub behaviour for vgmos.github.io
     1. sliding nav underline (desktop) driven by scroll position + hover
     2. smooth in-page scrolling for nav + hero anchors (with header offset)
     3. scroll-spy: the underline follows the section you're reading
     4. one-time "rise + fade" reveals as content scrolls in
   Degrades cleanly: content is only hidden once `.js-on` is set, in-page
   links fall back to normal navigation off the homepage, and
   prefers-reduced-motion is fully respected.
   ===================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var desktop = window.matchMedia("(min-width: 601px)");
  root.classList.add("js-on");

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

  /* ---------------------------- smooth scroll for any in-page anchor link */
  Array.prototype.slice.call(document.querySelectorAll("[data-scroll]")).forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = hashOf(a);
      var target = id && document.getElementById(id);
      if (!target) return; // section isn't on this page → let it navigate to /#id
      e.preventDefault();
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      if (history.pushState) history.pushState(null, "", "#" + id);
      var toggle = document.getElementById("nav-trigger"); // close the mobile menu
      if (toggle) toggle.checked = false;
    });
  });

  /* ------------------------------------- scroll-spy → drives the underline */
  var spyLinks = navLinks.filter(function (a) {
    return a.hasAttribute("data-scroll") && document.getElementById(hashOf(a));
  });
  var linkFor = {};
  spyLinks.forEach(function (a) { linkFor[hashOf(a)] = a; });
  var sections = spyLinks.map(function (a) { return document.getElementById(hashOf(a)); });

  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var link = linkFor[en.target.id];
          if (link && link !== current) setCurrent(link, !reduce);
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ------------------------------------------------------------- reveals */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("is-visible");
          ro.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { ro.observe(el); });
  }
})();
