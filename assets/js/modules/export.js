import html2canvas from "/node_modules/html2canvas/dist/html2canvas.esm.js";
import { photoboothState, updateState } from "./state.js";
import { markProjectDownloaded } from "./api.js";

export function initializeExport(elements, showToast) {
  const downloadBtn = elements.downloadBtn;
  const photostrip = elements.photostrip;

  return {
    exportStrip: async function () {
      if (!photoboothState.images.some(function (item) { return item && item.src; })) {
        showToast("Hãy thêm ít nhất một ảnh trước khi xuất.");
        return false;
      }

      updateState(function (state) {
        state.exportLoading = true;
      });
      photostrip.classList.add("is-exporting");
      downloadBtn.textContent = "Đang xuất...";
      downloadBtn.disabled = true;

      try {
        const canvas = await html2canvas(photostrip, {
          backgroundColor: null,
          scale: Math.max(2, window.devicePixelRatio || 1),
          useCORS: true,
          logging: false
        });
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = photoboothState.layout + ".png";
        link.click();
        if (photoboothState.projectId) {
          await markProjectDownloaded(photoboothState.projectId);
        }
        showToast("Đã xuất photostrip.");
        return true;
      } catch (error) {
        console.error("Lỗi khi xuất photostrip:", error);
        showToast("Xuất thất bại. Vui lòng thử lại.");
        return false;
      } finally {
        photostrip.classList.remove("is-exporting");
        updateState(function (state) {
          state.exportLoading = false;
        });
        downloadBtn.textContent = "Tải xuống";
        downloadBtn.disabled = false;
      }
    }
  };
}
