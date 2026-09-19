import type { Section } from "./types";

export function closeSections(
  markers: Array<Omit<Section, "lengthBars">>,
  totalBars: number
): Section[] {
  return markers
    .slice()
    .sort((a, b) => a.startBar - b.startBar)
    .map((marker, index, sorted) => {
      const next = sorted[index + 1];
      const end = next ? next.startBar : totalBars + 1;
      return { ...marker, lengthBars: Math.max(1, end - marker.startBar) };
    });
}

export function snapBar(rawBeat: number, beatsPerBar: number): number {
  if (!Number.isFinite(rawBeat) || rawBeat < 0) return 1;
  return Math.floor(rawBeat / beatsPerBar) + 1;
}

export function uniqueSectionLabel(name: string, existing: Section[]): string {
  const same = existing.filter(
    (section) => section.name === name || section.name.startsWith(name + " ")
  );
  return same.length === 0 ? name : name + " " + (same.length + 1);
}
