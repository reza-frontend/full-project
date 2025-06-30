let menu__list = document.querySelector(".menu__list");
let icon = document.querySelector(".header_icon img");

let isMenuOpen = false;

icon.addEventListener("click", function () {
  if (isMenuOpen) {
    menu__list.style.left = "-223px";
  } else {
    menu__list.style.left = "0";
  }
  isMenuOpen = !isMenuOpen;
});
