import { createStickerItem, photoboothState, updateState } from "./state.js";

export const STICKER_LIBRARY = {
  fun: ["🦄", "✨", "🎀", "🌈", "😎"],
  love: ["💖", "🌸", "💌", "🫶", "💍"],
  travel: ["✈️", "🌴", "📍", "🎫", "📸"]
};

export function initializeStickers(container) {
  let activeDrag = null;

  return {
    createEmojiSticker: function (character, category) {
      updateState(function (state) {
        const topZ = getTopZIndex(state.stickers) + 1;
        const sticker = createStickerItem({ type: "emoji", character: character, category: category, zIndex: topZ });
        state.stickers.push(sticker);
        state.selectedStickerId = sticker.id;
      });
    },
    createImageSticker: function (src) {
      updateState(function (state) {
        const topZ = getTopZIndex(state.stickers) + 1;
        const sticker = createStickerItem({ type: "image", src: src, category: "custom", zIndex: topZ });
        state.stickers.push(sticker);
        state.selectedStickerId = sticker.id;
      });
    },
    bindSticker: function (stickerElement, sticker) {
      stickerElement.addEventListener("click", function (event) {
        if (event.target.closest(".sticker__delete")) {
          return;
        }
        event.stopPropagation();
        updateState(function (state) {
          state.selectedStickerId = sticker.id;
        });
      });

      stickerElement.addEventListener("pointerdown", function (event) {
        if (event.target.closest(".sticker__delete")) {
          return;
        }
        const stripRect = container.getBoundingClientRect();
        const stickerRect = stickerElement.getBoundingClientRect();
        event.preventDefault();
        event.stopPropagation();

        updateState(function (state) {
          state.selectedStickerId = sticker.id;
        });

        activeDrag = {
          id: sticker.id,
          pointerId: event.pointerId,
          offsetX: event.clientX - (stickerRect.left + stickerRect.width / 2),
          offsetY: event.clientY - (stickerRect.top + stickerRect.height / 2),
          rect: stripRect,
          element: stickerElement
        };

        stickerElement.classList.add("dragging");
        stickerElement.setPointerCapture(event.pointerId);
        document.body.classList.add("is-dragging");

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerEnd);
      });

      const deleteButton = stickerElement.querySelector(".sticker__delete");
      if (deleteButton) {
        deleteButton.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          updateState(function (state) {
            state.stickers = state.stickers.filter(function (item) {
              return item.id !== sticker.id;
            });
            if (state.selectedStickerId === sticker.id) {
              state.selectedStickerId = null;
            }
          });
        });
      }
    },
    updateSelectedSticker: function (updater) {
      updateState(function (state) {
        const sticker = state.stickers.find(function (item) {
          return item.id === state.selectedStickerId;
        });
        if (sticker) {
          updater(sticker, state);
        }
      });
    },
    deleteSelectedSticker: function () {
      updateState(function (state) {
        state.stickers = state.stickers.filter(function (item) {
          return item.id !== state.selectedStickerId;
        });
        state.selectedStickerId = null;
      });
    },
    clearSelection: function () {
      updateState(function (state) {
        state.selectedStickerId = null;
      });
    }
  };

  function handlePointerMove(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }

    const adjustedX = event.clientX - activeDrag.offsetX;
    const adjustedY = event.clientY - activeDrag.offsetY;
    const x = clamp(((adjustedX - activeDrag.rect.left) / activeDrag.rect.width) * 100, 8, 92);
    const y = clamp(((adjustedY - activeDrag.rect.top) / activeDrag.rect.height) * 100, 6, 94);

    updateState(function (state) {
      const sticker = state.stickers.find(function (item) {
        return item.id === activeDrag.id;
      });
      if (sticker) {
        sticker.x = x;
        sticker.y = y;
      }
    });
  }

  function handlePointerEnd(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) {
      return;
    }

    activeDrag.element.classList.remove("dragging");
    activeDrag.element.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-dragging");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerEnd);
    window.removeEventListener("pointercancel", handlePointerEnd);
    activeDrag = null;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTopZIndex(stickers) {
  return stickers.reduce(function (max, sticker) {
    return Math.max(max, sticker.zIndex || 1);
  }, 1);
}
