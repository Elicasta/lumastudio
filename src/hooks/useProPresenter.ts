import { useCallback, useEffect, useRef, useState } from "react";
import type { ProPresenterSettings } from "../domain/integrations";
import type { Song } from "../domain/types";
import {
  findMatchingProPresenterGroup,
  getProPresenterState,
  normalizeProPresenterName,
  proPresenterNext,
  proPresenterPrevious,
  proPresenterTriggerGroup,
  type ProPresenterLiveState
} from "../services/propresenter";

export interface ProPresenterController {
  state: ProPresenterLiveState;
  refresh: () => Promise<ProPresenterLiveState>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  triggerGroup: (group: string) => Promise<void>;
}

const offlineState: ProPresenterLiveState = { connected: false, groups: [] };

export function useProPresenter(
  settings: ProPresenterSettings,
  song: Song,
  currentSectionIndex: number
): ProPresenterController {
  const [state, setState] = useState<ProPresenterLiveState>(offlineState);
  const lastTriggeredRef = useRef<string>("");

  const refresh = useCallback(async () => {
    if (!settings.enabled) {
      setState(offlineState);
      return offlineState;
    }
    const next = await getProPresenterState(settings.host, settings.port);
    setState(next);
    return next;
  }, [settings.enabled, settings.host, settings.port]);

  useEffect(() => {
    if (!settings.enabled) {
      setState(offlineState);
      return;
    }

    let cancelled = false;
    void refresh();
    const timer = window.setInterval(() => {
      if (!cancelled) void refresh();
    }, 750);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh, settings.enabled]);

  useEffect(() => {
    if (!settings.enabled || !settings.followSections || !state.connected) return;

    const section = song.sections[currentSectionIndex];
    if (!section || !state.presentationName) return;

    const studioSong = normalizeProPresenterName(song.title);
    const presenterSong = normalizeProPresenterName(state.presentationName);
    if (!studioSong || studioSong !== presenterSong) return;

    const target = findMatchingProPresenterGroup(section.name, state.groups);
    if (!target) return;

    const key = [song.id, section.id, state.presentationId ?? state.presentationName, target.name].join(":");
    if (lastTriggeredRef.current === key) return;
    lastTriggeredRef.current = key;

    void proPresenterTriggerGroup(settings.host, settings.port, target.id)
      .then(() => refresh())
      .catch(() => {
        lastTriggeredRef.current = "";
      });
  }, [
    currentSectionIndex,
    refresh,
    settings.enabled,
    settings.followSections,
    settings.host,
    settings.port,
    song,
    state.connected,
    state.groups,
    state.presentationId,
    state.presentationName
  ]);

  const next = useCallback(async () => {
    await proPresenterNext(settings.host, settings.port);
    await refresh();
  }, [refresh, settings.host, settings.port]);

  const previous = useCallback(async () => {
    await proPresenterPrevious(settings.host, settings.port);
    await refresh();
  }, [refresh, settings.host, settings.port]);

  const triggerGroup = useCallback(async (groupId: string) => {
    await proPresenterTriggerGroup(settings.host, settings.port, groupId);
    await refresh();
  }, [refresh, settings.host, settings.port]);

  return { state, refresh, next, previous, triggerGroup };
}
