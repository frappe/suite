import type { CredentialGroup, CredentialGrouper } from "@/apps/drive";

export interface CompositeReference {
  reference: string;
  index: number;
  presentation: string | null;
}

/** A manifest row also names the referenced deck's node, so its link code can be sent. */
export interface ManifestReference extends CompositeReference {
  node: string | null;
}

export interface CompositeManifest {
  presentation: string;
  node: string;
  modified: string;
  group_limit: number;
  references: ManifestReference[];
}

export interface CompositeAnswer extends CompositeReference {
  readable: boolean;
  node: string | null;
  composite: boolean | null;
  slides: unknown[] | null;
}

export type CompositeItem = ManifestReference & {
  status: "loading" | "ready" | "unreadable" | "failed";
  answer?: CompositeAnswer;
  group?: number;
};

interface CompositeGroupResponse {
  references: CompositeAnswer[];
}

/** One request: the references it asks for, and the fetch that carries their link codes. */
interface LoadGroup {
  references: string[];
  fetch: CredentialGroup["fetch"];
}

/** The loader selects codes by node id; it never sends every held code. */
type Grouper = Pick<CredentialGrouper, "group" | "fetch">;

export class CompositeGroupLoader {
  readonly items: CompositeItem[];
  private groups: LoadGroup[] = [];

  constructor(
    private readonly manifest: CompositeManifest,
    private readonly grouper: Grouper,
    private readonly request: (references: string[], send: CredentialGrouper["fetch"]) => Promise<CompositeGroupResponse>,
    private readonly changed: (items: readonly CompositeItem[]) => void = () => {},
  ) {
    this.items = [...manifest.references]
      .sort((left, right) => left.index - right.index)
      .map((reference) => ({ ...reference, status: "loading" }));
  }

  async load(): Promise<readonly CompositeItem[]> {
    this.groups = [];
    for (let start = 0; start < this.items.length; start += this.manifest.group_limit) {
      this.groups.push(...this.split(this.items.slice(start, start + this.manifest.group_limit)));
    }
    await Promise.all(this.groups.map((_group, index) => this.loadGroup(index)));
    return this.items;
  }

  async retry(group: number): Promise<void> {
    for (const item of this.items) {
      if (item.group === group) item.status = "loading";
    }
    this.changed(this.items);
    await this.loadGroup(group);
  }

  /**
   * Split one bounded run of references by link codes. The grouper selects
   * codes by node id and keeps the order, so each of its groups is the next
   * run of references with a node. A reference with no node needs no code: it
   * rides with the reference before it.
   */
  private split(items: readonly CompositeItem[]): LoadGroup[] {
    const nodes = items.flatMap((item) => (item.node ? [item.node] : []));
    const credentialGroups = nodes.length ? this.grouper.group(nodes) : [];
    const groups: LoadGroup[] = credentialGroups.map((group) => ({ references: [], fetch: group.fetch }));
    if (!groups.length) groups.push({ references: [], fetch: this.grouper.fetch });
    let current = 0;
    let left = credentialGroups[0]?.nodeIds.length ?? 0;
    for (const item of items) {
      if (item.node) {
        while (left === 0 && current < credentialGroups.length - 1) {
          current += 1;
          left = credentialGroups[current].nodeIds.length;
        }
        left -= 1;
      }
      groups[current].references.push(item.reference);
    }
    return groups;
  }

  private async loadGroup(groupIndex: number): Promise<void> {
    const group = this.groups[groupIndex];
    if (!group) return;
    try {
      const response = await this.request(group.references, group.fetch);
      const answers = new Map(response.references.map((row) => [row.reference, row]));
      for (const reference of group.references) {
        const item = this.items.find((candidate) => candidate.reference === reference);
        if (!item) continue;
        const answer = answers.get(reference);
        item.group = groupIndex;
        item.answer = answer;
        item.status = answer?.readable ? "ready" : "unreadable";
      }
    } catch {
      for (const reference of group.references) {
        const item = this.items.find((candidate) => candidate.reference === reference);
        if (!item) continue;
        item.group = groupIndex;
        item.status = "failed";
      }
    }
    this.changed(this.items);
  }
}

export interface MergedCompositeSlide {
  reference: string;
  index: number;
  status: CompositeItem["status"];
  slide: unknown | null;
}

export function mergeCompositeSlides(items: readonly CompositeItem[]): MergedCompositeSlide[] {
  return items.flatMap((item) => {
    if (item.status === "ready" && item.answer?.slides?.length) {
      return item.answer.slides.map((slide) => ({
        reference: item.reference,
        index: item.index,
        status: item.status,
        slide,
      }));
    }
    return [{
      reference: item.reference,
      index: item.index,
      status: item.status,
      slide: null,
    }];
  });
}

/** Where the viewer is in a merged composite: one reference, and a slide within it. */
export interface CompositePlace {
  reference: string;
  offset: number;
}

export function placeAt(merged: readonly MergedCompositeSlide[], index: number): CompositePlace | null {
  const entry = merged[index];
  if (!entry) return null;
  let offset = 0;
  while (index - offset - 1 >= 0 && merged[index - offset - 1]!.reference === entry.reference) offset += 1;
  return { reference: entry.reference, offset };
}

/**
 * The index of a place in a newer merge. A group that arrives replaces a
 * placeholder with the deck's slides, so indexes move while places do not.
 * The offset is clamped to the reference's slides; a place that is gone answers 0.
 */
export function indexOfPlace(merged: readonly MergedCompositeSlide[], place: CompositePlace): number {
  const first = merged.findIndex((entry) => entry.reference === place.reference);
  if (first < 0) return 0;
  let last = first;
  while (merged[last + 1]?.reference === place.reference) last += 1;
  return Math.min(first + place.offset, last);
}
