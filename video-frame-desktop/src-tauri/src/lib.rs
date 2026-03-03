use chrono::Utc;
use regex::Regex;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
struct FrameItem {
    file: String,
    second: f64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Metadata {
    job_id: String,
    source_video: String,
    created_at: String,
    frame_interval_sec: f64,
    frame_count: usize,
    frames: Vec<FrameItem>,
}

#[derive(Serialize, Clone)]
struct ProcessResult {
    job_id: String,
    output_dir: String,
    metadata_path: String,
    frame_count: usize,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    progress: f64,
    message: String,
}

#[derive(Serialize, Clone)]
struct SelectedFileInfo {
    path: String,
    size: u64,
}

fn inspect_path(input_path: &str) -> Result<SelectedFileInfo, String> {
    let input = Path::new(input_path);
    if !input.exists() {
        return Err(format!("找不到檔案：{}", input_path));
    }

    if !input.is_file() {
        return Err(format!("不是可讀取的檔案：{}", input_path));
    }

    let ext = input
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext != "mp4" {
        return Err("目前僅支援 mp4 檔案".into());
    }

    let meta = fs::metadata(input).map_err(|e| format!("無法讀取檔案資訊：{e}"))?;
    let canonical = fs::canonicalize(input).map_err(|e| format!("無法解析檔案路徑：{e}"))?;

    Ok(SelectedFileInfo {
        path: canonical.to_string_lossy().to_string(),
        size: meta.len(),
    })
}

fn run_ffprobe_duration(input_path: &str) -> Option<f64> {
    let output = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(input_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<f64>().ok()
}

#[tauri::command]
fn inspect_video_file(input_path: String) -> Result<SelectedFileInfo, String> {
    inspect_path(&input_path)
}

#[tauri::command]
fn pick_video_file() -> Result<Option<SelectedFileInfo>, String> {
    let selected = FileDialog::new()
        .add_filter("MP4 Video", &["mp4"])
        .pick_file();

    selected
        .map(|path| inspect_path(path.to_string_lossy().as_ref()))
        .transpose()
}

fn process_video_internal<F>(input_path: &str, mut emit_progress: F) -> Result<ProcessResult, String>
where
    F: FnMut(ProgressPayload),
{
    let inspected = inspect_path(&input_path)?;
    let input_path = inspected.path;
    let input = Path::new(&input_path);

    let job_id = Uuid::new_v4().to_string();
    let base_out = input
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{}_output", input.file_stem().unwrap_or_default().to_string_lossy()));
    let output_dir = base_out.join(&job_id).join("frames");
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let duration = run_ffprobe_duration(&input_path).unwrap_or(0.0);

    emit_progress(ProgressPayload {
        progress: 0.0,
        message: "FFmpeg 擷取中...".into(),
    });

    let mut child = Command::new("ffmpeg")
        .arg("-i")
        .arg(&input_path)
        .arg("-vf")
        .arg("fps=2/3")
        .arg(output_dir.join("frame_%05d.jpg"))
        .arg("-y")
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    let stderr = child.stderr.take().ok_or("cannot read ffmpeg stderr")?;
    let reader = BufReader::new(stderr);
    let re = Regex::new(r"time=(\d+):(\d+):(\d+\.?\d*)").map_err(|e| e.to_string())?;

    for line in reader.lines().map_while(Result::ok) {
        if let Some(cap) = re.captures(&line) {
            let hh = cap[1].parse::<f64>().unwrap_or(0.0);
            let mm = cap[2].parse::<f64>().unwrap_or(0.0);
            let ss = cap[3].parse::<f64>().unwrap_or(0.0);
            let current_sec = hh * 3600.0 + mm * 60.0 + ss;
            let pct = if duration > 0.0 {
                (current_sec / duration * 100.0).clamp(0.0, 99.0)
            } else {
                0.0
            };

            emit_progress(ProgressPayload {
                progress: pct,
                message: format!("處理中 {:.1}%", pct),
            });
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("ffmpeg failed".into());
    }

    let mut frame_files: Vec<PathBuf> = fs::read_dir(&output_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|entry| entry.path()))
        .filter(|p| p.extension().map(|s| s == "jpg").unwrap_or(false))
        .collect();
    frame_files.sort();

    let frames: Vec<FrameItem> = frame_files
        .iter()
        .enumerate()
        .map(|(idx, p)| FrameItem {
            file: p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            second: idx as f64 * 1.5,
        })
        .collect();

    let metadata = Metadata {
        job_id: job_id.clone(),
        source_video: input_path.clone(),
        created_at: Utc::now().to_rfc3339(),
        frame_interval_sec: 1.5,
        frame_count: frames.len(),
        frames,
    };

    let metadata_path = output_dir
        .parent()
        .unwrap_or(&output_dir)
        .join("metadata.json");
    fs::write(
        &metadata_path,
        serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    emit_progress(ProgressPayload {
        progress: 100.0,
        message: "處理完成".into(),
    });

    Ok(ProcessResult {
        job_id,
        output_dir: output_dir
            .parent()
            .unwrap_or(&output_dir)
            .to_string_lossy()
            .to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        frame_count: metadata.frame_count,
    })
}

#[tauri::command]
fn process_video(app: AppHandle, input_path: String) -> Result<ProcessResult, String> {
    process_video_internal(&input_path, |payload| {
        app.emit("process-progress", payload).ok();
    })
}

#[tauri::command]
fn mock_submit_ai(endpoint: String, token: String, metadata_path: String) -> Result<String, String> {
    if endpoint.trim().is_empty() {
        return Err("請先在設定頁填寫 endpoint".into());
    }

    let token_hint = if token.is_empty() {
        "(no token)".to_string()
    } else {
        format!("(token {} chars)", token.len())
    };

    std::thread::sleep(std::time::Duration::from_millis(700));

    Ok(format!(
        "Mock sent {} to {} {}",
        metadata_path, endpoint, token_hint
    ))
}

#[tauri::command]
fn open_output_dir(output_dir: String) -> Result<(), String> {
    let path = Path::new(&output_dir);

    if !path.exists() {
        return Err(format!(
            "找不到輸出資料夾，可能已被移動或刪除：{}",
            output_dir
        ));
    }

    if !path.is_dir() {
        return Err(format!("輸出路徑不是資料夾：{}", output_dir));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("無法開啟 Windows 檔案總管：{e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("無法開啟 Finder：{e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("無法開啟資料夾：{e}"))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_video_file,
            inspect_video_file,
            process_video,
            mock_submit_ai,
            open_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
