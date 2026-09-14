import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(frontendRoot, "src");
const appsRoot = path.join(sourceRoot, "apps");
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue"]);
const products = new Set(
  fs.readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);

const boundaryDebtGroups = [
  {
    owner: "Mail and Calendar owners",
    removal: "Publish Calendar UI contracts before changing the existing Mail integration.",
    entries: [
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/components/DateChip.vue",
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/utils/dayjs",
      "mail/components/CalendarInviteBanner.vue|@/apps/calendar/utils/eventTime",
      "mail/components/DefaultLayout.vue|@/apps/calendar/utils/dayjs",
      "mail/components/DefaultLayout.vue|@/apps/calendar/components/EventDetailSidebar.vue",
      "mail/components/UpcomingEvents.vue|@/apps/calendar/utils/dayjs",
      "mail/components/UpcomingEvents.vue|@/apps/calendar/components/UpcomingEvents.vue",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/utils/dayjs",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/utils/eventTime",
      "mail/composables/useUpcomingEvents.ts|@/apps/calendar/stores/user",
    ],
  },
  {
    owner: "Meet and Calendar owners",
    removal: "Publish Calendar scheduling contracts before changing the existing Meet integration.",
    entries: [
      "meet/components/UpcomingMeetings.vue|@/apps/calendar/stores/user",
      "meet/components/UpcomingMeetings.vue|@/apps/calendar/utils/dayjs",
      "meet/pages/Home.vue|@/apps/calendar/stores/user",
      "meet/pages/Home.vue|@/apps/calendar/utils/dayjs",
      "meet/pages/Home.vue|@/apps/calendar/components/ParticipantSelector.vue",
      "meet/pages/Home.vue|@/apps/calendar/utils/scheduleTime",
    ],
  },
  {
    owner: "Slides frontend owner",
    removal: "Move to @/apps/drive when Slides adopts the Drive interface.",
    entries: ["slides/components/SharePopover.vue|@/apps/drive/legacy/sdk"],
  },
  {
    owner: "Writer frontend owner",
    removal: "Move to @/apps/drive when Writer adopts the Drive interface.",
    entries: [
      "writer/components/CommentEditor.vue|@/apps/drive/legacy/sdk",
      "writer/components/CoreEditor.vue|@/apps/drive/legacy/sdk",
      "writer/components/Dialogs.vue|@/apps/drive/legacy/sdk",
      "writer/components/Dialogs.vue|@/apps/drive/legacy/data/selection",
      "writer/components/Navbar.vue|@/apps/drive/legacy/components/EditableBreadcrumbs.vue",
      "writer/components/Navbar.vue|@/apps/drive/legacy/sdk",
      "writer/components/Navbar.vue|@/apps/drive/legacy/resources/files",
      "writer/components/ToC.vue|@/apps/drive/legacy/sdk",
      "writer/composables/useDocument.ts|@/apps/drive/legacy/sdk",
      "writer/composables/useUsers.ts|@/apps/drive/legacy/sdk",
      "writer/routes.ts|@/apps/drive/legacy/sdk",
      "writer/utils/index.js|@/apps/drive/legacy/sdk",
    ],
  },
];

// Exact entries only. Each group names its owner and removal condition.
const moduleGraphDebtGroups = [
  {
    "owner": "Calendar frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "calendar/components/AppSidebar.vue|@/boot/session",
      "calendar/components/AppSidebar.vue|@/composables/useAppSwitcher",
      "calendar/components/EventDetailSidebar.vue|@/assets/app-logos/meet.png",
      "calendar/components/EventDetailSidebar.vue|@/components/LinkifiedText.vue",
      "calendar/components/Modals/EventModal.vue|@/assets/app-logos/meet.png",
      "calendar/components/Settings/AdvancedSettings.vue|@/components/CopyControl.vue",
      "calendar/components/Settings/AdvancedSettings.vue|@/components/settings/AppSettingsBody.vue",
      "calendar/components/Settings/AdvancedSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "calendar/components/Settings/AppearanceSettings.vue|@/components/settings/AppSettingsBody.vue",
      "calendar/components/Settings/AppearanceSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "calendar/components/Settings/AppearanceSettings.vue|@/utils/setupTheme",
      "calendar/components/Settings/ExportSettings.vue|@/components/settings/AppSettingsBody.vue",
      "calendar/components/Settings/ExportSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "calendar/components/Settings/ImportSettings.vue|@/components/settings/AppSettingsBody.vue",
      "calendar/components/Settings/ImportSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "calendar/components/Settings/ImportSettings.vue|@/utils/useChunkedUpload",
      "calendar/components/Settings/ParticipantIdentitySettings.vue|@/components/settings/AppSettingsBody.vue",
      "calendar/components/Settings/ParticipantIdentitySettings.vue|@/components/settings/AppSettingsHeader.vue",
      "calendar/components/Settings/ProfileSettings.vue|@/components/settings/UserProfileSettings.vue",
      "calendar/pages/CalendarView.vue|@/composables/useScreenSize",
      "calendar/router.ts|@/router",
      "calendar/utils/composables.ts|@/composables/useTheme",
      "calendar/utils/eventTime.test.ts|@/boot/translation"
    ]
  },
  {
    "owner": "Drive frontend owners",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "drive/legacy/components/DriveListRow.vue|@/boot/session",
      "drive/legacy/components/DriveToolBar.vue|@/components/SortControl.vue",
      "drive/legacy/components/ErrorPage.vue|@/boot/session",
      "drive/legacy/components/GenericPage.test.ts|@/boot/session",
      "drive/legacy/components/GenericPage.vue|@/boot/session",
      "drive/legacy/components/Navbar.vue|@/boot/session",
      "drive/legacy/components/Settings/BackendSettings.vue|@/components/settings/AppSettingsBody.vue",
      "drive/legacy/components/Settings/BackendSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "drive/legacy/components/Settings/PreferencesSettings.vue|@/components/settings/AppSettingsBody.vue",
      "drive/legacy/components/Settings/PreferencesSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "drive/legacy/components/Settings/ProfileSettings.vue|@/components/settings/UserProfileSettings.vue",
      "drive/legacy/components/Settings/StorageSettings.vue|@/components/settings/AppSettingsBody.vue",
      "drive/legacy/components/Settings/StorageSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "drive/legacy/components/Settings/UserListSettings.vue|@/boot/session",
      "drive/legacy/components/Settings/UserListSettings.vue|@/components/settings/AppSettingsBody.vue",
      "drive/legacy/components/Settings/UserListSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "drive/legacy/components/Settings/WebDAVSettings.vue|@/components/CopyControl.vue",
      "drive/legacy/components/Settings/WebDAVSettings.vue|@/components/settings/AppSettingsBody.vue",
      "drive/legacy/components/Settings/WebDAVSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "drive/legacy/components/Sidebar.vue|@/boot/session",
      "drive/legacy/components/Sidebar.vue|@/composables/useAppSwitcher",
      "drive/legacy/components/Sidebar.vue|@/utils/setupTheme",
      "drive/legacy/components/StorageBar.vue|@/components/SidebarStorage.vue",
      "drive/legacy/data/breadcrumbs.ts|@/boot/session",
      "drive/legacy/pages/DriveLayout.vue|@/boot/session",
      "drive/legacy/pages/DriveLayout.vue|@/utils/setupTheme",
      "drive/legacy/resources/permissions.js|@/apps/registry",
      "drive/legacy/resources/permissions.js|@/boot/session",
      "drive/legacy/router.ts|@/router",
      "drive/legacy/routes.ts|@/boot/session",
      "drive/legacy/routes.ts|@/utils/setupTheme",
      "drive/legacy/ui/drive/components/ShareDialog.vue|@/boot/session"
    ]
  },
  {
    "owner": "Mail frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "mail/components/AppSidebar.vue|@/composables/useAppSwitcher",
      "mail/components/PlainTextBody.vue|@/components/LinkifiedText.vue",
      "mail/components/QuotaBar.vue|@/components/SidebarStorage.vue",
      "mail/components/Settings/Account.vue|@/components/StorageMeter.vue",
      "mail/components/Settings/Account.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/Account.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/AdvancedSettings.vue|@/components/CopyControl.vue",
      "mail/components/Settings/AdvancedSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/AdvancedSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/AppearanceSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/AppearanceSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/AppearanceSettings.vue|@/utils/setupTheme",
      "mail/components/Settings/AutomationSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/AutomationSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/ComposeSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/ComposeSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/ContactsImportSettings.vue|@/utils/useChunkedUpload",
      "mail/components/Settings/CredentialsSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/CredentialsSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/ExportSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/ExportSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/FolderSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/FolderSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/IdentitySettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/IdentitySettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/ImportSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/ImportSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/MailImportSettings.vue|@/utils/useChunkedUpload",
      "mail/components/Settings/ProfileSettings.vue|@/components/settings/UserProfileSettings.vue",
      "mail/components/Settings/PushSubscriptionSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/ScreenedEmailAddressSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/SignatureSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/SignatureSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/components/Settings/VacationResponseSettings.vue|@/components/settings/AppSettingsBody.vue",
      "mail/components/Settings/VacationResponseSettings.vue|@/components/settings/AppSettingsHeader.vue",
      "mail/pages/MailLayout.vue|@/boot/config",
      "mail/pages/dashboard/ActionsView.vue|@/boot/session",
      "mail/router.ts|@/boot/session",
      "mail/router.ts|@/router",
      "mail/stores/session.ts|@/boot/session",
      "mail/utils/composables.ts|@/composables/useScreenSize",
      "mail/utils/composables.ts|@/composables/useTheme"
    ]
  },
  {
    "owner": "Meet frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "meet/components/MeetSidebar.vue|../../../boot/session",
      "meet/components/MeetSidebar.vue|@/composables/useAppSwitcher",
      "meet/components/MeetSidebar.vue|@/utils/setupTheme",
      "meet/components/MeetingPreview.vue|@/boot/session",
      "meet/components/settings/AudioSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/AudioSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/components/settings/BackgroundSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/BackgroundSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/components/settings/DeviceSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/DeviceSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/components/settings/LayoutSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/LayoutSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/components/settings/MeetingAccessSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/MeetingAccessSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/components/settings/NotificationSettingsTab.vue|@/components/settings/AppSettingsBody.vue",
      "meet/components/settings/NotificationSettingsTab.vue|@/components/settings/AppSettingsHeader.vue",
      "meet/composables/useCurrentUser.ts|@/boot/session",
      "meet/composables/useMeetingDoc.ts|@/boot/session",
      "meet/composables/useMeetingPreviewPresence.ts|@/boot/session",
      "meet/composables/useNoiseCancellation.ts|@/shims/noise-suppression-audio-worklet",
      "meet/pages/Meeting.vue|@/boot/session",
      "meet/router.ts|@/boot/session",
      "meet/router.ts|@/router"
    ]
  },
  {
    "owner": "Sheets frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "sheets/components/SheetEditor/ShareDialog.vue|@/boot/session",
      "sheets/components/SheetEditor/index.vue|@/boot/session",
      "sheets/components/SheetEditor/useCollaboration.js|@/boot/session"
    ]
  },
  {
    "owner": "Suite architecture owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "shell/AppContainer.vue|@/stores/root",
      "shell/LauncherView.vue|@/apps/registry",
      "shell/LauncherView.vue|@/assets/app-logos/settings.svg",
      "shell/LauncherView.vue|@/boot/session",
      "shell/LauncherView.vue|@/composables/useThemeMenuOption",
      "shell/LauncherView.vue|@/stores/root",
      "shell/LauncherView.vue|@/utils/setupTheme",
      "shell/SetupView.vue|@/apps/registry",
      "shell/SetupView.vue|@/utils/setupTheme",
      "shell/settings/PreferencesSettings.vue|@/boot/session",
      "shell/settings/PreferencesSettings.vue|@/utils/setupTheme",
      "shell/settings/SuiteSettingsDialog.vue|@/boot/session",
      "shell/settings/SuiteSettingsDialog.vue|@/components/settings/UserProfileSettings.vue",
      "shell/useWorkspace.ts|@/boot/session"
    ]
  },
  {
    "owner": "Slides frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "slides/SlidesShell.vue|@/utils/setupTheme",
      "slides/components/EditorNavbar.vue|@/boot/session",
      "slides/components/Navbar.vue|@/boot/session",
      "slides/components/Navbar.vue|@/composables/useAppSwitcher",
      "slides/components/Navbar.vue|@/composables/useThemeMenuOption",
      "slides/components/PresentationList.vue|@/components/SortControl.vue",
      "slides/router.ts|@/router",
      "slides/routes.ts|@/boot/session",
      "slides/utils/mediaUploads.js|@/boot/session",
      "slides/utils/uploadTargetSlide.test.ts|@/boot/session"
    ]
  },
  {
    "owner": "Writer frontend owner",
    "removal": "Remove each entry when the owner migrates that dependency to platform or a declared product package root.",
    "entries": [
      "writer/components/CoreEditor.vue|@/boot/session",
      "writer/components/ErrorPage.vue|@/boot/session",
      "writer/components/FloatingComments.vue|@/boot/session",
      "writer/components/Navbar.vue|@/boot/session",
      "writer/components/RoundedListView.vue|@/boot/session",
      "writer/components/TextEditor.vue|@/boot/session",
      "writer/composables/useDocument.ts|@/boot/session",
      "writer/composables/useYjs.ts|@/boot/session",
      "writer/pages/Document.vue|@/boot/session",
      "writer/pages/WriterLayout.vue|@/utils/setupTheme",
      "writer/resources/index.js|@/apps/registry",
      "writer/resources/index.js|@/boot/session",
      "writer/router.ts|@/router",
      "writer/routes.ts|@/boot/session",
      "writer/utils/index.js|@/boot/session"
    ]
  }
];
const unstableFrappeUIDebtGroups = [
  {
    "owner": "Calendar frontend owner",
    "removal": "Remove each entry when the owner migrates it to a stable frappe-ui export.",
    "entries": [
      "calendar/components/AppSidebar.vue|frappe-ui/experimental",
      "calendar/components/MiniMonth.vue|frappe-ui/experimental",
      "calendar/pages/CalendarView.vue|frappe-ui/experimental"
    ]
  },
  {
    "owner": "Mail frontend owner",
    "removal": "Remove each entry when the owner migrates it to a stable frappe-ui export.",
    "entries": [
      "mail/components/AdaptiveDropdown.vue|frappe-ui/experimental",
      "mail/components/AppSidebar.vue|frappe-ui/experimental",
      "mail/components/ComposeMailEditor.vue|frappe-ui/experimental",
      "mail/components/ComposeMailToolbar.vue|frappe-ui/experimental",
      "mail/components/DNSRecords.vue|frappe-ui/experimental",
      "mail/components/DashboardPager.vue|frappe-ui/experimental",
      "mail/components/IdentitySettingsListView.vue|frappe-ui/experimental",
      "mail/components/InstallPrompt.vue|frappe-ui/experimental",
      "mail/components/Modals/AddAddressBookContactsModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddGroupEmailModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddMailingListEmailModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddMailingListRecipientsModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddMemberEmailModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddMemberModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddOAuthClientModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddOAuthContactsModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddOAuthRedirectUrisModal.vue|frappe-ui/experimental",
      "mail/components/Modals/AddSignatureModal.vue|frappe-ui/experimental",
      "mail/components/Modals/ContactsModal.vue|frappe-ui/experimental",
      "mail/components/Modals/EditSignatureModal.vue|frappe-ui/experimental",
      "mail/components/Modals/FolderModal.vue|frappe-ui/experimental",
      "mail/components/Modals/RunActionModal.vue|frappe-ui/experimental",
      "mail/components/Modals/SearchModal.vue|frappe-ui/experimental",
      "mail/components/Modals/SetDefaultSignatureModal.vue|frappe-ui/experimental",
      "mail/components/Settings/FolderSettings.vue|frappe-ui/experimental",
      "mail/components/Settings/IdentitySettings.vue|frappe-ui/experimental",
      "mail/components/Settings/PushSubscriptionSettings.vue|frappe-ui/experimental",
      "mail/components/Settings/ScreenedEmailAddressSettings.vue|frappe-ui/experimental",
      "mail/components/Settings/VacationResponseSettings.vue|frappe-ui/experimental",
      "mail/components/ThreadHeader.vue|frappe-ui/experimental",
      "mail/components/mobile/MobileFolderSheet.vue|frappe-ui/experimental",
      "mail/components/mobile/MobileTabBar.vue|frappe-ui/experimental",
      "mail/components/mobile/MobileTabBar.vue|frappe-ui/experimental#2",
      "mail/pages/AddressBookView.vue|frappe-ui/experimental",
      "mail/pages/AddressBooksView.vue|frappe-ui/experimental",
      "mail/pages/CalendarExchangesView.vue|frappe-ui/experimental",
      "mail/pages/ComposeView.vue|frappe-ui/experimental",
      "mail/pages/ContactView.vue|frappe-ui/experimental",
      "mail/pages/ContactsExchangesView.vue|frappe-ui/experimental",
      "mail/pages/ContactsView.vue|frappe-ui/experimental",
      "mail/pages/MailExchangesView.vue|frappe-ui/experimental",
      "mail/pages/OutboxView.vue|frappe-ui/experimental",
      "mail/pages/SignupView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/ActionsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/DkimSignatureView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/DkimSignaturesView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/DomainsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/GroupView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/GroupsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/GroupsView.vue|frappe-ui/experimental#2",
      "mail/pages/dashboard/InvitesView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/LogsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/MailingListView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/MailingListsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/MailingListsView.vue|frappe-ui/experimental#2",
      "mail/pages/dashboard/MemberView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/OAuthClientView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/OAuthClientsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/OAuthClientsView.vue|frappe-ui/experimental#2",
      "mail/pages/dashboard/OverviewView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/QueuedMessageView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/QueuedMessagesView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/ReportsView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/RolesView.vue|frappe-ui/experimental",
      "mail/pages/dashboard/RolesView.vue|frappe-ui/experimental#2",
      "mail/pages/dashboard/UsersView.vue|frappe-ui/experimental",
      "mail/utils/mentionSuggestion.ts|frappe-ui/experimental",
      "mail/utils/text-editor.ts|frappe-ui/experimental",
      "mail/utils/useThreadActions.ts|frappe-ui/experimental"
    ]
  },
  {
    "owner": "Suite architecture owner",
    "removal": "Remove each entry when the owner migrates it to a stable frappe-ui export.",
    "entries": [
      "main.ts|frappe-ui/experimental"
    ]
  },
  {
    "owner": "Sheets frontend owner",
    "removal": "Remove each entry when the owner migrates it to a stable frappe-ui export.",
    "entries": [
      "sheets/components/SheetEditor/ChartDialog.vue|frappe-ui/experimental",
      "sheets/components/SheetEditor/ChartOverlay.vue|frappe-ui/experimental",
      "sheets/components/SheetEditor/ColorPicker.vue|frappe-ui/experimental",
      "sheets/components/SheetEditor/PivotDialog.vue|frappe-ui/experimental",
      "sheets/components/SheetEditor/PivotFieldPicker.vue|frappe-ui/experimental",
      "sheets/components/SheetEditor/index.vue|frappe-ui/experimental",
      "sheets/pages/Home.vue|frappe-ui/experimental",
      "sheets/pages/Trash.vue|frappe-ui/experimental"
    ]
  },
  {
    "owner": "Writer frontend owner",
    "removal": "Remove each entry when the owner migrates it to a stable frappe-ui export.",
    "entries": [
      "writer/utils/dialogs.ts|frappe-ui/src/components/Dialog/types"
    ]
  }
];

function buildBaseline(groups, label) {
  const baseline = new Map();
  for (const group of groups) {
    if (!group.owner || !group.removal)
      throw new Error(`${label} debt must name an owner and removal condition`);
    for (const entry of group.entries) {
      if (baseline.has(entry)) throw new Error(`Duplicate ${label} baseline entry: ${entry}`);
      baseline.set(entry, group);
    }
  }
  return baseline;
}

const boundaryBaseline = buildBaseline([...boundaryDebtGroups, ...moduleGraphDebtGroups], "import-boundary");
const frappeUIBaseline = buildBaseline(unstableFrappeUIDebtGroups, "frappe-ui import");

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(item);
    else if (sourceExtensions.has(path.extname(entry.name))) yield item;
  }
}

function sourceUnits(file, source) {
  if (path.extname(file) !== ".vue") return [{ source, lineOffset: 0 }];
  const units = [];
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = scripts.exec(source); match; match = scripts.exec(source)) {
    units.push({ source: match[1], lineOffset: source.slice(0, match.index).split("\n").length - 1 });
  }
  return units;
}

function moduleSpecifiers(source, filename) {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const add = (literal) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    found.push({ specifier: literal.text, line: position.line + 1 });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const namedCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const mockCall = ts.isPropertyAccessExpression(node.expression)
        && ["jest", "vi"].includes(node.expression.expression.getText(sourceFile))
        && node.expression.name.text === "mock";
      if (dynamicImport || namedCall || mockCall) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const sourcePath = (file) => path.relative(sourceRoot, file).split(path.sep).join("/");
const displayPath = (relative) => relative.startsWith("apps/") ? relative.slice("apps/".length) : relative;

function layerFor(relative) {
  const segments = relative.split("/");
  if (["composition", "shell", "platform"].includes(segments[0])) return { kind: segments[0] };
  if (segments[0] === "apps" && products.has(segments[1])) return { kind: "product", product: segments[1] };
  return { kind: "legacy" };
}

function targetFor(file, specifier) {
  let relative;
  let canonical = false;
  if (specifier === "@") {
    relative = "";
    canonical = true;
  } else if (specifier.startsWith("@/")) {
    relative = specifier.slice(2);
    canonical = true;
  } else if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(file), specifier);
    relative = path.relative(sourceRoot, resolved).split(path.sep).join("/");
    if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  } else {
    return null;
  }
  return { relative, canonical, layer: layerFor(relative) };
}

function rootProductImport(target, specifier) {
  return target.canonical
    && target.layer.kind === "product"
    && specifier === `@/apps/${target.layer.product}`;
}

function graphViolation(source, target, specifier) {
  const from = layerFor(source);
  const to = target.layer;
  if (from.kind === "legacy") return null;

  if (from.kind === "product"
    && from.product === "drive"
    && ["files", "client"].includes(source.split("/")[2])
    && (target.relative === "apps/drive/legacy"
      || target.relative.startsWith("apps/drive/legacy/"))) {
    return "Drive Files and client code must not import Drive legacy code";
  }

  if (from.kind === "composition") {
    if (["composition", "shell", "platform"].includes(to.kind)) return null;
    if (to.kind === "product" && rootProductImport(target, specifier)) return null;
    if (to.kind === "product") return `composition must import @/apps/${to.product} at its package root`;
    return "composition may import only shell, platform, or product package roots";
  }
  if (from.kind === "shell") {
    if (["shell", "platform"].includes(to.kind)) return null;
    return "shell may import only shell or platform modules";
  }
  if (from.kind === "platform") {
    if (["composition", "shell", "product"].includes(to.kind))
      return "platform must not import shell, composition, or product modules";
    return null;
  }
  if (from.kind === "product") {
    if (to.kind === "platform") return null;
    if (to.kind === "product" && to.product === from.product) return null;
    if (to.kind === "product" && rootProductImport(target, specifier)) return null;
    if (to.kind === "product") return `cross-product imports must use @/apps/${to.product}`;
    return "products may import only their own code, platform, or product package roots";
  }
  return null;
}

function violationsInSource(relative, source, lineOffset = 0) {
  const file = path.join(sourceRoot, relative);
  const boundary = [];
  const frappeUI = [];
  for (const item of moduleSpecifiers(source, relative)) {
    if (item.specifier === "frappe-ui/experimental"
      || item.specifier.startsWith("frappe-ui/experimental/")
      || item.specifier.startsWith("frappe-ui/src/")) {
      frappeUI.push({
        path: displayPath(relative), line: item.line + lineOffset,
        specifier: item.specifier, reason: "use a stable frappe-ui export",
      });
    }
    const target = targetFor(file, item.specifier);
    if (!target) continue;
    const reason = graphViolation(relative, target, item.specifier);
    if (reason) boundary.push({ path: displayPath(relative), line: item.line + lineOffset, specifier: item.specifier, reason });
  }
  return { boundary, frappeUI };
}

function scan() {
  const boundary = [];
  const frappeUI = [];
  for (const file of walk(sourceRoot)) {
    const relative = sourcePath(file);
    const source = fs.readFileSync(file, "utf8");
    for (const unit of sourceUnits(file, source)) {
      const found = violationsInSource(relative, unit.source, unit.lineOffset);
      boundary.push(...found.boundary);
      frappeUI.push(...found.frappeUI);
    }
  }
  const sort = (left, right) => left.path.localeCompare(right.path) || left.line - right.line;
  boundary.sort(sort);
  frappeUI.sort(sort);
  return { boundary, frappeUI };
}

function keyed(violations) {
  const counts = new Map();
  const result = new Map();
  for (const violation of violations) {
    const base = `${violation.path}|${violation.specifier}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.set(count === 1 ? base : `${base}#${count}`, violation);
  }
  return result;
}

function selfTest() {
  const cases = [
    ["apps/writer/newFeature.ts", "import { require } from '@/apps/drive/internal/access'\n", 1],
    ["apps/writer/newFeature.ts", "import { check } from '@/apps/drive'\n", 0],
    ["shell/newFeature.ts", "import { check } from '@/apps/drive'\n", 1],
    ["platform/newFeature.ts", "import Shell from '@/shell/Shell.vue'\n", 1],
    ["composition/newFeature.ts", "import routes from '@/apps/drive/routes'\n", 1],
    ["apps/drive/files/newFeature.ts", "import routes from '../legacy/routes'\n", 1],
    ["apps/drive/client/newFeature.ts", "import routes from '@/apps/drive/legacy/routes'\n", 1],
    ["apps/drive/files/newFeature.ts", "import legacy from '@/apps/drive/legacy'\n", 1],
  ];
  for (const [relative, source, count] of cases) {
    if (violationsInSource(relative, source).boundary.length !== count)
      throw new Error(`Import-boundary self-test failed for ${relative}`);
  }
  const unstable = violationsInSource(
    "apps/drive/files/newFeature.ts",
    "import { ListView } from 'frappe-ui/experimental'\n",
  );
  if (unstable.frappeUI.length !== 1)
    throw new Error("Import-boundary self-test did not reject unstable frappe-ui");
  const unstableSubpath = violationsInSource(
    "apps/drive/files/newFeature.ts",
    "import ListView from 'frappe-ui/experimental/ListView'\n",
  );
  if (unstableSubpath.frappeUI.length !== 1)
    throw new Error("Import-boundary self-test did not reject unstable frappe-ui subpaths");
}

function compare(label, actual, baseline) {
  const unexpected = [...actual.keys()].filter((key) => !baseline.has(key)).sort();
  const resolved = [...baseline.keys()].filter((key) => !actual.has(key)).sort();
  if (!unexpected.length && !resolved.length) return false;
  if (unexpected.length) {
    console.error(`New ${label} violations:`);
    for (const key of unexpected) {
      const violation = actual.get(key);
      console.error(`  ${key} at line ${violation.line} (${violation.reason})`);
    }
  }
  if (resolved.length) {
    console.error(`Resolved ${label} debt still present in the baseline:`);
    for (const key of resolved) {
      const group = baseline.get(key);
      console.error(`  ${key} (owner: ${group.owner}; remove when: ${group.removal})`);
    }
  }
  return true;
}

selfTest();
const scanned = scan();
const actualBoundary = keyed(scanned.boundary);
const actualFrappeUI = keyed(scanned.frappeUI);
const failed = compare("frontend import-boundary", actualBoundary, boundaryBaseline)
  | compare("unstable frappe-ui import", actualFrappeUI, frappeUIBaseline);

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `Frontend import boundaries passed (${actualBoundary.size} owned graph violations and ${actualFrappeUI.size} unstable frappe-ui imports baselined).`,
  );
}
