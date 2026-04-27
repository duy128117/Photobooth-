import { initializeTheme } from "./modules/theme.js";

initializeTheme(document.getElementById("theme-toggle"));

const cursor = document.getElementById("cursor");
const ring = document.getElementById("cursorRing");

if (window.matchMedia("(pointer: fine)").matches && cursor && ring) {
  let mouseX = 0;
  let mouseY = 0;
  let ringX = 0;
  let ringY = 0;

  document.addEventListener("mousemove", function (event) {
    mouseX = event.clientX;
    mouseY = event.clientY;
    cursor.style.transform = `translate(${mouseX - 5}px, ${mouseY - 5}px)`;
  });

  function animateRing() {
    ringX += (mouseX - ringX) * 0.12;
    ringY += (mouseY - ringY) * 0.12;
    ring.style.transform = `translate(${ringX - 18}px, ${ringY - 18}px)`;
    window.requestAnimationFrame(animateRing);
  }

  animateRing();

  document.querySelectorAll("a, button").forEach(function (element) {
    element.addEventListener("mouseenter", function () {
      ring.style.width = "52px";
      ring.style.height = "52px";
    });

    element.addEventListener("mouseleave", function () {
      ring.style.width = "36px";
      ring.style.height = "36px";
    });
  });
}
