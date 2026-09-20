mod audio;

use audio::AudioService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioService::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            audio::audio_initialize,
            audio::audio_status,
            audio::audio_load_wav_song,
            audio::audio_play,
            audio::audio_pause,
            audio::audio_stop,
            audio::audio_seek,
            audio::audio_set_loop,
            audio::audio_clear_loop,
            audio::audio_set_track_gain,
            audio::audio_set_track_muted,
            audio::audio_set_track_solo,
            audio::audio_schedule_transition,
            audio::audio_cancel_transition
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaRig Studio");
}
