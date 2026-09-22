use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn video_open_output(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("video-output") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = if cfg!(debug_assertions) {
        "http://localhost:1420/?surface=video-output".parse().map_err(|e| format!("Invalid video output URL: {e}"))?
    } else {
        "http://127.0.0.1:1421/?surface=video-output".parse().map_err(|e| format!("Invalid video output URL: {e}"))?
    };
    WebviewWindowBuilder::new(&app, "video-output", WebviewUrl::External(url))
        .title("LumaRig Studio Program")
        .inner_size(1280.0, 720.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn video_close_output(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("video-output") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn video_fullscreen_output(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    let window = app.get_webview_window("video-output").ok_or("Program output is not open")?;
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}
