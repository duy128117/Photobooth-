import { LAYOUTS, photoboothState, updateState } from "./state.js";
import { STICKER_LIBRARY } from "./stickers.js";

export function initializeEditor(elements, stickersApi, showToast) {
  const photostrip = elements.photostrip;
  const photostripImages = elements.photostripImages;
  const overlayStack = elements.overlayStack;
  const scrapbookCanvas = elements.scrapbookCanvas;
  const layoutButtons = Array.from(elements.layoutButtons);
  const filterButtons = Array.from(elements.filterButtons);
  const backgroundButtons = Array.from(elements.backgroundButtons);
  const textInputs = [elements.eventTitleInput, elements.nameInput, elements.quoteInput, elements.customDateInput];

  bindLayoutButtons();
  bindTextInputs();
  bindImageAdjustments();
  bindStickerUi();
  bindFilters();
  bindBackgrounds();
  elements.enableDate.addEventListener("change", function () {
    updateState(function (state) {
      state.showDate = elements.enableDate.checked;
    });
  });
  photostrip.addEventListener("click", function (event) {
    if (!event.target.closest(".sticker")) {
      stickersApi.clearSelection();
    }
  });

  return {
    render: function () {
      renderLayoutButtons();
      renderPhotostrip();
      renderOverlays();
      renderStickers();
      renderFilterButtons();
      renderTextInputs();
      renderImageAdjustments();
      renderStickerPalette();
      renderStickerTools();
      renderScrapbook();
    }
  };

  function bindLayoutButtons() {
    layoutButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const layout = button.getAttribute("data-layout");
        updateState(function (state) {
          state.layout = layout;
          state.imageCount = LAYOUTS[layout].count;
          state.images = state.images.slice(0, state.imageCount);
          state.stickers = [];
          state.selectedStickerId = null;
        });
        showToast("Đã chọn bố cục " + LAYOUTS[layout].label + ".");
      });
    });
  }

  function bindTextInputs() {
    textInputs.forEach(function (input) {
      input.addEventListener("input", function () {
        updateState(function (state) {
          state.overlays.eventTitle = elements.eventTitleInput.value.trim();
          state.overlays.name = elements.nameInput.value.trim();
          state.overlays.quote = elements.quoteInput.value.trim();
          state.overlays.customDate = elements.customDateInput.value.trim();
        });
      });
    });
  }

  function bindImageAdjustments() {
    elements.imageAdjustments.addEventListener("input", function (event) {
      const target = event.target;
      if (!target.matches("input[data-image-index]")) {
        return;
      }

      const index = Number(target.getAttribute("data-image-index"));
      const field = target.getAttribute("data-field");
      const value = Number(target.value);

      updateState(function (state) {
        if (!state.images[index]) {
          return;
        }
        state.images[index][field] = value;
      });
    });
  }

  function bindStickerUi() {
    elements.stickerCategories.addEventListener("click", function (event) {
      const button = event.target.closest("[data-category]");
      if (!button) {
        return;
      }
      updateState(function (state) {
        state.stickerCategory = button.getAttribute("data-category");
      });
    });

    elements.stickerPalette.addEventListener("click", function (event) {
      const button = event.target.closest("[data-sticker-value]");
      if (!button) {
        return;
      }
      stickersApi.createEmojiSticker(button.getAttribute("data-sticker-value"), photoboothState.stickerCategory);
    });

    elements.stickerUploadInput.addEventListener("change", function (event) {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = function (loadEvent) {
        stickersApi.createImageSticker(loadEvent.target.result);
        showToast("Đã thêm sticker tùy chỉnh.");
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    });

    elements.stickerSizeRange.addEventListener("input", function () {
      stickersApi.updateSelectedSticker(function (sticker) {
        sticker.scale = Number(elements.stickerSizeRange.value);
      });
    });

    elements.stickerRotateRange.addEventListener("input", function () {
      stickersApi.updateSelectedSticker(function (sticker) {
        sticker.rotation = Number(elements.stickerRotateRange.value);
      });
    });

    elements.stickerFrontBtn.addEventListener("click", function () {
      stickersApi.updateSelectedSticker(function (sticker, state) {
        const top = state.stickers.reduce(function (max, item) {
          return Math.max(max, item.zIndex || 1);
        }, 1);
        sticker.zIndex = top + 1;
      });
    });

    elements.stickerBackBtn.addEventListener("click", function () {
      stickersApi.updateSelectedSticker(function (sticker) {
        sticker.zIndex = Math.max(1, (sticker.zIndex || 1) - 1);
      });
    });

    elements.stickerDeleteBtn.addEventListener("click", function () {
      stickersApi.deleteSelectedSticker();
    });
  }

  function bindFilters() {
    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        updateState(function (state) {
          state.filter = button.getAttribute("data-filter");
        });
      });
    });
  }

  function bindBackgrounds() {
    backgroundButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        updateState(function (state) {
          state.background = button.getAttribute("data-bg");
        });
      });
    });
  }

  function renderLayoutButtons() {
    layoutButtons.forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-layout") === photoboothState.layout);
    });
  }

  function renderPhotostrip() {
    const images = getRenderableImages();
    photostrip.className = "photostrip layout-" + photoboothState.layout;
    photostrip.style.backgroundColor = photoboothState.background;
    photostripImages.innerHTML = "";

    images.forEach(function (imageItem, index) {
      const frame = document.createElement("div");
      const media = document.createElement("div");
      const img = document.createElement("img");
      frame.className = "photostrip-frame";
      media.className = "frame-media";
      img.src = imageItem.src;
      img.alt = "Ảnh photostrip " + (index + 1);
      img.style.filter = getFilterStyle(photoboothState.filter);
      img.style.setProperty("--tx", imageItem.offsetX + "%");
      img.style.setProperty("--ty", imageItem.offsetY + "%");
      img.style.setProperty("--scale", imageItem.zoom);
      img.style.setProperty("--rotation", imageItem.rotation + "deg");
      media.appendChild(img);
      frame.appendChild(media);
      photostripImages.appendChild(frame);
    });
  }

  function renderOverlays() {
    const dateText = photoboothState.overlays.customDate || new Date(photoboothState.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    overlayStack.innerHTML = [
      photoboothState.overlays.eventTitle ? '<div class="overlay-title">' + escapeHtml(photoboothState.overlays.eventTitle) + '</div>' : '',
      photoboothState.overlays.name ? '<div class="overlay-name">' + escapeHtml(photoboothState.overlays.name) + '</div>' : '',
      photoboothState.overlays.quote ? '<div class="overlay-quote">' + escapeHtml(photoboothState.overlays.quote) + '</div>' : '',
      photoboothState.showDate ? '<div class="overlay-date">' + escapeHtml(dateText) + '</div>' : ''
    ].join('');
  }

  function renderStickers() {
    photostrip.querySelectorAll(".sticker").forEach(function (stickerElement) {
      stickerElement.remove();
    });

    photoboothState.stickers.forEach(function (sticker) {
      const stickerElement = document.createElement("button");
      stickerElement.type = "button";
      stickerElement.className = "sticker" + (sticker.id === photoboothState.selectedStickerId ? " is-selected" : "");
      stickerElement.setAttribute("aria-label", "Sticker");
      stickerElement.style.left = sticker.x + "%";
      stickerElement.style.top = sticker.y + "%";
      stickerElement.style.setProperty("--sticker-scale", sticker.scale);
      stickerElement.style.setProperty("--sticker-rotation", sticker.rotation + "deg");
      stickerElement.style.setProperty("--sticker-z", sticker.zIndex);
      if (sticker.type === "image") {
        const img = document.createElement("img");
        img.src = sticker.src;
        img.alt = "Custom sticker";
        stickerElement.appendChild(img);
      } else {
        stickerElement.textContent = sticker.character;
      }
      if (sticker.id === photoboothState.selectedStickerId) {
        const deleteButton = document.createElement("span");
        deleteButton.className = "sticker__delete";
        deleteButton.setAttribute("role", "button");
        deleteButton.setAttribute("aria-label", "Xóa sticker");
        deleteButton.textContent = "X";
        stickerElement.appendChild(deleteButton);
      }
      photostrip.appendChild(stickerElement);
      stickersApi.bindSticker(stickerElement, sticker);
    });
  }

  function renderFilterButtons() {
    filterButtons.forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-filter") === photoboothState.filter);
    });
  }

  function renderTextInputs() {
    elements.eventTitleInput.value = photoboothState.overlays.eventTitle;
    elements.nameInput.value = photoboothState.overlays.name;
    elements.quoteInput.value = photoboothState.overlays.quote;
    elements.customDateInput.value = photoboothState.overlays.customDate;
    elements.enableDate.checked = photoboothState.showDate;
  }

  function renderImageAdjustments() {
    const images = getRenderableImages();
    elements.imageAdjustments.innerHTML = images.map(function (imageItem, index) {
      return [
        '<div class="adjustment-card">',
        '<h4>Ảnh ' + (index + 1) + '</h4>',
        buildSlider(index, 'zoom', 'Zoom', imageItem.zoom, 1, 2.5, 0.1),
        buildSlider(index, 'offsetX', 'Di chuyển X', imageItem.offsetX, -25, 25, 1),
        buildSlider(index, 'offsetY', 'Di chuyển Y', imageItem.offsetY, -25, 25, 1),
        buildSlider(index, 'rotation', 'Xoay', imageItem.rotation, -20, 20, 1),
        '</div>'
      ].join('');
    }).join('');
  }

  function renderStickerPalette() {
    Array.from(elements.stickerCategories.querySelectorAll('[data-category]')).forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-category') === photoboothState.stickerCategory);
    });
    elements.stickerPalette.innerHTML = STICKER_LIBRARY[photoboothState.stickerCategory].map(function (sticker) {
      return '<button class="button" type="button" data-sticker-value="' + sticker + '" aria-label="Thêm sticker ' + sticker + '">' + sticker + '</button>';
    }).join('');
  }

  function renderStickerTools() {
    const selectedSticker = photoboothState.stickers.find(function (sticker) {
      return sticker.id === photoboothState.selectedStickerId;
    });
    elements.stickerTools.classList.toggle('is-disabled', !selectedSticker);
    elements.stickerSizeRange.value = selectedSticker ? selectedSticker.scale : 1;
    elements.stickerRotateRange.value = selectedSticker ? selectedSticker.rotation : 0;
  }

  function renderScrapbook() {
    const images = getRenderableImages();
    if (!images.length) {
      scrapbookCanvas.innerHTML = '<p class="hint">Hãy thêm ít nhất một ảnh để xem trước scrapbook.</p>';
      return;
    }

    scrapbookCanvas.innerHTML = [
      '<div class="scrapbook-strip photostrip layout-classic-strip" style="left: 12px; top: 18px;">' + buildScrapbookFrames(images) + '</div>',
      '<div class="scrapbook-strip photostrip layout-polaroid" style="right: 12px; top: 26px;">' + buildScrapbookFrames(images.slice().reverse()) + '</div>',
      '<div class="scrapbook-thumb" style="left: 126px; top: 70px;"><img src="' + images[0].src + '" alt="Ảnh thu nhỏ 1" /></div>',
      '<div class="scrapbook-thumb" style="left: 126px; top: 152px;"><img src="' + images[1 % images.length].src + '" alt="Ảnh thu nhỏ 2" /></div>',
      '<div class="scrapbook-thumb" style="right: 126px; top: 92px;"><img src="' + images[0].src + '" alt="Ảnh thu nhỏ 3" /></div>',
      '<div class="scrapbook-decor" style="left: 40px; bottom: 30px;">🌸</div>',
      '<div class="scrapbook-decor" style="right: 40px; bottom: 30px;">💖</div>'
    ].join('');
  }

  function buildScrapbookFrames(images) {
    return images.map(function (imageItem, index) {
      return '<div class="photostrip-frame"><div class="frame-media"><img src="' + imageItem.src + '" alt="Ảnh xem trước ' + (index + 1) + '" style="filter:' + getFilterStyle(photoboothState.filter) + '; --tx:' + imageItem.offsetX + '%; --ty:' + imageItem.offsetY + '%; --scale:' + imageItem.zoom + '; --rotation:' + imageItem.rotation + 'deg;" /></div></div>';
    }).join('') + '<div class="overlay-stack">' + overlayStack.innerHTML + '</div>';
  }
}

function buildSlider(index, field, label, value, min, max, step) {
  return [
    '<div class="slider-group">',
    '<label>' + label + '</label>',
    '<input type="range" data-image-index="' + index + '" data-field="' + field + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" />',
    '</div>'
  ].join('');
}

function getRenderableImages() {
  const availableImages = photoboothState.images.filter(function (item) {
    return item && item.src;
  });
  if (!availableImages.length) {
    return [];
  }
  const images = availableImages.slice(0, photoboothState.imageCount);
  while (images.length < photoboothState.imageCount) {
    images.push(availableImages[0]);
  }
  return images;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function getFilterStyle(filter) {
  switch (filter) {
    case 'black-and-white':
      return 'grayscale(100%)';
    case 'sepia':
      return 'sepia(100%)';
    case 'warm':
      return 'hue-rotate(-30deg) saturate(150%)';
    case 'cold':
      return 'hue-rotate(180deg) saturate(150%)';
    case 'cool':
      return 'hue-rotate(210deg) brightness(110%)';
    default:
      return 'none';
  }
}
