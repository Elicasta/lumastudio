use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::time::Duration;

const PCO_BASE: &str = "https://api.planningcenteronline.com/services/v2";

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(2))
        .user_agent("LumaStudio/0.4 (desktop integration)")
        .build()
        .map_err(|error| error.to_string())
}

fn propresenter_base(host: &str, port: u16) -> Result<String, String> {
    let normalized = host
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/');

    if normalized.is_empty() {
        return Err("ProPresenter host cannot be empty.".into());
    }
    if port == 0 {
        return Err("ProPresenter port must be between 1 and 65535.".into());
    }

    Ok(format!("http://{}:{}", normalized, port))
}

async fn get_json(client: &Client, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach {}: {}", url, error))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "{} returned HTTP {}{}",
            url,
            status.as_u16(),
            if body.is_empty() { String::new() } else { format!(": {}", body) }
        ));
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("{} returned invalid JSON: {}", url, error))
}

async fn get_optional_json(client: &Client, url: &str) -> Result<Option<Value>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach {}: {}", url, error))?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "{} returned HTTP {}{}",
            url,
            status.as_u16(),
            if body.is_empty() { String::new() } else { format!(": {}", body) }
        ));
    }

    response
        .json::<Value>()
        .await
        .map(Some)
        .map_err(|error| format!("{} returned invalid JSON: {}", url, error))
}

async fn trigger_get(client: &Client, url: &str) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach {}: {}", url, error))?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }

    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "{} returned HTTP {}{}",
        url,
        status.as_u16(),
        if body.is_empty() { String::new() } else { format!(": {}", body) }
    ))
}

#[tauri::command]
pub async fn propresenter_snapshot(host: String, port: u16) -> Result<Value, String> {
    let client = http_client()?;
    let base = propresenter_base(&host, port)?;

    let version = get_json(&client, &format!("{}/version", base)).await?;
    let active = get_optional_json(&client, &format!("{}/v1/presentation/active", base)).await?;
    let slide_index =
        get_optional_json(&client, &format!("{}/v1/presentation/slide_index", base)).await?;
    let status_slide = get_optional_json(&client, &format!("{}/v1/status/slide", base)).await?;

    Ok(json!({
        "version": version,
        "active": active,
        "slideIndex": slide_index,
        "statusSlide": status_slide
    }))
}

#[tauri::command]
pub async fn propresenter_next(host: String, port: u16) -> Result<(), String> {
    let client = http_client()?;
    let base = propresenter_base(&host, port)?;
    trigger_get(&client, &format!("{}/v1/presentation/active/next/trigger", base)).await
}

#[tauri::command]
pub async fn propresenter_previous(host: String, port: u16) -> Result<(), String> {
    let client = http_client()?;
    let base = propresenter_base(&host, port)?;
    trigger_get(
        &client,
        &format!("{}/v1/presentation/active/previous/trigger", base),
    )
    .await
}

#[tauri::command]
pub async fn propresenter_trigger_group(
    host: String,
    port: u16,
    group: String,
) -> Result<(), String> {
    let client = http_client()?;
    let base = propresenter_base(&host, port)?;
    if group.trim().is_empty() {
        return Err("ProPresenter group cannot be empty.".into());
    }
    let encoded = urlencoding::encode(group.trim());
    trigger_get(
        &client,
        &format!("{}/v1/presentation/active/group/{}/trigger", base, encoded),
    )
    .await
}

async fn pco_get(client: &Client, url: &str, client_id: &str, secret: &str) -> Result<Value, String> {
    if client_id.trim().is_empty() || secret.trim().is_empty() {
        return Err("Planning Center App ID and secret are required.".into());
    }

    let response = client
        .get(url)
        .basic_auth(client_id.trim(), Some(secret.trim()))
        .send()
        .await
        .map_err(|error| format!("Could not reach Planning Center: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(match status {
            StatusCode::UNAUTHORIZED => {
                "Planning Center rejected the Personal Access Token. Check the App ID and secret.".into()
            }
            StatusCode::FORBIDDEN => {
                "Planning Center denied access. Confirm this token can access Services.".into()
            }
            _ => format!(
                "Planning Center returned HTTP {}{}",
                status.as_u16(),
                if body.is_empty() { String::new() } else { format!(": {}", body) }
            ),
        });
    }

    response
        .json::<Value>()
        .await
        .map_err(|error| format!("Planning Center returned invalid JSON: {}", error))
}

async fn pco_collection(
    client: &Client,
    first_url: String,
    client_id: &str,
    secret: &str,
) -> Result<Value, String> {
    let mut next = Some(first_url);
    let mut data = Vec::<Value>::new();
    let mut included = Vec::<Value>::new();
    let mut page_count = 0usize;

    while let Some(url) = next.take() {
        page_count += 1;
        if page_count > 25 {
            return Err("Planning Center pagination exceeded the safety limit.".into());
        }

        let page = pco_get(client, &url, client_id, secret).await?;
        if let Some(values) = page.get("data").and_then(Value::as_array) {
            data.extend(values.iter().cloned());
        }
        if let Some(values) = page.get("included").and_then(Value::as_array) {
            included.extend(values.iter().cloned());
        }

        next = page
            .get("links")
            .and_then(|links| links.get("next"))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }

    Ok(json!({ "data": data, "included": included }))
}

#[tauri::command]
pub async fn planning_center_service_types(
    client_id: String,
    secret: String,
) -> Result<Value, String> {
    let client = http_client()?;
    pco_collection(
        &client,
        format!("{}/service_types?per_page=100&order=name", PCO_BASE),
        &client_id,
        &secret,
    )
    .await
}

#[tauri::command]
pub async fn planning_center_plans(
    client_id: String,
    secret: String,
    service_type_id: String,
) -> Result<Value, String> {
    let client = http_client()?;
    let service_type_id = urlencoding::encode(service_type_id.trim());

    let future = pco_collection(
        &client,
        format!(
            "{}/service_types/{}/plans?filter=future&order=sort_date&per_page=100",
            PCO_BASE, service_type_id
        ),
        &client_id,
        &secret,
    )
    .await?;

    let past = pco_collection(
        &client,
        format!(
            "{}/service_types/{}/plans?filter=past&order=-sort_date&per_page=20",
            PCO_BASE, service_type_id
        ),
        &client_id,
        &secret,
    )
    .await?;

    Ok(json!({ "future": future, "past": past }))
}

#[tauri::command]
pub async fn planning_center_plan(
    client_id: String,
    secret: String,
    service_type_id: String,
    plan_id: String,
) -> Result<Value, String> {
    let client = http_client()?;
    let service_type_id = urlencoding::encode(service_type_id.trim());
    let plan_id = urlencoding::encode(plan_id.trim());
    let root = format!("{}/service_types/{}/plans/{}", PCO_BASE, service_type_id, plan_id);

    let plan = pco_get(&client, &root, &client_id, &secret).await?;
    let items = pco_collection(
        &client,
        format!(
            "{}/items?include=song,arrangement,key&per_page=100",
            root
        ),
        &client_id,
        &secret,
    )
    .await?;

    Ok(json!({ "plan": plan, "items": items }))
}
