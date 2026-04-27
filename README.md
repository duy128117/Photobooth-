# Photobooth Web App

Ứng dụng photobooth chạy hoàn toàn trên web, cho phép người dùng chụp/tải ảnh, chỉnh sửa theo layout photostrip, thêm sticker/text/filter, lưu dự án và chia sẻ.

README này được viết theo hướng **nhà tuyển dụng có thể clone và chạy nhanh trong vài phút**.

---

## 1) Tổng quan dự án

### Mục tiêu
- Tạo trải nghiệm photobooth hiện đại, dễ dùng trên desktop/mobile.
- Có hệ thống tài khoản thật (đăng ký/đăng nhập/xác minh email).
- Cho phép quản lý dự án (lưu, mở lại, nhân bản, xóa, chia sẻ).
- Có chế độ hoạt động offline cơ bản (PWA + cache).

### Điểm nổi bật
- Camera capture trực tiếp + upload ảnh từ thiết bị.
- Editor với nhiều layout, filter, background, text, sticker.
- Undo/Redo + autosave bản nháp trong trình duyệt.
- Chia sẻ bằng link và QR code.
- Gallery có phân vùng dự án cá nhân và public.
- Backend thuần Node.js (không framework) + có thể chuyển qua Supabase mode.

---

## 2) Demo luồng sử dụng nhanh (cho recruiter)

1. Mở trang chủ: `http://localhost:3000/`
2. Nhấn **Bắt đầu / Chụp ngay**
3. Đăng ký tài khoản
4. Xác minh email bằng mã OTP (6 số)
5. Vào `photobooth.html`, chụp hoặc tải ảnh lên
6. Chỉnh sửa photostrip (layout/filter/sticker/text)
7. Lưu project, tải ảnh xuống, mở Gallery để xem/nhân bản/xóa

---

## 3) Công nghệ sử dụng

### Frontend
- HTML/CSS/JavaScript thuần (module ES).
- `html2canvas` để export ảnh.
- `face-api.js` + `@mediapipe/selfie_segmentation` cho xử lý camera/phông nền.

### Backend
- Node.js HTTP server tự xây (`server.js`).
- Lưu dữ liệu local qua `data/db.json`.
- Lưu asset dự án tại `storage/projects`.
- Tạo QR bằng package `qrcode`.

### PWA
- `manifest.webmanifest`
- `service-worker.js` cache app shell + offline fallback (`offline.html`).

---

## 4) Cài đặt và chạy local

### Yêu cầu
- Node.js >= 18
- npm

### Chạy dự án
```bash
npm install
npm start
```

Mở:

```text
http://localhost:3000/
```

---

## 5) Cấu hình email xác minh

Project có 2 chế độ gửi mail xác minh:

### A. Local preview mode (mặc định, không cần key)
- Nếu chưa cấu hình Resend, server tự tạo file preview email tại:
  - `data/mailbox/*.html`
- Trong UI đăng ký sẽ có link **Mở mail xác minh**.

### B. Real email mode (Resend)
1. Copy file:
   - `.env.example` -> `.env`
2. Điền giá trị:
   - `RESEND_API_KEY`
   - `MAIL_FROM` (sender/domain đã verify ở Resend)
3. Chạy lại server:
   ```bash
   npm start
   ```

---

## 6) Chế độ dữ liệu: Local mode và Supabase mode

### Local mode (default)
- Không cần cloud.
- Auth + projects chạy qua API nội bộ trong `server.js`.
- Dữ liệu lưu tại:
  - `data/db.json`
  - `storage/projects`

### Supabase mode (tuỳ chọn)
1. Chạy SQL schema trong:
   - `supabase/schema.sql`
2. Mở file:
   - `assets/js/modules/supabase-config.js`
3. Cập nhật và bật:
   - `enabled: true`
   - `url`, `anonKey`, `emailRedirectPath`
4. Trong Supabase Dashboard:
   - bật xác minh email
   - thêm redirect URL local (`/login.html`, có thể thêm `/verify.html`)

Tài liệu chi tiết: `SUPABASE_SETUP.md`

---

## 7) Cấu trúc thư mục chính

```text
assets/
  css/              # style cho landing, auth, editor
  js/
    modules/        # state, camera, editor, export, backend adapter...
data/
  db.json           # database local (users/projects/events...)
  mailbox/          # preview email khi chưa dùng Resend
storage/
  projects/         # file asset của project đã lưu
supabase/
  schema.sql        # schema + RLS policies
server.js           # HTTP server + REST API + static serving
```

---

## 8) Các trang chính

- `/index.html`: landing page giới thiệu sản phẩm
- `/login.html`: đăng nhập/đăng ký + OTP verification
- `/photobooth.html`: capture/upload + editor + export/share
- `/gallery.html`: quản lý project (my/public, search, duplicate, delete)
- `/verify.html`: xác minh token (flow qua link)
- `/offline.html`: trang fallback khi offline

---

## 9) Tính năng chính

### Authentication
- Đăng ký với `name`, `username`, `email`, `password`
- Xác minh email bằng mã 6 số
- Đăng nhập bằng email hoặc username
- Session qua cookie HTTP

### Capture & Upload
- Chụp ảnh từ webcam
- Upload ảnh từ thiết bị
- Theo dõi trạng thái số ảnh đã chọn

### Editor
- Layout: classic strip, landscape, collage, polaroid, postcard, k-style
- Filter: none, black-and-white, sepia, warm, cold, cool
- Nền màu, text overlay (title/name/quote/date)
- Sticker có điều chỉnh size/rotate/layer
- Undo/Redo
- Autosave local draft

### Save/Share/Export
- Lưu project
- Mở lại project đã lưu
- Nhân bản project
- Chia sẻ qua link + QR
- Tải photostrip ra ảnh

### Gallery
- Xem dự án cá nhân và public
- Search + phân trang
- Xóa/nhân bản/mở lại project

### PWA
- Cache các tài nguyên chính
- Hỗ trợ mở lại app shell khi offline
- Các tính năng cần mạng (auth/save/share) sẽ hoạt động lại khi online

---

## 10) API tiêu biểu

### Auth
- `POST /api/auth/register`
- `POST /api/auth/verify`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Projects
- `GET /api/projects/my`
- `GET /api/projects/public`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/duplicate`
- `POST /api/projects/:id/downloaded`

### Utilities / Others
- `GET /api/utils/qr?text=...`
- `GET/POST /api/templates`
- `GET/POST /api/events`
- `GET /api/analytics/overview`

---

## 11) Checklist test nhanh sau khi clone

1. `npm install` và `npm start`
2. Đăng ký tài khoản mới
3. Xác minh OTP (qua mail preview hoặc email thật)
4. Tạo một photostrip, thêm sticker + text
5. Lưu project, tải ảnh
6. Vào gallery, mở lại project, thử duplicate

Nếu hoàn thành 6 bước này, bạn đã thấy đầy đủ luồng cốt lõi của sản phẩm.

---

## 12) Ghi chú triển khai

- Service Worker chỉ đăng ký ngoài môi trường localhost.
- Với Local mode, dữ liệu nằm trong project folder (phù hợp demo/dev).
- Với production, nên bật Supabase mode + cấu hình Storage và domain email xác minh.

---

## 13) Tài liệu liên quan

- Supabase setup: `SUPABASE_SETUP.md`
- SQL schema: `supabase/schema.sql`

---

## 14) Định hướng nâng cấp (gợi ý)

- Upload asset lên Supabase Storage thay vì local disk.
- Bổ sung social auth (Google) hoàn chỉnh.
- Thêm unit/integration test cho API và editor state.
- Tách backend thành service độc lập và chuẩn hoá logging.
