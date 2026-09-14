import type { DocumentTypeDefinition } from "@/platform/contracts";

// W3-documents wires Writer, Sheets and Slides definitions into this ordered list.
export const documentTypes: readonly DocumentTypeDefinition[] = [];

export function findDocumentType(
  contentDoctype: string,
): DocumentTypeDefinition | undefined {
  return documentTypes.find(
    (definition) => definition.contentDoctype === contentDoctype,
  );
}
