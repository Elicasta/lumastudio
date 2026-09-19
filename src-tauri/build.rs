use std::{fs, fs::File, io::BufWriter, path::Path};

const ICON_SIZE: u32 = 512;

fn generate_icon() {
    let icon_dir = Path::new("icons");
    let icon_path = icon_dir.join("icon.png");

    fs::create_dir_all(icon_dir).expect("create Tauri icon directory");
    let file = File::create(icon_path).expect("create generated Tauri icon");
    let writer = BufWriter::new(file);

    let mut encoder = png::Encoder::new(writer, ICON_SIZE, ICON_SIZE);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);

    let mut png_writer = encoder.write_header().expect("write icon PNG header");
    let mut pixels = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    for y in 0..ICON_SIZE {
        for x in 0..ICON_SIZE {
            let i = ((y * ICON_SIZE + x) * 4) as usize;

            let dx = x as f32 - ICON_SIZE as f32 / 2.0;
            let dy = y as f32 - ICON_SIZE as f32 / 2.0;
            let radius = (dx * dx + dy * dy).sqrt();
            let vignette = (1.0 - (radius / 420.0).min(1.0)) * 10.0;

            pixels[i] = (7.0 + vignette) as u8;
            pixels[i + 1] = (16.0 + vignette) as u8;
            pixels[i + 2] = (25.0 + vignette * 1.4) as u8;
            pixels[i + 3] = 255;
        }
    }

    // Stylized LumaRig mark: two angled light beams forming an abstract L/A.
    draw_quad(
        &mut pixels,
        [(132, 378), (242, 112), (284, 112), (194, 378)],
        [56, 208, 255, 255],
        [139, 92, 246, 255],
    );
    draw_quad(
        &mut pixels,
        [(198, 378), (286, 164), (382, 378), (320, 378)],
        [139, 92, 246, 255],
        [244, 63, 194, 255],
    );
    draw_quad(
        &mut pixels,
        [(185, 330), (332, 330), (355, 378), (166, 378)],
        [45, 212, 191, 255],
        [56, 189, 248, 255],
    );

    png_writer
        .write_image_data(&pixels)
        .expect("write generated Tauri icon");
}

fn edge(a: (i32, i32), b: (i32, i32), p: (i32, i32)) -> i64 {
    (p.0 - a.0) as i64 * (b.1 - a.1) as i64
        - (p.1 - a.1) as i64 * (b.0 - a.0) as i64
}

fn inside_triangle(p: (i32, i32), a: (i32, i32), b: (i32, i32), c: (i32, i32)) -> bool {
    let e1 = edge(a, b, p);
    let e2 = edge(b, c, p);
    let e3 = edge(c, a, p);
    (e1 >= 0 && e2 >= 0 && e3 >= 0) || (e1 <= 0 && e2 <= 0 && e3 <= 0)
}

fn draw_quad(
    pixels: &mut [u8],
    points: [(i32, i32); 4],
    start: [u8; 4],
    end: [u8; 4],
) {
    let min_x = points.iter().map(|p| p.0).min().unwrap().max(0) as u32;
    let max_x = points
        .iter()
        .map(|p| p.0)
        .max()
        .unwrap()
        .min(ICON_SIZE as i32 - 1) as u32;
    let min_y = points.iter().map(|p| p.1).min().unwrap().max(0) as u32;
    let max_y = points
        .iter()
        .map(|p| p.1)
        .max()
        .unwrap()
        .min(ICON_SIZE as i32 - 1) as u32;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let p = (x as i32, y as i32);
            let inside = inside_triangle(p, points[0], points[1], points[2])
                || inside_triangle(p, points[0], points[2], points[3]);

            if !inside {
                continue;
            }

            let t = x as f32 / ICON_SIZE as f32;
            let color = [
                (start[0] as f32 * (1.0 - t) + end[0] as f32 * t) as u8,
                (start[1] as f32 * (1.0 - t) + end[1] as f32 * t) as u8,
                (start[2] as f32 * (1.0 - t) + end[2] as f32 * t) as u8,
                255,
            ];

            let i = ((y * ICON_SIZE + x) * 4) as usize;
            pixels[i..i + 4].copy_from_slice(&color);
        }
    }
}

fn main() {
    generate_icon();
    tauri_build::build();
}
