import { useMemo, useState } from "react";
import type { IntegrationSettings } from "../domain/integrations";
import type { Song } from "../domain/types";
import type { ProPresenterController } from "../hooks/useProPresenter";
import {
  normalizeProPresenterName
} from "../services/propresenter";
import {
  loadPlanningCenterPlan,
  loadPlanningCenterPlans,
  loadPlanningCenterServiceTypes,
  mapPlanningCenterPlan,
  parsePlanningCenterPlans,
  parsePlanningCenterServiceTypes,
  type PlanningCenterCredentials,
  type PlanningCenterPlanImport,
  type PlanningCenterPlanSummary,
  type PlanningCenterServiceType
} from "../services/planningCenter";

export function IntegrationsPage({
  settings,
  proPresenter,
  selectedSong,
  existingSongs,
  onSettingsChange,
  onPlanningCenterImport
}: {
  settings: IntegrationSettings;
  proPresenter: ProPresenterController;
  selectedSong: Song;
  existingSongs: Song[];
  onSettingsChange: (settings: IntegrationSettings) => void;
  onPlanningCenterImport: (value: PlanningCenterPlanImport) => void;
}) {
  const [pcoCredentials, setPcoCredentials] = useState<PlanningCenterCredentials>({ clientId: "", secret: "" });
  const [serviceTypes, setServiceTypes] = useState<PlanningCenterServiceType[]>([]);
  const [plans, setPlans] = useState<PlanningCenterPlanSummary[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState(settings.planningCenter?.serviceTypeId ?? "");
  const [planId, setPlanId] = useState(settings.planningCenter?.planId ?? "");
  const [planPreview, setPlanPreview] = useState<PlanningCenterPlanImport | null>(null);
  const [keepUnmatched, setKeepUnmatched] = useState(true);
  const [pcoBusy, setPcoBusy] = useState(false);
  const [pcoError, setPcoError] = useState("");

  const pp = settings.propresenter;
  const presenterSongMatches = useMemo(() => {
    if (!proPresenter.state.presentationName) return false;
    return normalizeProPresenterName(proPresenter.state.presentationName)
      === normalizeProPresenterName(selectedSong.title);
  }, [proPresenter.state.presentationName, selectedSong.title]);

  function patchProPresenter(patch: Partial<typeof pp>) {
    onSettingsChange({
      ...settings,
      propresenter: { ...pp, ...patch }
    });
  }

  async function connectPlanningCenter() {
    setPcoBusy(true);
    setPcoError("");
    setPlanPreview(null);
    try {
      const raw = await loadPlanningCenterServiceTypes(pcoCredentials);
      const types = parsePlanningCenterServiceTypes(raw);
      setServiceTypes(types);
      const preferred = types.find((type) => type.id === serviceTypeId) ?? types[0];
      if (preferred) {
        setServiceTypeId(preferred.id);
        await refreshPlans(preferred.id);
      }
    } catch (cause) {
      setPcoError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPcoBusy(false);
    }
  }

  async function refreshPlans(nextServiceTypeId = serviceTypeId) {
    if (!nextServiceTypeId) return;
    setPcoBusy(true);
    setPcoError("");
    setPlanPreview(null);
    try {
      const raw = await loadPlanningCenterPlans(pcoCredentials, nextServiceTypeId);
      const nextPlans = parsePlanningCenterPlans(raw);
      setPlans(nextPlans);
      const preferred = nextPlans.find((plan) => plan.id === planId) ?? nextPlans.find((plan) => !plan.past) ?? nextPlans[0];
      setPlanId(preferred?.id ?? "");
    } catch (cause) {
      setPcoError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPcoBusy(false);
    }
  }

  async function previewPlan() {
    const serviceType = serviceTypes.find((type) => type.id === serviceTypeId);
    if (!serviceType || !planId) return;
    setPcoBusy(true);
    setPcoError("");
    try {
      const raw = await loadPlanningCenterPlan(pcoCredentials, serviceType.id, planId);
      setPlanPreview(mapPlanningCenterPlan(raw, serviceType, existingSongs, keepUnmatched));
    } catch (cause) {
      setPcoError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPcoBusy(false);
    }
  }

  return (
    <section className="integrations-page">
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p>Let Studio follow the service plan and keep ProPresenter in sync without replacing either system.</p>
        </div>
      </div>

      <div className="integration-grid">
        <div className="panel integration-card">
          <div className="integration-card-head">
            <div>
              <small>PRESENTATION</small>
              <h2>ProPresenter</h2>
              <p>Bidirectional local API connection. MIDI remains available as a fallback.</p>
            </div>
            <span className={proPresenter.state.connected ? "integration-status ready" : "integration-status"}>
              {proPresenter.state.connected ? "CONNECTED" : pp.enabled ? "OFFLINE" : "DISABLED"}
            </span>
          </div>

          <div className="integration-fields">
            <label>
              <span>Host</span>
              <input
                value={pp.host}
                onChange={(event) => patchProPresenter({ host: event.currentTarget.value })}
                placeholder="127.0.0.1"
              />
            </label>
            <label>
              <span>Port</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={pp.port}
                onChange={(event) => patchProPresenter({
                  port: Math.max(1, Math.min(65535, Number(event.currentTarget.value) || 50001))
                })}
              />
            </label>
          </div>

          <div className="integration-toggle-row">
            <label>
              <input
                type="checkbox"
                checked={pp.enabled}
                onChange={(event) => patchProPresenter({ enabled: event.currentTarget.checked })}
              />
              Enable ProPresenter API
            </label>
            <label>
              <input
                type="checkbox"
                checked={pp.followSections}
                disabled={!pp.enabled}
                onChange={(event) => patchProPresenter({ followSections: event.currentTarget.checked })}
              />
              Follow Studio sections
            </label>
            <button disabled={!pp.enabled} onClick={() => void proPresenter.refresh()}>Refresh State</button>
          </div>

          {proPresenter.state.error && <div className="error-banner">{proPresenter.state.error}</div>}

          <div className="presenter-state">
            <div>
              <small>STUDIO</small>
              <strong>{selectedSong.title}</strong>
              <span>{selectedSong.sections.length} sections</span>
            </div>
            <div className={presenterSongMatches ? "state-link matched" : "state-link"}>
              {presenterSongMatches ? "SYNC" : "CHECK"}
            </div>
            <div>
              <small>PROPRESENTER</small>
              <strong>{proPresenter.state.presentationName ?? "No active presentation"}</strong>
              <span>
                {proPresenter.state.currentGroup ?? "No group"}
                {proPresenter.state.slideIndex !== undefined ? ` · Slide ${proPresenter.state.slideIndex + 1}` : ""}
              </span>
            </div>
          </div>

          {proPresenter.state.connected && !presenterSongMatches && proPresenter.state.presentationName && (
            <div className="integration-warning">
              Auto-follow is held because ProPresenter is on a different presentation. Studio will not fire section changes into the wrong song.
            </div>
          )}

          <div className="presenter-controls">
            <button disabled={!proPresenter.state.connected} onClick={() => void proPresenter.previous()}>Previous Slide</button>
            <button className="primary" disabled={!proPresenter.state.connected} onClick={() => void proPresenter.next()}>Next Slide</button>
          </div>

          <div className="presenter-groups">
            {proPresenter.state.groups.length === 0 && <span>No ProPresenter groups available.</span>}
            {proPresenter.state.groups.map((group) => (
              <button
                key={group.index}
                className={group.name === proPresenter.state.currentGroup ? "active" : ""}
                disabled={!proPresenter.state.connected}
                onClick={() => void proPresenter.triggerGroup(group.name)}
              >
                {group.name}
                <small>{group.slideCount} slides</small>
              </button>
            ))}
          </div>

          <p className="integration-footnote">
            In ProPresenter, enable Network/API access and use the port shown there. The default is 50001.
          </p>
        </div>

        <div className="panel integration-card">
          <div className="integration-card-head">
            <div>
              <small>SERVICE SOURCE</small>
              <h2>Planning Center</h2>
              <p>Pull upcoming Services plans into Studio and keep your existing song builds intact.</p>
            </div>
            <span className={settings.planningCenter ? "integration-status ready" : "integration-status"}>
              {settings.planningCenter ? "LINKED" : "NOT LINKED"}
            </span>
          </div>

          <div className="integration-fields pco-auth">
            <label>
              <span>Personal Access Token App ID</span>
              <input
                value={pcoCredentials.clientId}
                onChange={(event) => setPcoCredentials((current) => ({ ...current, clientId: event.currentTarget.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Secret</span>
              <input
                type="password"
                value={pcoCredentials.secret}
                onChange={(event) => setPcoCredentials((current) => ({ ...current, secret: event.currentTarget.value }))}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="integration-toggle-row">
            <button
              className="primary"
              disabled={pcoBusy || !pcoCredentials.clientId || !pcoCredentials.secret}
              onClick={() => void connectPlanningCenter()}
            >
              {pcoBusy ? "Loading…" : "Connect Planning Center"}
            </button>
            <span>Credentials stay in memory for this app session and are not written to the Studio project.</span>
          </div>

          {pcoError && <div className="error-banner">{pcoError}</div>}

          {serviceTypes.length > 0 && (
            <div className="pco-picker">
              <label>
                <span>Service Type</span>
                <select
                  value={serviceTypeId}
                  onChange={(event) => {
                    const id = event.currentTarget.value;
                    setServiceTypeId(id);
                    setPlanId("");
                    void refreshPlans(id);
                  }}
                >
                  {serviceTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <label>
                <span>Plan</span>
                <select value={planId} onChange={(event) => { setPlanId(event.currentTarget.value); setPlanPreview(null); }}>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.past ? "Recent · " : ""}{plan.dates || plan.title}{plan.title && plan.title !== plan.dates ? ` · ${plan.title}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="keep-unmatched">
                <input
                  type="checkbox"
                  checked={keepUnmatched}
                  onChange={(event) => { setKeepUnmatched(event.currentTarget.checked); setPlanPreview(null); }}
                />
                Keep Studio songs not in this plan
              </label>
              <button disabled={pcoBusy || !planId} onClick={() => void previewPlan()}>Preview Service</button>
            </div>
          )}

          {planPreview && (
            <div className="pco-preview">
              <div className="pco-preview-head">
                <div>
                  <small>READY TO IMPORT</small>
                  <strong>{planPreview.link.planDates || planPreview.link.planTitle}</strong>
                  <span>{planPreview.link.items.length} plan items · {planPreview.songs.length} Studio songs after merge</span>
                </div>
                <button className="primary" onClick={() => onPlanningCenterImport(planPreview)}>Apply to Studio</button>
              </div>
              <div className="pco-items">
                {planPreview.link.items.map((item) => (
                  <div key={item.id} className={item.itemType === "song" ? "pco-item song" : "pco-item"}>
                    <span>{item.itemType.toUpperCase()}</span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.key ? `Key ${item.key}` : ""}
                      {item.arrangementSequence?.length ? ` · ${item.arrangementSequence.join(" → ")}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {settings.planningCenter && !planPreview && (
            <div className="linked-plan">
              <small>LAST LINKED PLAN</small>
              <strong>{settings.planningCenter.planDates || settings.planningCenter.planTitle}</strong>
              <span>{settings.planningCenter.serviceTypeName} · synced {new Date(settings.planningCenter.lastSyncedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
