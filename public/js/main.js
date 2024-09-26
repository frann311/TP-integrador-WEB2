const d = document;
const imgs = d.getElementsByClassName("image");

d.addEventListener("DOMContentLoaded", (e) => {
  for (let img of imgs) {
    img.addEventListener("mouseover", (e) => {
      const dateElement = e.target.closest(".card").querySelector(".date"); // Encuentra el elemento de fecha correspondiente
      if (dateElement) {
        dateElement.classList.remove("none");
        dateElement.classList.add("active");
      }
    });

    img.addEventListener("mouseleave", (e) => {
      const dateElement = e.target.closest(".card").querySelector(".date"); // Encuentra el elemento de fecha correspondiente
      if (dateElement) {
        dateElement.classList.remove("active");
        dateElement.classList.add("none");
      }
    });
  }
});
