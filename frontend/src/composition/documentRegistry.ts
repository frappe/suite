import { writerDocument } from "@/apps/writer";
import { sheetsDocument } from "@/apps/sheets";
import { slidesDocument } from "@/apps/slides";
import type { DocumentTypeDefinition } from "@/platform/contracts";

export const documentTypes: readonly DocumentTypeDefinition[] = [
  writerDocument,
  sheetsDocument,
  slidesDocument,
];

export function findDocumentType(
  contentDoctype: string,
): DocumentTypeDefinition | undefined {
  return documentTypes.find(
    (definition) => definition.contentDoctype === contentDoctype,
  );
}
