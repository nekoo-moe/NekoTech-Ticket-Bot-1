# Bot Ticket của Fujishin Fork

Cài đặt:
### Bước 1: Lấy thông tin Bot từ Discord Developer Portal
1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications).
2. Nhấn **New Application** và đặt tên cho Bot của bạn.
3. Chuyển sang tab **Bot**:
   - Nhấn **Reset Token** để lấy `BotToken` (Lưu lại, không để l).
   - Kéo xuống mục **Privileged Gateway Intents**, bật TẤT CẢ 3 tuỳ chọn: `Presence Intent`, `Server Members Intent`, và `Message Content Intent`.
4. Chuyển sang tab **OAuth2 -> General**:
   - Lấy `Client ID` và `Client Secret`.
   - Để mời bot vào server, chuyển sang tab **OAuth2 -> URL Generator**, chọn scope `bot` và `applications.commands`, cấp quyền `Administrator` rồi copy link dán vào trình duyệt để mời.

### Bước 2: Tải Source Code & Cài Đặt Thư Viện
1. Clone mã nguồn về máy :
   ```bash
   git clone https://github.com/nekoo-moe/NekoTech-Ticket-Bot-1/
   cd NekoTech-Ticket-Bot-1
   ```
2. Cài đặt toàn bộ thư viện cần thiết:
   ```bash
   npm install
   ```

### Bước 3: Thiết Lập Cấu Hình (`config.yml`)
1. Mở file `config.yml` nằm ở thư mục gốc của bot.
2. Sửa các thông số quan trọng.

### Bước 4: Khởi Chạy Bot

Sử dụng lệnh sau để chạy bot:

```bash
npm start
```

Hoặc chạy trực tiếp qua node:

```bash
node index.js
```
