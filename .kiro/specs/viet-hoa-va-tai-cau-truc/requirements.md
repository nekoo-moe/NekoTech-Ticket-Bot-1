# Requirements Document

## Introduction

Feature này thực hiện ba thay đổi lớn song song trên bot Discord ticket Heiznerd-TK2 (fork của Plex Tickets v2.5.2):

1. **Việt hóa toàn bộ** — tách chuỗi hiển thị ra `lang/vi.json`, thay thế section `Locale` trong `config.yml` và các chuỗi cứng trong addons, tích hợp hàm `t()` vào Dashboard EJS.
2. **Đơn giản hóa cấu hình** — giữ tối thiểu trong file (Token, GuildID, DB path), chuyển toàn bộ cấu hình động vào SQLite và quản lý qua lệnh `/setup` + Dashboard.
3. **Chuyển từ MongoDB/Mongoose sang SQLite3** — dùng `better-sqlite3` (synchronous), định nghĩa lại toàn bộ schema, tạo lớp `db/` thay thế Mongoose models.

Mục tiêu: giữ nguyên 100% tính năng hiện có, chỉ thay đổi lớp lưu trữ, cấu hình và ngôn ngữ hiển thị.

---

## Glossary

- **Bot**: Ứng dụng Discord bot Heiznerd-TK2 chạy trên Node.js >= 18 với Discord.js v14.
- **I18n_System**: Hệ thống quốc tế hóa gồm `lang/index.js` và `lang/vi.json`, cung cấp hàm `t()`.
- **t()**: Hàm tra cứu chuỗi tiếng Việt theo key phân cấp (dot notation), hỗ trợ thay thế biến `{varName}`.
- **DB_Layer**: Lớp truy cập cơ sở dữ liệu SQLite gồm các module trong thư mục `db/`, thay thế Mongoose models.
- **SQLite_DB**: File cơ sở dữ liệu `bot.db` được quản lý bởi thư viện `better-sqlite3`.
- **Config_Store**: Bảng `guild_config` trong SQLite lưu trữ cấu hình động của bot.
- **Setup_Command**: Lệnh slash `/setup` cho phép admin cấu hình bot qua Discord.
- **Dashboard**: Addon web tại `addons/Dashboard/` dùng Express + EJS để quản lý bot qua trình duyệt.
- **Migration_Script**: Script `scripts/migrate-mongo-to-sqlite.js` chuyển dữ liệu từ MongoDB sang SQLite.
- **Addon**: Các module mở rộng tại `addons/` (Giveaways, StickyMessages, Vouch, Dashboard).
- **Ticket**: Kênh Discord được tạo ra để xử lý yêu cầu hỗ trợ của người dùng.
- **Staff**: Thành viên server có vai trò hỗ trợ (support role) được phép nhận và xử lý ticket.
- **Admin**: Thành viên server có quyền `Administrator` trong Discord.

---

## Requirements

### Requirement 1: Hệ thống i18n — Tải và tra cứu chuỗi tiếng Việt

**User Story:** Là một developer, tôi muốn có một hệ thống i18n tập trung, để tất cả chuỗi hiển thị của bot đều được quản lý trong một file và dễ dàng thay đổi.

#### Tiêu chí chấp nhận

1. THE I18n_System SHALL tải file `lang/vi.json` khi bot khởi động.
2. WHEN hàm `t(key)` được gọi với một key tồn tại trong `vi.json`, THE I18n_System SHALL trả về chuỗi tiếng Việt tương ứng.
3. WHEN hàm `t(key, vars)` được gọi với biến thay thế, THE I18n_System SHALL thay thế tất cả placeholder `{varName}` trong chuỗi bằng giá trị tương ứng từ `vars`.
4. WHEN hàm `t(key)` được gọi với một key không tồn tại trong `vi.json`, THE I18n_System SHALL trả về chính chuỗi `key` đó thay vì throw lỗi.
5. WHILE chạy ở môi trường `NODE_ENV=development`, WHEN hàm `t(key)` được gọi với key không tồn tại, THE I18n_System SHALL ghi log cảnh báo `[i18n] Missing key: {key}` ra console.
6. THE I18n_System SHALL hỗ trợ tra cứu key phân cấp theo dot notation (ví dụ: `ticket.close.button`).

---

### Yêu cầu 2: Hệ thống i18n — Tích hợp vào Dashboard EJS

**User Story:** Là một người dùng Dashboard, tôi muốn toàn bộ giao diện web hiển thị bằng tiếng Việt, để tôi có thể quản lý bot mà không cần đọc tiếng Anh.

#### Tiêu chí chấp nhận

1. WHEN Dashboard nhận một HTTP request, THE Dashboard SHALL gán hàm `t` vào `res.locals.t` thông qua Express middleware trước khi render view.
2. THE Dashboard SHALL sử dụng `t()` để render tất cả label, tiêu đề, nút bấm và thông báo trong các file EJS.
3. WHEN một trang Dashboard được render, THE Dashboard SHALL hiển thị toàn bộ nội dung giao diện bằng tiếng Việt.

---

### Yêu cầu 3: Khởi tạo Database SQLite

**User Story:** Là một developer, tôi muốn bot sử dụng SQLite thay vì MongoDB, để không cần cài đặt và vận hành một database server riêng biệt.

#### Tiêu chí chấp nhận

1. WHEN bot khởi động, THE DB_Layer SHALL khởi tạo kết nối `better-sqlite3` đến file được chỉ định bởi `DatabasePath` trong `config.yml`.
2. WHEN thư mục chứa file database chưa tồn tại, THE DB_Layer SHALL tạo thư mục đó tự động trước khi mở kết nối.
3. WHEN kết nối database được mở, THE DB_Layer SHALL bật `journal_mode = WAL` và `foreign_keys = ON`.
4. WHEN bot khởi động lần đầu, THE DB_Layer SHALL chạy migration script để tạo tất cả các bảng nếu chưa tồn tại.
5. IF file database không thể mở (bị khóa, không có quyền ghi, đường dẫn không hợp lệ), THEN THE DB_Layer SHALL ghi log lỗi rõ ràng và thoát process với exit code 1.

---

### Yêu cầu 4: Schema Database — Bảng `tickets`

**User Story:** Là một Staff, tôi muốn dữ liệu ticket được lưu trữ đầy đủ và nhất quán, để tôi có thể tra cứu và xử lý ticket một cách chính xác.

#### Tiêu chí chấp nhận

1. THE DB_Layer SHALL tạo bảng `tickets` với cột `channelID` là UNIQUE NOT NULL.
2. THE DB_Layer SHALL lưu trữ các trường `questions` và `participants` dưới dạng JSON string trong cột TEXT.
3. THE DB_Layer SHALL lưu trữ các trường boolean (`claimed`, `archived`, `inactivityWarningSent`) dưới dạng INTEGER (0/1).
4. WHEN một ticket được tạo, THE DB_Layer SHALL gán giá trị mặc định `status = 'open'` và `ticketCreationDate` là thời điểm hiện tại.
5. THE DB_Layer SHALL tạo index trên các cột `guildID`, `userID`, và `status` của bảng `tickets`.
6. WHEN đọc một bản ghi ticket từ database, THE DB_Layer SHALL parse chuỗi JSON trong cột `questions` và `participants` thành mảng JavaScript.
7. IF chuỗi JSON trong cột `questions` hoặc `participants` bị corrupt, THEN THE DB_Layer SHALL trả về mảng rỗng `[]` và ghi log cảnh báo kèm `channelID` thay vì throw lỗi.

---

### Yêu cầu 5: Schema Database — Các bảng hỗ trợ

**User Story:** Là một Admin, tôi muốn tất cả dữ liệu của bot (thống kê, đánh giá, blacklist, panel, v.v.) được lưu trong SQLite, để quản lý tập trung và không phụ thuộc MongoDB.

#### Tiêu chí chấp nhận

1. THE DB_Layer SHALL tạo bảng `guild_stats` với `guildID` là PRIMARY KEY.
2. THE DB_Layer SHALL tạo bảng `staff_stats` với `userID` là UNIQUE NOT NULL, lưu các trường `weekly`, `monthly`, `yearly`, `ticketsHistory` dưới dạng JSON string.
3. THE DB_Layer SHALL tạo bảng `reviews` với ràng buộc `rating` nhận giá trị trong tập `{1, 2, 3, 4, 5}`.
4. THE DB_Layer SHALL tạo bảng `blacklisted_users` với `userId` là PRIMARY KEY.
5. THE DB_Layer SHALL tạo bảng `ticket_panels` với ràng buộc UNIQUE trên cặp `(guildID, panelId)`.
6. THE DB_Layer SHALL tạo bảng `ticket_categories` với `categoryKey` là UNIQUE NOT NULL, lưu `supportRoles`, `requiredRoles`, `questions` dưới dạng JSON string.
7. THE DB_Layer SHALL tạo bảng `suggestions` với `msgID` là UNIQUE.
8. THE DB_Layer SHALL tạo bảng `invoices` hợp nhất cả PayPal và Stripe với cột `type` phân biệt loại.
9. THE DB_Layer SHALL tạo bảng `giveaways` (cho addon Giveaways) với `messageId` là UNIQUE NOT NULL.
10. THE DB_Layer SHALL tạo bảng `sticky_messages` (cho addon StickyMessages) với `channelId` là PRIMARY KEY.

---

### Yêu cầu 6: Config động — Đọc và ghi cấu hình

**User Story:** Là một Admin, tôi muốn cấu hình bot được lưu trong database, để tôi có thể thay đổi cài đặt mà không cần sửa file và khởi động lại bot.

#### Tiêu chí chấp nhận

1. THE DB_Layer SHALL tạo bảng `guild_config` với `key` là PRIMARY KEY để lưu cấu hình dạng key-value.
2. WHEN `setConfig(key, value)` được gọi, THE Config_Store SHALL lưu giá trị dưới dạng JSON string vào bảng `guild_config`, ghi đè nếu key đã tồn tại.
3. WHEN `getConfig(key)` được gọi với một key đã tồn tại, THE Config_Store SHALL trả về giá trị đã được parse từ JSON string.
4. WHEN `getConfig(key, defaultValue)` được gọi với một key chưa tồn tại, THE Config_Store SHALL trả về `defaultValue` thay vì `null` hoặc throw lỗi.
5. THE Config_Store SHALL hỗ trợ lưu và đọc các kiểu dữ liệu: string, number, boolean, và object.
6. WHEN `getAllConfig()` được gọi, THE Config_Store SHALL trả về tất cả cặp key-value dưới dạng một object JavaScript.

---

### Yêu cầu 7: CRUD Tickets

**User Story:** Là một Staff, tôi muốn các thao tác tạo, tìm kiếm, cập nhật và xóa ticket hoạt động chính xác, để quy trình xử lý ticket không bị gián đoạn sau khi chuyển sang SQLite.

#### Tiêu chí chấp nhận

1. WHEN `Tickets.create(data)` được gọi với dữ liệu hợp lệ, THE DB_Layer SHALL chèn bản ghi vào bảng `tickets` và trả về object ticket vừa tạo.
2. WHEN `Tickets.findByChannelID(channelID)` được gọi với một `channelID` tồn tại, THE DB_Layer SHALL trả về object ticket tương ứng.
3. WHEN `Tickets.findByChannelID(channelID)` được gọi với một `channelID` không tồn tại, THE DB_Layer SHALL trả về `null`.
4. WHEN `Tickets.findOpenByUserID(userID, guildID)` được gọi, THE DB_Layer SHALL trả về mảng tất cả ticket có `status = 'open'` của user đó trong guild đó.
5. WHEN `Tickets.updateByChannelID(channelID, updates)` được gọi, THE DB_Layer SHALL cập nhật các trường được chỉ định và tự động cập nhật `updatedAt`.
6. WHEN `Tickets.deleteByChannelID(channelID)` được gọi, THE DB_Layer SHALL xóa bản ghi ticket tương ứng khỏi database.
7. WHEN `Tickets.countOpenByGuild(guildID)` được gọi, THE DB_Layer SHALL trả về số nguyên bằng đúng số lượng ticket có `status = 'open'` trong guild đó.

---

### Yêu cầu 8: Lệnh `/setup` — Cấu hình ticket

**User Story:** Là một Admin, tôi muốn cấu hình các thông số ticket qua lệnh Discord, để không cần sửa file `config.yml` và khởi động lại bot.

#### Tiêu chí chấp nhận

1. THE Setup_Command SHALL chỉ cho phép thành viên có quyền `Administrator` thực thi.
2. WHEN Admin chạy `/setup ticket maxtickets <value>`, THE Setup_Command SHALL lưu giá trị vào `Config_Store` với key `ticket.maxTickets` và phản hồi xác nhận bằng tiếng Việt.
3. WHEN Admin chạy `/setup ticket deletetime <seconds>`, THE Setup_Command SHALL lưu giá trị vào `Config_Store` với key `ticket.deleteTime` và phản hồi xác nhận bằng tiếng Việt.
4. WHEN Admin chạy `/setup ticket logschannel <channel>`, THE Setup_Command SHALL lưu ID kênh vào `Config_Store` với key `ticket.logsChannelID` và phản hồi xác nhận bằng tiếng Việt.
5. WHEN Admin chạy `/setup ticket cooldown <seconds>`, THE Setup_Command SHALL lưu giá trị vào `Config_Store` với key `ticket.cooldown` và phản hồi xác nhận bằng tiếng Việt.

---

### Yêu cầu 9: Lệnh `/setup` — Quản lý danh mục ticket

**User Story:** Là một Admin, tôi muốn tạo và quản lý danh mục ticket qua lệnh Discord, để thay thế việc cấu hình thủ công trong `config.yml`.

#### Tiêu chí chấp nhận

1. WHEN Admin chạy `/setup category create`, THE Setup_Command SHALL hướng dẫn Admin nhập thông tin danh mục và lưu vào bảng `ticket_categories`.
2. WHEN Admin chạy `/setup category list`, THE Setup_Command SHALL hiển thị danh sách tất cả danh mục ticket hiện có bằng tiếng Việt.
3. WHEN Admin chạy `/setup category edit <id>`, THE Setup_Command SHALL cho phép Admin chỉnh sửa thông tin danh mục tương ứng.
4. WHEN Admin chạy `/setup category delete <id>`, THE Setup_Command SHALL xóa danh mục tương ứng khỏi bảng `ticket_categories`.
5. WHEN một danh mục được tạo, THE Setup_Command SHALL validate rằng `categoryName` không vượt quá 80 ký tự (giới hạn Discord button).
6. WHEN một danh mục được tạo, THE Setup_Command SHALL validate rằng `buttonColor` thuộc tập `{'Blurple', 'Gray', 'Green', 'Red'}`.

---

### Yêu cầu 10: Lệnh `/setup` — Quản lý panel ticket

**User Story:** Là một Admin, tôi muốn tạo và gửi panel ticket qua lệnh Discord, để người dùng có thể tạo ticket từ panel đó.

#### Tiêu chí chấp nhận

1. WHEN Admin chạy `/setup panel create`, THE Setup_Command SHALL tạo một panel ticket mới và lưu vào bảng `ticket_panels`.
2. WHEN Admin chạy `/setup panel send <panel_id> <channel>`, THE Setup_Command SHALL gửi panel ticket đến kênh Discord được chỉ định.

---

### Yêu cầu 11: Việt hóa — Bot core và events

**User Story:** Là một người dùng Discord, tôi muốn tất cả thông báo và embed từ bot hiển thị bằng tiếng Việt, để tôi hiểu được nội dung mà không cần biết tiếng Anh.

#### Tiêu chí chấp nhận

1. THE Bot SHALL sử dụng hàm `t()` để lấy tất cả chuỗi hiển thị trong các event handler (`ticketCreate`, `ticketClose`, `ticketClaim`, v.v.).
2. WHEN một ticket được tạo, THE Bot SHALL gửi embed với tiêu đề và nội dung bằng tiếng Việt lấy từ `vi.json`.
3. WHEN một ticket được đóng, THE Bot SHALL gửi thông báo đóng ticket bằng tiếng Việt.
4. WHEN một ticket được nhận (claim), THE Bot SHALL gửi thông báo nhận ticket bằng tiếng Việt.
5. WHEN người dùng bị blacklist cố tạo ticket, THE Bot SHALL gửi thông báo bị chặn bằng tiếng Việt.
6. THE Bot SHALL không còn chứa bất kỳ chuỗi hiển thị cứng (hardcoded) nào bằng tiếng Anh trong các event handler và slash command.

---

### Yêu cầu 12: Việt hóa — Addons

**User Story:** Là một người dùng Discord, tôi muốn tất cả thông báo từ các addon (Giveaways, StickyMessages, Vouch) hiển thị bằng tiếng Việt.

#### Tiêu chí chấp nhận

1. THE Bot SHALL sử dụng hàm `t()` trong addon Vouch để hiển thị tất cả thông báo bằng tiếng Việt.
2. THE Bot SHALL sử dụng hàm `t()` trong addon Giveaways để hiển thị tất cả thông báo bằng tiếng Việt.
3. THE Bot SHALL sử dụng hàm `t()` trong addon StickyMessages để hiển thị tất cả thông báo bằng tiếng Việt.

---

### Yêu cầu 13: Chuyển đổi Addon — Giveaways và StickyMessages sang SQLite

**User Story:** Là một Admin, tôi muốn dữ liệu giveaway và sticky message được lưu trong SQLite, để không còn phụ thuộc vào MongoDB.

#### Tiêu chí chấp nhận

1. THE Bot SHALL thay thế `GiveawayModel` (Mongoose) bằng module `db/giveaways.js` (better-sqlite3) trong addon Giveaways.
2. THE Bot SHALL thay thế `StickyModel` (Mongoose) bằng module `db/sticky.js` (better-sqlite3) trong addon StickyMessages.
3. WHEN một giveaway được tạo, THE DB_Layer SHALL lưu dữ liệu vào bảng `giveaways` với `messageId` là UNIQUE.
4. WHEN một sticky message được thiết lập, THE DB_Layer SHALL lưu dữ liệu vào bảng `sticky_messages` với `channelId` là PRIMARY KEY.

---

### Yêu cầu 14: Migration từ MongoDB sang SQLite

**User Story:** Là một Admin đang vận hành bot, tôi muốn có công cụ chuyển dữ liệu từ MongoDB sang SQLite, để không mất dữ liệu lịch sử khi nâng cấp.

#### Tiêu chí chấp nhận

1. THE Migration_Script SHALL kết nối đến MongoDB qua URI được cung cấp qua biến môi trường `MONGO_URI`.
2. THE Migration_Script SHALL chuyển dữ liệu từ tất cả các collection MongoDB sang các bảng SQLite tương ứng.
3. WHEN migration đang chạy, THE Migration_Script SHALL sử dụng SQLite transaction để đảm bảo tính nguyên tử — hoặc tất cả dữ liệu được ghi, hoặc không có gì được ghi.
4. WHEN một bản ghi đã tồn tại trong SQLite, THE Migration_Script SHALL bỏ qua bản ghi đó (dùng `INSERT OR IGNORE`) thay vì báo lỗi.
5. IF kết nối MongoDB bị mất trong quá trình migration, THEN THE Migration_Script SHALL rollback transaction và không để lại dữ liệu ghi một phần.
6. WHEN migration hoàn tất, THE Migration_Script SHALL in ra số lượng bản ghi đã được chuyển cho từng collection.

---

### Yêu cầu 15: Tối giản hóa `config.yml`

**User Story:** Là một Admin mới cài đặt bot, tôi muốn file `config.yml` chỉ chứa thông tin tối thiểu cần thiết, để việc cài đặt ban đầu đơn giản hơn.

#### Tiêu chí chấp nhận

1. THE Bot SHALL chỉ yêu cầu ba trường bắt buộc trong `config.yml`: `Token`, `GuildID`, và `DatabasePath`.
2. THE Bot SHALL đọc `DatabasePath` từ `config.yml` để xác định vị trí file SQLite, với giá trị mặc định là `./data/bot.db` nếu không được chỉ định.
3. THE Bot SHALL không còn đọc cấu hình động (số ticket tối đa, cooldown, màu embed, v.v.) từ `config.yml` — tất cả cấu hình động phải được lấy từ `Config_Store`.

---

### Yêu cầu 16: Hiệu năng — Tránh block event loop

**User Story:** Là một người dùng Discord, tôi muốn bot phản hồi nhanh ngay cả khi có nhiều người dùng đồng thời, để trải nghiệm sử dụng không bị gián đoạn.

#### Tiêu chí chấp nhận

1. THE DB_Layer SHALL luôn sử dụng điều kiện `WHERE` cụ thể khi truy vấn bảng `tickets` trong các event handler tần suất cao.
2. THE DB_Layer SHALL sử dụng index đã tạo trên `guildID`, `userID`, `status` để tối ưu các truy vấn phổ biến.
3. THE DB_Layer SHALL chỉ SELECT các cột cần thiết thay vì `SELECT *` trong các hot path (ví dụ: `messageCreate` event).
