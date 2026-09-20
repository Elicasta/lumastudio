import { invoke } from "@tauri-apps/api/core";

export interface ProPresenterConnectionSettings {
  enabled: boolean;
  host: string;
  port: number;
  followSections: boolean;
}

export interface ProPresenterGroupState {
  name: string;
  index: number;
  startIndex: number;
  slideCount: number;
}

export interface ProPresenterLiveState {
  connected: boolean;
  version?: string;
  presentationId?: string;
  presentationName?: string;
  slideIndex?: number;
  totalSlides?: number;
  currentGroup?: string;
  currentGroupIndex?: number;
  currentSlideInGroup?: number;
  currentGroupSlides?: number;
  currentText?: string;
  nextText?: string;
  groups: ProPresenterGroupState[];
  error?: string;
}

interface RawSnapshot {
  version?: unknown;
  active?: unknown;
  slideIndex?: unknown;
  statusSlide?: unknown;
}

type JsonObject = Record<string, any>;

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

function stringValue(...values: unknown[]) {
  return values.find((value) => typeof value === "string" && value.length > 0) as string | undefined;
}

function numberValue(...values: unknown[]) {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return value as number | undefined;
}

function presentationFrom(raw: RawSnapshot) {
  const active = object(raw.active);
  return object(active.presentation ?? raw.active);
}

function enabledSlides(group: JsonObject) {
  return Array.isArray(group.slides)
    ? group.slides.filter((slide) => object(slide).enabled !== false)
    : [];
}

export function normalizeProPresenterName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function groupBaseName(value: string) {
  return normalizeProPresenterName(value).replace(/\s+\d+$/, "");
}

export function findMatchingProPresenterGroup(sectionName: string, groups: ProPresenterGroupState[]) {
  const exact = normalizeProPresenterName(sectionName);
  const exactMatch = groups.find((group) => normalizeProPresenterName(group.name) === exact);
  if (exactMatch) return exactMatch;

  const base = groupBaseName(sectionName);
  return groups.find((group) => groupBaseName(group.name) === base);
}

export function parseProPresenterSnapshot(raw: RawSnapshot): ProPresenterLiveState {
  const presentation = presentationFrom(raw);
  const id = object(presentation.id);
  const rawGroups = Array.isArray(presentation.groups) ? presentation.groups.map(object) : [];
  const directSlides = Array.isArray(presentation.slides) ? presentation.slides : [];

  const groups: ProPresenterGroupState[] = [];
  let cursor = 0;
  rawGroups.forEach((group, index) => {
    const slides = enabledSlides(group);
    groups.push({
      name: stringValue(group.name, `Group ${index + 1}`) ?? `Group ${index + 1}`,
      index,
      startIndex: cursor,
      slideCount: slides.length
    });
    cursor += slides.length;
  });

  const slideIndexObject = object(raw.slideIndex);
  const presentationIndex = object(slideIndexObject.presentation_index ?? slideIndexObject.presentationIndex);
  const slideIndex = numberValue(
    presentationIndex.index,
    slideIndexObject.index,
    object(raw.statusSlide).index
  );

  const totalSlides = groups.length > 0 ? cursor : directSlides.length || undefined;
  const currentGroupState = slideIndex === undefined
    ? undefined
    : groups.find((group) =>
      slideIndex >= group.startIndex &&
      slideIndex < group.startIndex + Math.max(1, group.slideCount)
    );

  const status = object(raw.statusSlide);
  const current = object(status.current);
  const next = object(status.next);

  const versionObject = object(raw.version);
  const presentationId = stringValue(
    id.uuid,
    id.id,
    presentation.uuid,
    presentation.id
  );
  const presentationName = stringValue(id.name, presentation.name, presentation.title);

  return {
    connected: true,
    version: stringValue(
      versionObject.version,
      versionObject.name,
      typeof raw.version === "string" ? raw.version : undefined
    ),
    presentationId,
    presentationName,
    slideIndex,
    totalSlides,
    currentGroup: currentGroupState?.name,
    currentGroupIndex: currentGroupState?.index,
    currentSlideInGroup: currentGroupState && slideIndex !== undefined
      ? slideIndex - currentGroupState.startIndex + 1
      : undefined,
    currentGroupSlides: currentGroupState?.slideCount,
    currentText: stringValue(current.text, status.current_text, status.currentText),
    nextText: stringValue(next.text, status.next_text, status.nextText),
    groups
  };
}

export async function getProPresenterState(host: string, port: number): Promise<ProPresenterLiveState> {
  try {
    const raw = await invoke<RawSnapshot>("propresenter_snapshot", { host, port });
    return parseProPresenterSnapshot(raw);
  } catch (cause) {
    return {
      connected: false,
      groups: [],
      error: cause instanceof Error ? cause.message : String(cause)
    };
  }
}

export const proPresenterNext = (host: string, port: number) =>
  invoke<void>("propresenter_next", { host, port });

export const proPresenterPrevious = (host: string, port: number) =>
  invoke<void>("propresenter_previous", { host, port });

export const proPresenterTriggerGroup = (host: string, port: number, group: string) =>
  invoke<void>("propresenter_trigger_group", { host, port, group });
