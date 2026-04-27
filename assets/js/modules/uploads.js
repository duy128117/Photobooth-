import { photoboothState, updateState } from "./state.js";
import { createAutoCroppedImageItem } from "./auto-crop.js";

export function initializeUploads(elements, showToast) {
  const captureGallery = elements.captureGallery;
  const uploadGallery = elements.uploadGallery;

  captureGallery.addEventListener("click", handleGridAction);
  uploadGallery.addEventListener("click", handleGridAction);
  uploadGallery.addEventListener("change", handleInputChange);

  function handleGridAction(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    const index = Number(actionButton.getAttribute("data-index"));
    const action = actionButton.getAttribute("data-action");

    if (action === "replace") {
      const input = document.getElementById("upload-input-" + index);
      if (input) {
        input.click();
      }
      return;
    }

    if (action === "delete") {
      updateState(function (state) {
        state.images[index] = null;
        state.stickers = [];
      });
      showToast("Đã xóa ảnh ở ô " + (index + 1) + ".");
    }
  }

  function handleInputChange(event) {
    const target = event.target;
    if (!target.matches("input[type='file']")) {
      return;
    }

    const index = Number(target.getAttribute("data-index"));
    const file = target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async function (loadEvent) {
      const imageItem = await createAutoCroppedImageItem(loadEvent.target.result);
      updateState(function (state) {
        state.images[index] = imageItem;
      });
      showToast("Đã thêm ảnh vào ô " + (index + 1) + ".");
    };
    reader.readAsDataURL(file);
  }
}

export function buildGridCards(container, mode) {
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < photoboothState.imageCount; index += 1) {
    fragment.appendChild(createCard(index, mode));
  }

  container.innerHTML = "";
  container.appendChild(fragment);
}

function createCard(index, mode) {
  const isUpload = mode === "upload";
  const card = document.createElement(isUpload ? "label" : "article");
  const preview = document.createElement("div");
  const actions = document.createElement("div");
  const image = photoboothState.images[index];

  card.className = isUpload ? "upload-card" : "image-card";
  if (isUpload) {
    card.setAttribute("for", "upload-input-" + index);
  }

  preview.className = isUpload ? "upload-card__preview" : "image-card__preview";
  preview.innerHTML = image && image.src
    ? '<img src="' + image.src + '" alt="Ảnh đã chọn ' + (index + 1) + '" />'
    : '<div class="' + (isUpload ? "upload-card__placeholder" : "image-card__placeholder") + '">Ô ' + (index + 1) + '<br />Thêm hoặc thay ảnh</div>';

  actions.className = isUpload ? "upload-card__actions" : "image-card__actions";
  actions.innerHTML = isUpload
    ? [
        '<button class="button button-secondary" type="button" data-action="replace" data-index="' + index + '">Thay ảnh</button>',
        '<button class="button button-secondary" type="button" data-action="delete" data-index="' + index + '">Xóa</button>'
      ].join("")
    : '<button class="button button-secondary" type="button" data-action="delete" data-index="' + index + '">Xóa</button>';

  card.appendChild(preview);
  card.appendChild(actions);

  if (isUpload) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.id = "upload-input-" + index;
    input.setAttribute("data-index", index);
    card.appendChild(input);
  }

  return card;
}
