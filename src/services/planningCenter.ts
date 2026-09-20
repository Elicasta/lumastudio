import { invoke } from "@tauri-apps/api/core";
import type { PlanningCenterLink, PlanningCenterPlanItemSnapshot } from "../domain/integrations";
import type { Section, Song } from "../domain/types";

export interface PlanningCenterCredentials {
  clientId: string;
  secret: string;
}

export interface PlanningCenterServiceType {
  id: string;
  name: string;
}

export interface PlanningCenterPlanSummary {
  id: string;
  title: string;
  dates?: string;
  sortDate?: string;
  past: boolean;
}

export interface PlanningCenterPlanImport {
  link: PlanningCenterLink;
  songs: Song[];
}

type Resource = {
  id: string;
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, { data?: { id?: string; type?: string } | null }>;
};

type Collection = { data?: Resource[]; included?: Resource[] };
type PlansResponse = { future?: Collection; past?: Collection };
type PlanResponse = { plan?: { data?: Resource }; items?: Collection };

const colors = ["#60a5fa", "#fb7185", "#a78bfa", "#34d399", "#facc15", "#38bdf8"];

function normalized(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function sequence(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function meter(value: unknown): [number, number] {
  if (typeof value === "string") {
    const match = value.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  return [4, 4];
}

function relationshipId(item: Resource, name: string) {
  return item.relationships?.[name]?.data?.id;
}

function includedIndex(resources: Resource[] = []) {
  return new Map(resources.map((resource) => [`${resource.type}:${resource.id}`, resource]));
}

function related(index: Map<string, Resource>, type: string, id?: string) {
  if (!id) return undefined;
  return index.get(`${type}:${id}`);
}

function makeSections(names: string[]): Section[] {
  const source = names.length > 0 ? names : ["Song"];
  let startBar = 1;
  return source.map((name, index) => {
    const item: Section = {
      id: crypto.randomUUID(),
      name,
      startBar,
      lengthBars: 8,
      color: colors[index % colors.length]
    };
    startBar += item.lengthBars;
    return item;
  });
}

function newPlanningCenterSong(
  item: Resource,
  songResource: Resource | undefined,
  arrangement: Resource | undefined,
  keyResource: Resource | undefined
): Song {
  const attrs = item.attributes ?? {};
  const arrangementAttrs = arrangement?.attributes ?? {};
  const songAttrs = songResource?.attributes ?? {};
  const songId = relationshipId(item, "song");
  const arrangementId = relationshipId(item, "arrangement");
  const keyId = relationshipId(item, "key");
  const arrangementSequence = sequence(
    attrs.custom_arrangement_sequence ?? arrangementAttrs.sequence
  );
  const title = String(attrs.title || songAttrs.title || "Untitled Song");
  const bpm = Number(arrangementAttrs.bpm);
  const length = Number(attrs.length || arrangementAttrs.length);

  return {
    id: crypto.randomUUID(),
    title,
    artist: String(songAttrs.author || songAttrs.artist || "Planning Center"),
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 120,
    key: String(attrs.key_name || keyResource?.attributes?.name || ""),
    meter: meter(arrangementAttrs.meter),
    durationSeconds: Number.isFinite(length) && length > 0 ? length : 240,
    status: "needs-review",
    countIn: { mode: "bars", value: 1 },
    manualJumpCountIn: { mode: "adaptive", minBeats: 2 },
    guideVoice: {
      voicePackId: "core-en-neutral-f",
      outputMode: "voice-and-click",
      sectionCues: "automatic",
      announceFirstSection: true,
      voiceFinalBarOnly: true,
      countFeel: "notated"
    },
    guideMarkers: [],
    tracks: [],
    sections: makeSections(arrangementSequence),
    external: {
      planningCenterSongId: songId,
      planningCenterArrangementId: arrangementId,
      planningCenterPlanItemId: item.id,
      planningCenterKeyId: keyId,
      planningCenterSequence: arrangementSequence
    }
  };
}

function mergeExistingSong(existing: Song, incoming: Song): Song {
  return {
    ...existing,
    key: incoming.key || existing.key,
    external: {
      ...existing.external,
      ...incoming.external
    }
  };
}

export function parsePlanningCenterServiceTypes(raw: Collection): PlanningCenterServiceType[] {
  return (raw.data ?? [])
    .map((resource) => ({
      id: resource.id,
      name: String(resource.attributes?.name || "Service Type")
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parsePlanningCenterPlans(raw: PlansResponse): PlanningCenterPlanSummary[] {
  const map = (collection: Collection | undefined, past: boolean) =>
    (collection?.data ?? []).map((resource) => ({
      id: resource.id,
      title: String(resource.attributes?.title || resource.attributes?.dates || "Untitled Plan"),
      dates: resource.attributes?.dates ? String(resource.attributes.dates) : undefined,
      sortDate: resource.attributes?.sort_date ? String(resource.attributes.sort_date) : undefined,
      past
    }));

  return [...map(raw.future, false), ...map(raw.past, true)]
    .sort((a, b) => {
      if (a.past !== b.past) return a.past ? 1 : -1;
      const left = a.sortDate ? Date.parse(a.sortDate) : 0;
      const right = b.sortDate ? Date.parse(b.sortDate) : 0;
      return a.past ? right - left : left - right;
    });
}

export function mapPlanningCenterPlan(
  raw: PlanResponse,
  serviceType: PlanningCenterServiceType,
  existingSongs: Song[],
  keepUnmatched = true
): PlanningCenterPlanImport {
  const plan = raw.plan?.data;
  if (!plan) throw new Error("Planning Center did not return the selected plan.");

  const items = [...(raw.items?.data ?? [])]
    .sort((a, b) => Number(a.attributes?.sequence ?? 0) - Number(b.attributes?.sequence ?? 0));
  const included = includedIndex(raw.items?.included ?? []);

  const snapshots: PlanningCenterPlanItemSnapshot[] = items.map((item) => {
    const attrs = item.attributes ?? {};
    const arrangementId = relationshipId(item, "arrangement");
    const arrangement = related(included, "Arrangement", arrangementId)
      ?? related(included, "arrangement", arrangementId);
    return {
      id: item.id,
      title: String(attrs.title || "Untitled Item"),
      itemType: String(attrs.item_type || "item"),
      servicePosition: attrs.service_position ? String(attrs.service_position) : undefined,
      key: attrs.key_name ? String(attrs.key_name) : undefined,
      lengthSeconds: Number.isFinite(Number(attrs.length)) ? Number(attrs.length) : undefined,
      sequence: Number(attrs.sequence ?? 0),
      songId: relationshipId(item, "song"),
      arrangementId,
      arrangementSequence: sequence(
        attrs.custom_arrangement_sequence ?? arrangement?.attributes?.sequence
      )
    };
  });

  const mappedSongs: Song[] = [];
  const matchedExistingIds = new Set<string>();

  for (const item of items.filter((candidate) => candidate.attributes?.item_type === "song")) {
    const songId = relationshipId(item, "song");
    const arrangementId = relationshipId(item, "arrangement");
    const keyId = relationshipId(item, "key");
    const songResource = related(included, "Song", songId) ?? related(included, "song", songId);
    const arrangement = related(included, "Arrangement", arrangementId)
      ?? related(included, "arrangement", arrangementId);
    const keyResource = related(included, "Key", keyId) ?? related(included, "key", keyId);
    const incoming = newPlanningCenterSong(item, songResource, arrangement, keyResource);

    const existing = existingSongs.find((song) =>
      (songId && song.external?.planningCenterSongId === songId)
      || normalized(song.title) === normalized(incoming.title)
    );

    if (existing) {
      matchedExistingIds.add(existing.id);
      mappedSongs.push(mergeExistingSong(existing, incoming));
    } else {
      mappedSongs.push(incoming);
    }
  }

  const songs = keepUnmatched
    ? [...mappedSongs, ...existingSongs.filter((song) => !matchedExistingIds.has(song.id))]
    : mappedSongs;

  const attrs = plan.attributes ?? {};
  return {
    link: {
      serviceTypeId: serviceType.id,
      serviceTypeName: serviceType.name,
      planId: plan.id,
      planTitle: String(attrs.title || attrs.dates || "Untitled Plan"),
      planDates: attrs.dates ? String(attrs.dates) : undefined,
      planSortDate: attrs.sort_date ? String(attrs.sort_date) : undefined,
      lastSyncedAt: new Date().toISOString(),
      items: snapshots
    },
    songs
  };
}

export const loadPlanningCenterServiceTypes = (credentials: PlanningCenterCredentials) =>
  invoke<Collection>("planning_center_service_types", {
    clientId: credentials.clientId,
    secret: credentials.secret
  });

export const loadPlanningCenterPlans = (
  credentials: PlanningCenterCredentials,
  serviceTypeId: string
) =>
  invoke<PlansResponse>("planning_center_plans", {
    clientId: credentials.clientId,
    secret: credentials.secret,
    serviceTypeId
  });

export const loadPlanningCenterPlan = (
  credentials: PlanningCenterCredentials,
  serviceTypeId: string,
  planId: string
) =>
  invoke<PlanResponse>("planning_center_plan", {
    clientId: credentials.clientId,
    secret: credentials.secret,
    serviceTypeId,
    planId
  });
