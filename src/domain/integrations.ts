export interface ProPresenterSettings {
  enabled: boolean;
  host: string;
  port: number;
  followSections: boolean;
}

export interface PlanningCenterPlanItemSnapshot {
  id: string;
  title: string;
  itemType: string;
  servicePosition?: string;
  key?: string;
  lengthSeconds?: number;
  sequence: number;
  songId?: string;
  arrangementId?: string;
  arrangementSequence?: string[];
}

export interface PlanningCenterLink {
  serviceTypeId: string;
  serviceTypeName: string;
  planId: string;
  planTitle: string;
  planDates?: string;
  planSortDate?: string;
  lastSyncedAt: string;
  items: PlanningCenterPlanItemSnapshot[];
}

export interface IntegrationSettings {
  propresenter: ProPresenterSettings;
  planningCenter?: PlanningCenterLink;
}

export function defaultIntegrationSettings(): IntegrationSettings {
  return {
    propresenter: {
      enabled: false,
      host: "127.0.0.1",
      port: 50001,
      followSections: false
    }
  };
}
