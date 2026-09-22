mod audio;
mod project;
mod video;
mod midi;
mod integrations;
mod media_bus;

use audio::AudioService;
use tauri::{webview::WebviewWindowBuilder, WebviewUrl};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let media_bus=media_bus::MediaBus::default();
    media_bus.start();
    tauri::Builder::default()
        .manage(AudioService::default())
        .manage(midi::MidiService::default())
        .manage(media_bus)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_localhost::Builder::new(1421).build())
        .setup(|app| {
            let url = if cfg!(debug_assertions) {
                "http://localhost:1420".parse().expect("valid Studio dev URL")
            } else {
                "http://127.0.0.1:1421".parse().expect("valid Studio localhost URL")
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("LumaRig Studio")
                .inner_size(1540.0, 980.0)
                .min_inner_size(1100.0, 720.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::audio_initialize,
            audio::audio_load_pad,
            audio::audio_trigger_pad,
            audio::audio_release_pad,
            audio::audio_stop_pad,
            audio::audio_configure_pad,
            audio::audio_status,
            audio::audio_load_wav_song,
            audio::audio_load_voice_pack,
            audio::audio_set_guide_timeline,
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
            audio::audio_set_bus_gain,
            audio::audio_set_bus_muted,
            audio::audio_set_bus_route,
            audio::audio_cancel_transition,
            project::project_read,
            project::project_write,
            video::video_open_output,
            video::video_close_output,
            video::video_fullscreen_output,
            midi::midi_list_outputs,
            midi::midi_connect_output,
            midi::midi_disconnect_output,
            midi::midi_send,
            midi::midi_program_change,
            midi::midi_control_change,
            media_bus::lumaviz_media_publish,
            integrations::lumalink_discover,
            integrations::propresenter_snapshot,
            integrations::propresenter_next,
            integrations::propresenter_previous,
            integrations::propresenter_trigger_group,
            integrations::planning_center_service_types,
            integrations::planning_center_plans,
            integrations::planning_center_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaRig Studio");
}
