# Supabase Setup

Project này đã được chuẩn bị để chạy theo 2 chế độ:

1. `Local mode`
2. `Supabase mode`

Nếu config Supabase đã có, frontend sẽ ưu tiên dùng Supabase cho:

- đăng ký
- đăng nhập
- đăng xuất
- lấy user hiện tại
- lưu project
- tải project
- gallery

## 1. Chạy schema

Vào `Supabase Dashboard -> SQL Editor` rồi chạy file:

- [supabase/schema.sql](D:\CODE\WEB\phtobooth\supabase\schema.sql)

Schema này đã làm sẵn:

- bảng `profiles`
- bảng `projects`
- trigger tự tạo profile khi user đăng ký
- RLS
- policy cho owner/public

## 2. Kiểm tra config frontend

File:

- [supabase-config.js](D:\CODE\WEB\phtobooth\assets\js\modules\supabase-config.js)

Hiện đã có:

- `url`
- `anonKey`

## 3. Bật email confirmation

Phần này mình không thể bật trực tiếp từ local project của bạn. Bạn cần bấm trong dashboard:

1. `Authentication`
2. `Providers`
3. `Email`
4. bật `Confirm email`

Nếu có phần `Secure email change` thì có thể bật luôn.

## 4. Thêm redirect URL

Trong `Authentication -> URL Configuration`:

thêm:

- `http://localhost:3000/login.html`
- nếu cần:
  - `http://localhost:3000/verify.html`
  - `http://localhost:3000/photobooth.html`

## 5. Test

Chạy:

```bash
npm start
```

Mở:

```text
http://localhost:3000/
```

Test flow:

1. vào trang chủ
2. nhấn `Đăng ký`
3. đăng ký tài khoản
4. mở email xác minh từ Supabase
5. đăng nhập
6. lưu project
7. mở gallery

## Ghi chú quan trọng

- `Confirm email` là thao tác dashboard, không phải thứ mình có thể bật bằng file frontend
- `schema.sql` và policy thì mình đã chuẩn bị xong trong project
- nếu bạn muốn, bước tiếp theo mình có thể làm là:
  1. giới hạn khách chỉ chụp 1 ảnh
  2. user đăng nhập được full chức năng
  3. chuyển upload ảnh sang Supabase Storage
