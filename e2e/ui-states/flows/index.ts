import type { AnyFlow } from "../flow";
import { shell } from "./shell";
import { suiteSettings } from "./suiteSettings";
import { setup } from "./setup";
import { welcome } from "./welcome";
import { home } from "./home";
import { admin } from "./admin";
import { mailAdmin } from "./mailAdmin";
import { writer } from "./writer";
import { sheets } from "./sheets";
import { slides } from "./slides";
import { draw } from "./draw";
import { mail } from "./mail";
import { mailViews } from "./mailViews";
import { compose } from "./compose";
import { mailAccount } from "./mailAccount";
import { calendar } from "./calendar";
import { people } from "./people";
import { meet } from "./meet";
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

/** Every flow the capture walks, in canvas order: Drive first, then the rest of Suite. */
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
	shell,
	suiteSettings,
	setup,
	welcome,
	home,
	admin,
	mailAdmin,
	writer,
	sheets,
	slides,
	draw,
	mail,
	mailViews,
	compose,
	mailAccount,
	calendar,
	people,
	meet,
];
