import { defineComponent, h } from "vue";

import type { DocumentTypeDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const WriterIcon = defineComponent({
  name: "WriterDocumentIcon",
  setup: () => () =>
    h("span", {
      class: "lucide-file-text size-4",
      "aria-hidden": "true",
    }),
});

export const writerDocument: DocumentTypeDefinition = {
  contentDoctype: "Writer Document",
  newLabel: () => __("Document"),
  icon: WriterIcon,
  loadSurface: async () => (await import("@/apps/writer/surface/WriterSurface.vue")).default,
};
