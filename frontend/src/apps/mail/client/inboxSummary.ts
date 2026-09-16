import { query } from "@/platform/server-state";

import { api } from "./generated";

export const inboxSummary = () => query(api.inbox_summary, {});
