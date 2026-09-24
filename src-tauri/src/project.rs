use std::{fs, io::Write, path::PathBuf, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use serde::Serialize;

static WRITE_LOCK: Mutex<()> = Mutex::new(());
static SAVE_SERIAL: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileStatus { pub path: String, pub available: bool, pub bytes: u64 }

#[tauri::command]
pub fn project_media_status(paths: Vec<String>) -> Result<Vec<MediaFileStatus>, String> {
    if paths.len() > 4096 { return Err("Too many media files to check in one request.".into()); }
    Ok(paths.into_iter().map(|path| {
        let metadata = fs::metadata(&path).ok();
        let available = metadata.as_ref().is_some_and(|file| file.is_file() && file.len() > 0);
        MediaFileStatus { path, available, bytes: metadata.map_or(0, |file| file.len()) }
    }).collect())
}

#[tauri::command]
pub fn project_read(path: String) -> Result<String, String> {
    fs::read_to_string(PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn project_write(path: String, contents: String) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Project saving is unavailable after a previous failure.".to_string())?;
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = target.with_extension(format!("lumarigstudio.{}.{}.tmp", std::process::id(), SAVE_SERIAL.fetch_add(1, Ordering::Relaxed)));
    let save_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if target.exists() {
            fs::copy(&target, target.with_extension("lumarigstudio.bak")).map_err(|error| format!("Could not back up the previous project: {error}"))?;
        }
        fs::rename(&temporary, &target).map_err(|error| error.to_string())
    })();
    if save_result.is_err() { let _ = fs::remove_file(&temporary); }
    save_result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_twice_keeps_the_previous_version_as_a_backup() {
        let directory = std::env::temp_dir().join(format!("luma-save-{}-{}", std::process::id(), SAVE_SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&directory).unwrap();
        let target = directory.join("test.lumarigstudio");
        project_write(target.to_string_lossy().into_owned(), "first".into()).unwrap();
        project_write(target.to_string_lossy().into_owned(), "second".into()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
        assert_eq!(fs::read_to_string(target.with_extension("lumarigstudio.bak")).unwrap(), "first");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        fs::remove_dir_all(directory).unwrap();
    }
}
