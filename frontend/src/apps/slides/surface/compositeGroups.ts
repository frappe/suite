import type { CredentialGrouper } from "@/apps/drive";

export interface CompositeReference {
  reference: string;
  index: number;
  presentation: string | null;
}

export interface CompositeManifest {
  presentation: string;
  node: string;
  modified: string;
  group_limit: number;
  references: CompositeReference[];
}

export interface CompositeAnswer extends CompositeReference {
  readable: boolean;
  node: string | null;
  composite: boolean | null;
  slides: unknown[] | null;
}

export type CompositeItem = CompositeReference & {
  status: "loading" | "ready" | "unreadable" | "failed";
  answer?: CompositeAnswer;
  group?: number;
};

interface CompositeGroupResponse {
  references: CompositeAnswer[];
}

export class CompositeGroupLoader {
  readonly items: CompositeItem[];
  private groups: { nodeIds: string[]; codes: string[] }[] = [];

  constructor(
    private readonly manifest: CompositeManifest,
    private readonly grouper: CredentialGrouper,
    private readonly request: (references: string[], codes: string[]) => Promise<CompositeGroupResponse>,
    private readonly changed: (items: readonly CompositeItem[]) => void = () => {},
  ) {
    this.items = [...manifest.references]
      .sort((left, right) => left.index - right.index)
      .map((reference) => ({ ...reference, status: "loading" }));
  }

  async load(): Promise<readonly CompositeItem[]> {
    const ids = this.items.map((item) => item.reference);
    const bounded: string[][] = [];
    for (let start = 0; start < ids.length; start += this.manifest.group_limit) {
      bounded.push(ids.slice(start, start + this.manifest.group_limit));
    }
    this.groups = [];
    for (const chunk of bounded) {
      this.groups.push(...await this.grouper.group(chunk));
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

  private async loadGroup(groupIndex: number): Promise<void> {
    const group = this.groups[groupIndex];
    if (!group) return;
    try {
      const response = await this.request(group.nodeIds, group.codes);
      const answers = new Map(response.references.map((row) => [row.reference, row]));
      for (const reference of group.nodeIds) {
        const item = this.items.find((candidate) => candidate.reference === reference);
        if (!item) continue;
        const answer = answers.get(reference);
        item.group = groupIndex;
        item.answer = answer;
        item.status = answer?.readable ? "ready" : "unreadable";
      }
    } catch {
      for (const reference of group.nodeIds) {
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
