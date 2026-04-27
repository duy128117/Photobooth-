import { verifyUser } from "./modules/backend.js";

const params = new URLSearchParams(window.location.search);
const token = params.get("token") || "";
const status = document.getElementById("verify-status");
const text = document.getElementById("verify-text");

await bootstrap();

async function bootstrap() {
  if (!token) {
    status.textContent = "Lỗi";
    text.textContent = "Liên kết không hợp lệ.";
    return;
  }

  try {
    await verifyUser(token);
    status.textContent = "Thành công";
    text.textContent = "Email đã xác minh. Đang chuyển trang...";
    window.setTimeout(function () {
      window.location.replace("/photobooth.html");
    }, 1200);
  } catch (error) {
    status.textContent = "Lỗi";
    text.textContent = error.message || "Không thể xác minh.";
  }
}
