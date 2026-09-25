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
    let live_midi = midi::new_live_midi_queue();
    tauri::Builder::default()
        .manage(AudioService::new(live_midi.clone()))
        .manage(midi::MidiService::new(live_midi))
        .manage(media_bus)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_localhost::Builder::new(1421).build())
        .setup(|app| {
            let url = if cfg!(debug_assertions) {
                WebviewUrl::External("http://localhost:1420".parse().expect("valid Studio dev URL"))
            } else {
                WebviewUrl::App("index.html".into())
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("LumaStudio")
                .inner_size(1540.0, 980.0)
                .min_inner_size(1100.0, 720.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::audio_initialize,
            audio::audio_unit_scan,
            audio::audio_instrument_load,
            audio::audio_instrument_unload,
            audio::audio_instrument_parameters,
            audio::audio_instrument_set_parameter,
            audio::audio_instrument_save_state,
            audio::audio_instrument_send_midi,
            audio::audio_instrument_set_timeline,
            audio::audio_instrument_clear_timeline,
            audio::audio_load_pad,
            audio::audio_trigger_pad,
            audio::audio_release_pad,
            audio::audio_stop_pad,
            audio::audio_configure_pad,
            audio::audio_status,
            audio::audio_list_output_devices,
            audio::audio_select_output_device,
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
            project::project_media_status,
            video::video_open_output,
            video::video_close_output,
            video::video_fullscreen_output,
            midi::midi_scan,
            midi::midi_list_inputs,
            midi::midi_list_outputs,
            midi::midi_connect_input,
            midi::midi_connect_output,
            midi::midi_disconnect_input,
            midi::midi_disconnect_output,
            midi::midi_drain_input,
            midi::midi_record_start,
            midi::midi_record_stop,
            midi::midi_record_cancel,
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
