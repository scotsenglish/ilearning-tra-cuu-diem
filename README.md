# i-Learning — Tra cứu điểm học viên (tự động cập nhật)

Công cụ tra cứu điểm i-Learning theo Vùng / Chi nhánh / Chương trình / Syllabus /
Lecture / Tên học viên / Lớp. Dữ liệu tự động cào từ LMS 3 lần/ngày (6h, 12h, 18h
giờ VN) qua GitHub Actions, không cần ai thao tác thủ công.

## Cấu trúc

```
scripts/scrape.js     - đăng nhập LMS, build Class ID Cache, export điểm raw
scripts/build.py       - chuyển raw_scores.json -> index.html (nhúng dữ liệu)
scripts/backup-drive.js - gửi điểm raw lên Apps Script để backup .xlsx vào Google Drive
apps-script/Code.gs    - Apps Script nhận dữ liệu từ backup-drive.js, xuất .xlsx lưu vào Drive
template.html          - khung giao diện dashboard (build.py nhúng data vào đây)
data/branch_region_map.json  - bảng map Chi nhánh -> Vùng (BẠN CẦN ĐIỀN ĐỦ)
.github/workflows/daily-update.yml  - lịch chạy tự động
```

## Việc cần làm trước khi chạy lần đầu

### 1. Điền đầy đủ `data/branch_region_map.json`

File này hiện chỉ có "Scots English Tây Hồ": "Vùng 1" làm ví dụ. Bạn cần điền
Vùng cho toàn bộ ~40 chi nhánh còn lại (copy từ bảng mapping bạn đang dùng ở
các dashboard khác). Chi nhánh nào chưa điền sẽ hiện là "Chưa xác định" trên
dashboard và được cảnh báo trong log khi build.

### 2. Tạo repo GitHub mới, đẩy toàn bộ thư mục này lên

```bash
git init
git add .
git commit -m "Khởi tạo dự án tra cứu điểm i-Learning"
git branch -M main
git remote add origin https://github.com/<tài-khoản-của-bạn>/<tên-repo>.git
git push -u origin main
```

### 3. Thêm GitHub Actions Secrets

Vào repo trên GitHub → **Settings → Secrets and variables → Actions → New
repository secret**, thêm 2 secret:

| Tên secret            | Giá trị                              |
|------------------------|---------------------------------------|
| `LMS_LOGIN_ID`          | Login ID của tài khoản LMS (staff_id 9072) |
| `LMS_LOGIN_PASSWORD`    | Mật khẩu tương ứng                    |

⚠️ Không bao giờ gõ 2 giá trị này trực tiếp vào code — chỉ lưu trong Secrets.

### 4. Bật GitHub Pages

Vào **Settings → Pages** → Source chọn **"Deploy from a branch"** → Branch
chọn `main` / thư mục `/ (root)`. Sau vài phút, dashboard sẽ có ở
`https://<tài-khoản>.github.io/<tên-repo>/`.

### 5. Chạy thử thủ công lần đầu để kiểm tra

Vào tab **Actions** trên GitHub → chọn workflow **"Cập nhật điểm i-Learning tự
động"** → **Run workflow** (nút bấm tay, không cần chờ tới lịch). Theo dõi log
để chắc chắn:

- Bước "Chạy scrape.js" đăng nhập thành công, không báo lỗi selector.
- `data/run_log.json` sau khi chạy xong không có nhiều dòng trong `cache_errors`
  / `score_errors` (vài lỗi lẻ tẻ do lớp đã đóng là bình thường).
- `index.html` được commit lại với dữ liệu mới.

## Lưu ý về hiệu năng

- `scrape.js` gọi API tuần tự theo từng chi nhánh → từng lớp → từng lecture,
  giới hạn 3 luồng song song (`CONCURRENCY = 3`) và delay 150ms giữa các
  request để tránh làm quá tải LMS. Với ~1.100 lớp, lần chạy đầu có thể mất
  15–40 phút tùy tốc độ LMS phản hồi — timeout workflow đã đặt 90 phút, có thể
  tăng thêm nếu cần.
- Nếu LMS đổi giao diện đăng nhập (đổi `id` của ô username/password/nút login),
  bước đăng nhập trong `scrape.js` sẽ lỗi — cần cập nhật lại 3 dòng selector
  (`#login_id`, `#login_password`, `#btn_login`).
- Nếu số lượng học viên/lớp tăng nhiều theo thời gian, file `index.html` sẽ
  ngày càng nặng vì toàn bộ dữ liệu được nhúng thẳng vào 1 file tĩnh. Nếu thấy
  dashboard tải chậm, có thể cần tách dữ liệu ra file JSON riêng và fetch bằng
  JavaScript thay vì nhúng trực tiếp — báo lại nếu tới lúc đó cần hỗ trợ.

## Backup .xlsx tự động lên Google Drive (tuỳ chọn)

Mỗi lần workflow chạy xong (3 lần/ngày), có thể tự động xuất toàn bộ điểm thô
(đầy đủ từng buổi/Lecture) thành 1 file `.xlsx` lưu vào 1 thư mục Drive riêng
tên **"iLearning Backups"** (tự tạo nếu chưa có) — cùng cơ chế đã làm cho
dashboard c-Learning. Tính năng này optional: nếu chưa cấu hình secrets bên
dưới, bước backup tự bỏ qua, không ảnh hưởng gì tới phần cập nhật dashboard.

### Thiết lập

1. Mở file [`apps-script/Code.gs`](apps-script/Code.gs), làm theo đúng hướng
   dẫn ở phần comment đầu file (tạo Apps Script project mới, paste code vào,
   set Script Property `WRITE_TOKEN`, Deploy dạng Web app).
2. Thêm 2 secret vào repo GitHub (**Settings → Secrets and variables →
   Actions**):

   | Tên secret                    | Giá trị                                        |
   |--------------------------------|-------------------------------------------------|
   | `ILEARNING_APPS_SCRIPT_URL`    | URL Web app sau khi Deploy (bước 1)             |
   | `ILEARNING_APPS_SCRIPT_TOKEN`  | Đúng giá trị đã đặt cho `WRITE_TOKEN` (bước 1)  |

3. Chạy tay workflow (**Actions → Run workflow**) để kiểm tra bước "Backup
   .xlsx lên Google Drive" chạy thành công, rồi vào Drive kiểm tra folder
   "iLearning Backups" đã có file `iLearning_Backup_<ngày>_<giờ>.xlsx`.

### Xem lại 1 bản backup cũ trên dashboard

Trên tab **"Tra cứu chi tiết"** của dashboard có nút **"📂 Tải file backup
(.xlsx) để xem lại"** — chọn 1 file backup đã tải từ Drive về, dashboard sẽ
đọc và hiển thị lại đúng dữ liệu trong file đó. Đây CHỈ đổi dữ liệu đang xem
trong phiên trình duyệt hiện tại (không ghi gì lên GitHub/Drive) — tải lại
trang sẽ quay về dữ liệu tự động mới nhất.

## Giới hạn hiện tại (biết trước, có thể mở rộng sau)

- Cột `i-Create (2)` và `i-Boost` (chỉ xuất hiện ở 1 số lecture) được lưu đầy
  đủ trong dữ liệu và tự động hiện thêm cột nếu có, không bị mất dữ liệu.
- Không có tính năng xem xu hướng điểm theo thời gian qua nhiều lớp (đã bỏ
  theo yêu cầu) — chỉ tra cứu điểm hiện tại theo lecture.
