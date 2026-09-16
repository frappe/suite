import { defineComponent, h } from "vue";

import type { DocumentTypeDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const SheetsIcon = defineComponent({
  name: "SheetsDocumentIcon",
  setup: () => () =>
    h("span", {
      class: "lucide-table-2 size-4",
      "aria-hidden": "true",
    }),
});

export const sheetsDocument: DocumentTypeDefinition = {
  contentDoctype: "Sheet",
  newLabel: () => __("Spreadsheet"),
  icon: SheetsIcon,
  loadSurface: async () => (await import("@/apps/sheets/surface/SheetsSurface.vue")).default,
};
