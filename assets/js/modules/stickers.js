import { createStickerItem, photoboothState, updateState } from "./state.js";

export const STICKER_LIBRARY = {
  fun: [
    createLibrarySticker("bubble-heart", "Bubble Heart", "fun"),
    createLibrarySticker("star-burst", "Star Burst", "fun"),
    createLibrarySticker("bow-ribbon", "Bow Ribbon", "fun"),
    createLibrarySticker("butterfly", "Butterfly", "fun"),
    createLibrarySticker("cherry", "Cherry", "fun"),
    createLibrarySticker("spark-cloud", "Spark Cloud", "fun")
  ],
  love: [
    createLibrarySticker("heart-locket", "Heart Locket", "love"),
    createLibrarySticker("pink-rose", "Pink Rose", "love"),
    createLibrarySticker("love-letter", "Love Letter", "love"),
    createLibrarySticker("ring-box", "Ring Box", "love"),
    createLibrarySticker("double-heart", "Double Heart", "love"),
    createLibrarySticker("blush-flower", "Blush Flower", "love")
  ],
  travel: [
    createLibrarySticker("plane-ticket", "Plane Ticket", "travel"),
    createLibrarySticker("passport-stamp", "Passport", "travel"),
    createLibrarySticker("sunset-palm", "Sunset Palm", "travel"),
    createLibrarySticker("camera-badge", "Camera Badge", "travel"),
    createLibrarySticker("road-trip", "Road Trip", "travel"),
    createLibrarySticker("location-pin", "Location Pin", "travel")
  ],
  party: [
    createLibrarySticker("party-cake", "Party Cake", "party"),
    createLibrarySticker("disco-ball", "Disco Ball", "party"),
    createLibrarySticker("champagne", "Champagne", "party"),
    createLibrarySticker("balloon-bunch", "Balloons", "party"),
    createLibrarySticker("party-pop", "Party Pop", "party"),
    createLibrarySticker("birthday-crown", "Birthday Crown", "party")
  ],
  retro: [
    createLibrarySticker("cassette", "Cassette", "retro"),
    createLibrarySticker("smile-flower", "Smile Flower", "retro"),
    createLibrarySticker("retro-glasses", "Retro Glasses", "retro"),
    createLibrarySticker("planet-ring", "Planet Ring", "retro"),
    createLibrarySticker("cloud-lightning", "Cloud Pop", "retro"),
    createLibrarySticker("film-strip", "Film Strip", "retro")
  ]
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
    createLibrarySticker: function (entry) {
      if (!entry) {
        return;
      }
      updateState(function (state) {
        const topZ = getTopZIndex(state.stickers) + 1;
        const sticker = createStickerItem({
          type: "image",
          src: entry.src,
          category: entry.category,
          anchor: resolveStickerAnchor(entry),
          zIndex: topZ
        });
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
          const currentSticker = state.stickers.find(function (item) {
            return item.id === sticker.id;
          });
          if (currentSticker) {
            currentSticker.anchor = null;
          }
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

function createLibrarySticker(id, label, category) {
  return {
    id: id,
    label: label,
    category: category,
    src: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(createStickerSvg(id))
  };
}

function resolveStickerAnchor(entry) {
  const anchorPart = getStickerAnchorPart(entry.id);
  if (!anchorPart) {
    return null;
  }

  return {
    kind: "face",
    part: anchorPart,
    imageIndex: 0
  };
}

function getStickerAnchorPart(id) {
  switch (id) {
    case "bubble-heart":
      return "top";
    case "star-burst":
      return "upper-right";
    case "bow-ribbon":
      return "brow";
    case "butterfly":
      return "top-wide";
    case "cherry":
      return "cheeks";
    case "spark-cloud":
      return "upper-right";
    case "heart-locket":
      return "cheek-right";
    case "pink-rose":
      return "top";
    case "love-letter":
      return "upper-right";
    case "ring-box":
      return "top";
    case "double-heart":
      return "cheeks";
    case "blush-flower":
      return "cheeks";
    case "plane-ticket":
      return "upper-right";
    case "passport-stamp":
      return "cheek-right";
    case "sunset-palm":
      return "top";
    case "camera-badge":
      return "cheek-left";
    case "road-trip":
      return "top";
    case "location-pin":
      return "top";
    case "party-cake":
      return "top";
    case "disco-ball":
      return "top";
    case "champagne":
      return "upper-right";
    case "balloon-bunch":
      return "top-wide";
    case "party-pop":
      return "upper-right";
    case "birthday-crown":
      return "top";
    case "cassette":
      return "top-wide";
    case "smile-flower":
      return "cheeks";
    case "retro-glasses":
      return "eyes";
    case "planet-ring":
      return "top";
    case "cloud-lightning":
      return "upper-right";
    case "film-strip":
      return "top-wide";
    case "glasses":
    case "star-glasses":
      return "eyes";
    case "bow":
      return "brow";
    case "crown":
      return "top";
    case "flower-crown":
    case "bunny-ears":
      return "top-wide";
    case "sparkle":
      return "upper-right";
    case "heart":
      return "cheek-right";
    case "blush":
      return "cheeks";
    case "mustache":
      return "mouth";
    case "halo":
      return "top";
    default:
      return null;
  }
}

function createStickerSvg(id) {
  switch (id) {
    case "bubble-heart":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><defs><linearGradient id="a" x1="18" y1="18" x2="78" y2="78"><stop stop-color="#ffb4cb"/><stop offset="1" stop-color="#ff7aa3"/></linearGradient></defs><path d="M48 78 18 48c-9-9-9-24 0-33 8-8 21-8 30 0 9-8 22-8 30 0 9 9 9 24 0 33L48 78Z" fill="url(#a)"/><circle cx="31" cy="31" r="8" fill="#fff" opacity=".35"/><circle cx="66" cy="62" r="5" fill="#fff" opacity=".22"/></svg>';
    case "star-burst":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 10 57 34l24 9-24 9-9 24-9-24-24-9 24-9 9-24Z" fill="#ffd667" stroke="#ff9f43" stroke-width="5" stroke-linejoin="round"/><path d="M18 16 22 27l11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#7ec7ff"/><path d="M74 58 78 69l11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#ff9bc6"/></svg>';
    case "bow-ribbon":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="8" fill="#ff8ea1"/><path d="M40 46 16 28c-5 12-1 25 11 31l13-13Z" fill="#ffbdd0"/><path d="M56 46 80 28c5 12 1 25-11 31L56 46Z" fill="#ffbdd0"/><path d="M44 52 35 78l13-10 13 10-9-26" fill="#ffa2bb"/></svg>';
    case "butterfly":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 42c-5-17-21-23-32-15-7 5-9 16-2 24 7 9 20 13 34 8V42Z" fill="#89d0ff"/><path d="M48 42c5-17 21-23 32-15 7 5 9 16 2 24-7 9-20 13-34 8V42Z" fill="#ff9fc9"/><path d="M48 54c-5 16-19 23-30 17-9-5-12-16-5-24 8-9 18-8 35 7Z" fill="#ffd671"/><path d="M48 54c5 16 19 23 30 17 9-5 12-16 5-24-8-9-18-8-35 7Z" fill="#c89bff"/><path d="M48 20v56" stroke="#40312c" stroke-width="5" stroke-linecap="round"/><path d="M48 24 42 16M48 24l6-8" stroke="#40312c" stroke-width="4" stroke-linecap="round"/></svg>';
    case "cherry":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M44 34c-2-8 3-14 10-17M52 34c5-9 13-14 22-15" stroke="#4d8d45" stroke-width="5" stroke-linecap="round"/><circle cx="34" cy="56" r="16" fill="#ff5f74"/><circle cx="62" cy="58" r="16" fill="#ff7a86"/><circle cx="28" cy="50" r="5" fill="#fff" opacity=".35"/><circle cx="56" cy="52" r="5" fill="#fff" opacity=".35"/></svg>';
    case "spark-cloud":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M29 68c-9 0-16-6-16-15 0-8 6-14 14-15 3-11 12-18 24-18 13 0 24 9 26 22 9 1 16 8 16 17 0 10-8 18-18 18H29Z" fill="#eef6ff"/><path d="M53 26 57 38l12 4-12 4-4 12-4-12-12-4 12-4 4-12Z" fill="#ffd567" stroke="#ffac53" stroke-width="4" stroke-linejoin="round"/></svg>';
    case "heart-locket":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 76 22 50c-8-8-8-21 0-29 7-7 18-7 26 0 8-7 19-7 26 0 8 8 8 21 0 29L48 76Z" fill="#ff85a6"/><circle cx="48" cy="49" r="8" fill="#fff0f5"/><path d="M48 49 44 46" stroke="#ff85a6" stroke-width="3" stroke-linecap="round"/></svg>';
    case "pink-rose":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 72V42" stroke="#5f9f55" stroke-width="5" stroke-linecap="round"/><path d="M48 42c16 0 24-9 24-19 0-8-6-14-14-14-4 0-8 2-10 5-2-3-6-5-10-5-8 0-14 6-14 14 0 10 8 19 24 19Z" fill="#ff95ba"/><path d="M40 56 26 50M56 56l14-6" stroke="#5f9f55" stroke-width="5" stroke-linecap="round"/></svg>';
    case "love-letter":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="16" y="24" width="64" height="46" rx="8" fill="#fff4f8" stroke="#ff9fc1" stroke-width="5"/><path d="m20 30 28 22 28-22" stroke="#ff9fc1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 20 44 16c-5-5-13-5-18 0-5 5-5 13 0 18l22 20 22-20c5-5 5-13 0-18-5-5-13-5-18 0l-4 4Z" fill="#ff7ca1" transform="scale(.45) translate(58 12)"/></svg>';
    case "ring-box":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="22" y="40" width="52" height="28" rx="7" fill="#ffcad9"/><path d="M28 40h40v-8c0-7-6-13-13-13H41c-7 0-13 6-13 13v8Z" fill="#ff9ab8"/><circle cx="48" cy="36" r="9" fill="#fff"/><circle cx="48" cy="36" r="5" fill="#9dd9ff"/></svg>';
    case "double-heart":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M38 68 18 48c-7-7-7-18 0-25 6-6 15-6 20 0 6-6 15-6 20 0 7 7 7 18 0 25L38 68Z" fill="#ff9ab8"/><path d="M60 72 42 54c-6-6-6-16 0-22 5-5 12-5 18 0 5-5 12-5 18 0 6 6 6 16 0 22L60 72Z" fill="#ff6d92"/></svg>';
    case "blush-flower":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="10" fill="#ffd36e"/><circle cx="48" cy="24" r="12" fill="#ffb3c9"/><circle cx="48" cy="72" r="12" fill="#ffb3c9"/><circle cx="24" cy="48" r="12" fill="#ffb3c9"/><circle cx="72" cy="48" r="12" fill="#ffb3c9"/><circle cx="31" cy="31" r="12" fill="#ffc7d8"/><circle cx="65" cy="31" r="12" fill="#ffc7d8"/><circle cx="31" cy="65" r="12" fill="#ffc7d8"/><circle cx="65" cy="65" r="12" fill="#ffc7d8"/></svg>';
    case "plane-ticket":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="14" y="28" width="68" height="40" rx="10" fill="#eef7ff" stroke="#8ac5ff" stroke-width="5"/><path d="M28 48h40" stroke="#8ac5ff" stroke-width="4" stroke-dasharray="5 5"/><path d="M42 40 62 48 42 56l4-8-12 0 0-4 12 0-4-8Z" fill="#ff9f68"/></svg>';
    case "passport-stamp":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="22" y="18" width="52" height="60" rx="9" fill="#8ebcff"/><circle cx="48" cy="48" r="14" stroke="#eef7ff" stroke-width="5"/><path d="M34 48h28M48 34c6 6 6 22 0 28M48 34c-6 6-6 22 0 28" stroke="#eef7ff" stroke-width="4" stroke-linecap="round"/></svg>';
    case "sunset-palm":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="24" fill="#ffcc73"/><path d="M48 24c13 0 23 11 23 24H25c0-13 10-24 23-24Z" fill="#ff9f68"/><path d="M58 74V48" stroke="#694732" stroke-width="5" stroke-linecap="round"/><path d="M58 52c6-8 13-10 20-7M58 56c-7-4-14-4-21 0M58 48c4-10 10-15 18-16" stroke="#5f9f55" stroke-width="5" stroke-linecap="round"/></svg>';
    case "camera-badge":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="18" y="30" width="60" height="36" rx="10" fill="#1f2535"/><path d="M30 30 36 22h24l6 8" stroke="#7ec7ff" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="48" r="12" fill="#7ec7ff"/><circle cx="48" cy="48" r="6" fill="#dff3ff"/><circle cx="66" cy="38" r="4" fill="#ff9f68"/></svg>';
    case "road-trip":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M18 62h60" stroke="#505e7a" stroke-width="8" stroke-linecap="round"/><path d="M26 62v-8c0-10 8-18 18-18h8c10 0 18 8 18 18v8" fill="#ffb570"/><circle cx="34" cy="66" r="8" fill="#2f3342"/><circle cx="66" cy="66" r="8" fill="#2f3342"/><path d="M34 38h28" stroke="#fff4dc" stroke-width="5" stroke-linecap="round"/></svg>';
    case "location-pin":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 82 30 55c-11-16-4-37 18-37s29 21 18 37L48 82Z" fill="#ff8973"/><circle cx="48" cy="38" r="10" fill="#fff1ed"/><circle cx="48" cy="38" r="4" fill="#ff8973"/></svg>';
    case "party-cake":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="22" y="44" width="52" height="26" rx="8" fill="#ffb6cc"/><path d="M22 52h52" stroke="#fff4f8" stroke-width="5"/><path d="M48 22v14" stroke="#ff9d4f" stroke-width="4" stroke-linecap="round"/><path d="M48 20c3 3 3 8 0 11-3-3-3-8 0-11Z" fill="#ffd36e"/><path d="M26 44c7-8 14-8 22 0 8-8 15-8 22 0" stroke="#fff0f4" stroke-width="5" stroke-linecap="round"/></svg>';
    case "disco-ball":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M48 20v12" stroke="#7b8cb7" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="50" r="24" fill="#dfe9ff"/><path d="M30 42h36M26 50h44M30 58h36M40 28v44M56 28v44" stroke="#8ea0cc" stroke-width="3"/><circle cx="76" cy="24" r="5" fill="#ffd36e"/><circle cx="18" cy="34" r="4" fill="#ff9ab8"/></svg>';
    case "champagne":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M34 20h28v12c0 10-6 18-14 21-8-3-14-11-14-21V20Z" fill="#ffe7a2"/><path d="M48 53v14M38 74h20" stroke="#8f7860" stroke-width="5" stroke-linecap="round"/><circle cx="66" cy="18" r="5" fill="#ffd36e"/><circle cx="74" cy="28" r="4" fill="#ffd36e"/><circle cx="60" cy="12" r="3" fill="#ffd36e"/></svg>';
    case "balloon-bunch":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><ellipse cx="34" cy="34" rx="12" ry="15" fill="#ff9ab8"/><ellipse cx="52" cy="28" rx="12" ry="15" fill="#7ec7ff"/><ellipse cx="64" cy="42" rx="12" ry="15" fill="#ffd36e"/><path d="M34 49 46 74M52 43 48 74M64 57 50 74" stroke="#8d715e" stroke-width="3" stroke-linecap="round"/></svg>';
    case "party-pop":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="m30 66 18-36 18 12-24 24-12 0Z" fill="#ff9ab8"/><path d="M48 30 62 18M54 40h18M60 48l12 12M22 24l8 8M18 40h12" stroke="#ffd36e" stroke-width="5" stroke-linecap="round"/></svg>';
    case "birthday-crown":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M18 64 28 32l16 16 12-24 12 24 16-16 10 32H18Z" fill="#ffd36e" stroke="#f1aa2a" stroke-width="5" stroke-linejoin="round"/><circle cx="28" cy="32" r="4" fill="#7ec7ff"/><circle cx="56" cy="24" r="5" fill="#ff8aa6"/><circle cx="84" cy="32" r="4" fill="#9be27a"/></svg>';
    case "cassette":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="18" y="24" width="60" height="48" rx="8" fill="#26314d"/><rect x="28" y="32" width="40" height="16" rx="4" fill="#ffd6a5"/><circle cx="36" cy="56" r="8" fill="#dfe9ff"/><circle cx="60" cy="56" r="8" fill="#dfe9ff"/><path d="M48 48v8" stroke="#ffd6a5" stroke-width="4" stroke-linecap="round"/></svg>';
    case "smile-flower":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="12" fill="#ffd36e"/><circle cx="48" cy="20" r="12" fill="#fff0a8"/><circle cx="48" cy="76" r="12" fill="#fff0a8"/><circle cx="20" cy="48" r="12" fill="#fff0a8"/><circle cx="76" cy="48" r="12" fill="#fff0a8"/><circle cx="28" cy="28" r="12" fill="#ffb5d0"/><circle cx="68" cy="28" r="12" fill="#ffb5d0"/><circle cx="28" cy="68" r="12" fill="#7ec7ff"/><circle cx="68" cy="68" r="12" fill="#7ec7ff"/><path d="M43 45h2M51 45h2M42 53c3 4 9 4 12 0" stroke="#7e5824" stroke-width="3" stroke-linecap="round"/></svg>';
    case "retro-glasses":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="18" y="34" width="22" height="18" rx="9" stroke="#ff9ab8" stroke-width="6"/><rect x="56" y="34" width="22" height="18" rx="9" stroke="#7ec7ff" stroke-width="6"/><path d="M40 43h16" stroke="#4a4454" stroke-width="6" stroke-linecap="round"/><path d="M18 34 10 28M78 34l8-6" stroke="#4a4454" stroke-width="4" stroke-linecap="round"/></svg>';
    case "planet-ring":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="18" fill="#a18aff"/><ellipse cx="48" cy="50" rx="34" ry="11" stroke="#ffd36e" stroke-width="6" transform="rotate(-12 48 50)"/><circle cx="34" cy="30" r="4" fill="#7ec7ff"/><circle cx="66" cy="66" r="5" fill="#ff9ab8"/></svg>';
    case "cloud-lightning":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><path d="M28 64c-8 0-14-6-14-13 0-7 5-12 12-13 3-9 10-15 20-15 11 0 20 7 22 18 8 1 14 7 14 15 0 8-7 15-15 15H28Z" fill="#eef3ff"/><path d="M52 40 42 58h10l-8 18 20-24H54l8-12" fill="#ffd36e"/></svg>';
    case "film-strip":
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><rect x="22" y="16" width="52" height="64" rx="8" fill="#20212b"/><rect x="32" y="28" width="32" height="16" rx="3" fill="#ffb6cc"/><rect x="32" y="52" width="32" height="16" rx="3" fill="#7ec7ff"/><path d="M26 22h8M26 34h8M26 46h8M26 58h8M26 70h8M62 22h8M62 34h8M62 46h8M62 58h8M62 70h8" stroke="#fff4dc" stroke-width="3" stroke-linecap="round"/></svg>';
    default:
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none"><circle cx="48" cy="48" r="30" fill="#e8ecf4"/><path d="M30 48h36" stroke="#9aa7b8" stroke-width="8" stroke-linecap="round"/></svg>';
  }
}
