import type { AnyFlow } from "../flow";
import { dialogs } from "./dialogs";
import { guest } from "./guest";
import { listing } from "./listing";
import { places } from "./places";
import { preview } from "./preview";
import { selection } from "./selection";
import { settings } from "./settings";
import { share } from "./share";
import { trash } from "./trash";
import { upload } from "./upload";

/** Every flow the capture walks, in canvas order. */
export const flows: readonly AnyFlow[] = [
	places,
	listing,
	selection,
	dialogs,
	upload,
	preview,
	share,
	guest,
	trash,
	settings,
];
