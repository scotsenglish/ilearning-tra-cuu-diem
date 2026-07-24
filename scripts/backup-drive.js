/**
 * backup-drive.js
 * ---------------------------------------------------------------------------
 * Sau mỗi lần build.py chạy xong (3 lần/ngày), gửi toàn bộ data/raw_scores.json
 * lên Apps Script (xem apps-script/Code.gs) để tự tạo 1 file .xlsx đầy đủ điểm
 * thô từng buổi (Lecture) của mọi học viên, lưu vào thư mục Drive riêng
 * "iLearning Backups" (tự tạo nếu chưa có) — cùng cơ chế đã làm cho
 * thong-ke-diem-c-Learning.
 *
 * Cần 2 biến môi trường (lấy từ GitHub Secrets):
 *   ILEARNING_APPS_SCRIPT_URL   - URL Web app sau khi Deploy Code.gs
 *   ILEARNING_APPS_SCRIPT_TOKEN - Token bí mật khớp với Script Property WRITE_TOKEN
 * Xem hướng dẫn deploy chi tiết ở đầu file apps-script/Code.gs.
 *
 * Nếu chưa cấu hình 2 biến trên, script tự bỏ qua (không làm hỏng workflow
 * chính) — để backup là tính năng optional, bật lên khi nào sẵn sàng.
 * ---------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const RAW_SCORES_PATH = path.join(ROOT, "data", "raw_scores.json");
const BRANCH_MAP_PATH = path.join(ROOT, "data", "branch_region_map.json");

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// Gộp các hoạt động (trừ "_lessonName") của 1 buổi thành 1 chuỗi dễ đọc, dạng
// "i-Build=100 | i-Imagine=100 | i-Read=90" — vừa xem được bằng mắt trong Excel,
// vừa parse ngược lại được (dùng chung ở nút "Tải file backup" trên dashboard).
function formatActivities(activities) {
  const parts = [];
  for (const [key, value] of Object.entries(activities || {})) {
    if (key === "_lessonName") continue;
    if (value === "" || value === null || value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join(" | ");
}

function buildHeadersAndRows(rawRows, branchRegionMap) {
  let maxLecture = 0;
  for (const row of rawRows) {
    for (const lecNoStr of Object.keys(row.lectures || {})) {
      const n = parseInt(lecNoStr, 10);
      if (!Number.isNaN(n) && n > maxLecture) maxLecture = n;
    }
  }

  const headers = ["Vùng", "Chi nhánh", "Program", "Syllabus", "Lớp", "Mã học viên", "Tên học viên"];
  for (let n = 1; n <= maxLecture; n++) {
    headers.push(`Buổi ${n} - Bài học`, `Buổi ${n} - Điểm`);
  }

  const rows = rawRows.map(row => {
    const branch = String(row.Branch || "").trim();
    const region = branchRegionMap[branch] || "Chưa xác định";
    const out = [
      region, branch, row.Program || "", row.Syllabus || "", row.Class || "",
      String(row.ID ?? ""), row.Name || "",
    ];
    const lectures = row.lectures || {};
    for (let n = 1; n <= maxLecture; n++) {
      const activities = lectures[String(n)] || {};
      out.push(activities._lessonName || "", formatActivities(activities));
    }
    return out;
  });

  return { headers, rows };
}

async function main() {
  const url = process.env.ILEARNING_APPS_SCRIPT_URL;
  const token = process.env.ILEARNING_APPS_SCRIPT_TOKEN;

  if (!url || !token) {
    console.log("[backup-drive] Chưa cấu hình ILEARNING_APPS_SCRIPT_URL / ILEARNING_APPS_SCRIPT_TOKEN -> bỏ qua backup.");
    return;
  }

  const rawRows = loadJson(RAW_SCORES_PATH, []);
  if (!rawRows.length) {
    console.log("[backup-drive] data/raw_scores.json rỗng -> bỏ qua backup.");
    return;
  }
  const branchRegionMap = loadJson(BRANCH_MAP_PATH, {});

  const { headers, rows } = buildHeadersAndRows(rawRows, branchRegionMap);
  console.log(`[backup-drive] Chuẩn bị gửi ${rows.length} dòng, ${headers.length} cột lên Apps Script...`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, headers, rows }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Apps Script trả về nội dung không phải JSON (status ${res.status}): ${text.slice(0, 500)}`);
  }

  if (!json.ok) {
    throw new Error(`Backup thất bại: ${json.error || "không rõ lỗi"}`);
  }

  console.log(`[backup-drive] Backup thành công: ${json.rowCount} dòng. Folder Drive: ${json.backupFolderUrl || "(không rõ URL)"}`);
}

main().catch(err => {
  console.error("[backup-drive] Lỗi:", err.message || err);
  process.exit(1);
});
