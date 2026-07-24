/**
 * Code.gs — Backup-only Apps Script cho Dashboard i-Learning
 * ---------------------------------------------------------------------------
 * KHÁC VỚI c-Learning: dashboard i-Learning KHÔNG dùng Google Sheet làm backend
 * (dữ liệu được build.py nhúng thẳng vào dashboard.html, publish qua GitHub
 * Pages). Script này CHỈ có 1 việc: mỗi lần scrape xong (3 lần/ngày), nhận dữ
 * liệu điểm thô gửi lên từ scripts/backup-drive.js, xuất ra 1 file .xlsx đầy đủ
 * (mỗi dòng = 1 học viên trong 1 lớp, các cột "Buổi N - Bài học" / "Buổi N -
 * Điểm" cho từng buổi) và lưu vào 1 thư mục Drive riêng "iLearning Backups"
 * (tự tạo nếu chưa có) — cùng cơ chế backup đã làm cho thong-ke-diem-c-Learning.
 *
 * CÁCH THIẾT LẬP:
 * 1. Vào https://script.google.com -> New project
 * 2. Xoá code mặc định, paste toàn bộ nội dung file này vào
 * 3. Vào Project Settings (icon bánh răng bên trái) -> Script Properties ->
 *    Add script property:
 *      - Tên: WRITE_TOKEN
 *      - Giá trị: 1 chuỗi bí mật tự đặt (VD dùng lệnh `openssl rand -hex 16`)
 *        — token này dùng để xác thực scripts/backup-drive.js, không cho
 *        người lạ gọi lên ghi rác vào Drive của bạn.
 * 4. Bấm Deploy -> New deployment -> chọn loại "Web app"
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Bấm Deploy -> Copy URL (dạng https://script.google.com/macros/s/.../exec)
 * 5. URL đó chính là ILEARNING_APPS_SCRIPT_URL, token ở bước 3 chính là
 *    ILEARNING_APPS_SCRIPT_TOKEN -> thêm cả 2 vào GitHub Secrets của repo
 *    (Settings -> Secrets and variables -> Actions).
 * 6. LẦN DEPLOY ĐẦU TIÊN, Google sẽ hiện màn hình xin thêm quyền truy cập
 *    Drive -> bấm "Advanced" -> "Go to (tên project) (unsafe)" -> Allow (đây
 *    là bước bảo mật bình thường của Google, không phải lỗi).
 * 7. LƯU Ý QUAN TRỌNG: mỗi lần sửa code trong editor, phải vào Deploy ->
 *    Manage deployments -> bấm nút sửa (icon bút chì) trên deployment "Web
 *    app" đang dùng -> Version: chọn "New" -> Deploy, thì Web App URL hiện tại
 *    (đang được backup-drive.js gọi tới) mới thực sự chạy code mới. Chỉ lưu
 *    (Ctrl+S) trong editor KHÔNG đủ.
 * 8. Verify nhanh không cần đợi tới lịch chạy: trong editor, chọn function
 *    "testBackupManually" ở dropdown "Select function" -> Run, rồi kiểm tra
 *    Drive có folder "iLearning Backups" chứa file .xlsx mới.
 * ---------------------------------------------------------------------------
 */

const BACKUP_FOLDER_NAME = "iLearning Backups";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const expectedToken = PropertiesService.getScriptProperties().getProperty("WRITE_TOKEN");

    if (!expectedToken) {
      return jsonOutput({ ok: false, error: "Chưa cấu hình WRITE_TOKEN trong Script Properties" });
    }
    if (body.token !== expectedToken) {
      return jsonOutput({ ok: false, error: "Token không đúng" });
    }

    const headers = Array.isArray(body.headers) ? body.headers : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!headers.length || !rows.length) {
      return jsonOutput({ ok: false, error: "Thiếu headers hoặc rows trong request" });
    }

    const folder = saveBackupSnapshot(headers, rows);

    PropertiesService.getScriptProperties().setProperty("LAST_UPDATED", new Date().toISOString());

    return jsonOutput({
      ok: true,
      rowCount: rows.length,
      colCount: headers.length,
      backupFolderUrl: folder ? folder.getUrl() : null,
    });
  } catch (err) {
    console.error("Backup thất bại: " + err);
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const lastUpdated = PropertiesService.getScriptProperties().getProperty("LAST_UPDATED") || null;
  return jsonOutput({ ok: true, lastUpdated });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateBackupFolder() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("BACKUP_FOLDER_ID");
  if (savedId) {
    try {
      const existing = DriveApp.getFolderById(savedId);
      existing.getName(); // kiểm tra folder vẫn còn tồn tại, chưa bị xoá thủ công
      return existing;
    } catch (e) {
      // ID cũ không còn hợp lệ (folder đã bị xoá) -> tạo lại bên dưới
    }
  }
  const folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty("BACKUP_FOLDER_ID", folder.getId());
  return folder;
}

// headers/rows đã được scripts/backup-drive.js chuẩn bị sẵn thành dạng bảng
// phẳng (mảng 2 chiều) — script này chỉ cần ghi thẳng vào Sheet rồi export
// .xlsx, không cần tự suy luận cấu trúc cột động (số buổi học khác nhau theo
// từng lần chạy vì scrape thêm lớp/syllabus mới).
function saveBackupSnapshot(headers, rows) {
  const tz = "Asia/Ho_Chi_Minh";
  const stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd_HHmm");
  const fileBaseName = "iLearning_Backup_" + stamp;

  const tempSs = SpreadsheetApp.create(fileBaseName);
  try {
    const sheet = tempSs.getSheets()[0];
    sheet.setName("i-Learning Raw Scores");
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    const fileId = tempSs.getId();
    const exportUrl = "https://docs.google.com/spreadsheets/d/" + fileId + "/export?format=xlsx";
    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
    });
    const blob = response.getBlob().setName(fileBaseName + ".xlsx");

    const folder = getOrCreateBackupFolder();
    // Tạo file rồi CHỦ ĐỘNG gán vào đúng folder + gỡ khỏi root — chắc chắn hơn
    // là chỉ gọi folder.createFile(blob).
    const newFile = DriveApp.createFile(blob);
    folder.addFile(newFile);
    DriveApp.getRootFolder().removeFile(newFile);
    return folder;
  } finally {
    // Chỉ giữ lại file .xlsx thật trong thư mục backup; xoá bản Google Sheet
    // tạm dùng để tạo ra nó (chuyển vào Thùng rác, tự dọn theo chính sách Google).
    DriveApp.getFileById(tempSs.getId()).setTrashed(true);
  }
}

// Chạy tay function này trong editor Apps Script để test nhanh không cần đợi
// scripts/backup-drive.js gọi lên — tạo 1 file backup mẫu với dữ liệu giả.
function testBackupManually() {
  const headers = ["Vùng", "Chi nhánh", "Program", "Syllabus", "Lớp", "Mã học viên", "Tên học viên", "Buổi 1 - Bài học", "Buổi 1 - Điểm"];
  const rows = [
    ["Vùng 1", "Chi nhánh test", "Program test", "Syllabus test", "LOP_TEST_001", "1", "Học viên test", "Book 1 > Bài test", "i-Build=100 | i-Read=90"],
  ];
  const folder = saveBackupSnapshot(headers, rows);
  Logger.log("Đã tạo file backup test trong folder: " + folder.getUrl());
}
