import { computed, ref, type Ref } from "vue";
import { createResource } from "frappe-ui";

import { FOLDER_ICON_COLOR_MAP } from "@/apps/mail/constants";
import { userStore } from "@/apps/mail/stores/user";
import { getIcon } from "@/apps/mail/utils";
import { utcDayEnd, utcDayStart } from "@/apps/mail/utils/datetime";
import {
  getMailChoiceOperator,
  getMailContactOperator,
  getMailSearchOperatorContext,
  parseMailSearchQuery,
} from "@/apps/mail/components/CommandPalette/searchQuery";
import type {
  MailContactSuggestion,
  MailFilterSuggestion,
  MailSearchFilterBadge,
  MailSearchResult,
} from "@/apps/mail/components/CommandPalette/types";

export const mailFilterOptions = [
  { key: "inMailbox", label: "Folder", operator: "in:" },
  { key: "from", label: "From", operator: "from:" },
  { key: "to", label: "To", operator: "to:" },
  {
    key: "hasAttachment",
    label: "With attachments",
    value: "true",
    displayValue: "With attachments",
  },
  { key: "isRead", label: "Unread", value: "false", displayValue: "Unread" },
];

const FILTER_OPERATORS: Record<string, string> = {
  inMailbox: "in",
  from: "from",
  to: "to",
  cc: "cc",
  bcc: "bcc",
  subject: "subject",
  after: "after",
  before: "before",
};

export function useMailCommandPaletteSearch(
  query: Ref<string>,
  active: Ref<boolean>,
) {
  const appliedFilters = ref<MailSearchFilterBadge[]>([]);
  let mailUser: ReturnType<typeof userStore> | undefined;
  const getMailUser = () => (mailUser ??= userStore());

  const searchResource = createResource({
    auto: false,
    method: "POST",
    url: "suite.mail.api.mail.search_mails",
    debounce: 180,
  });
  const contactResource = createResource({
    auto: false,
    method: "GET",
    url: "suite.mail.api.mail.get_email_suggestions",
    debounce: 180,
  });

  const filter = computed(() => ({
    ...Object.fromEntries(
      appliedFilters.value.map(({ key, value }) => [key, value]),
    ),
    ...parseMailSearchQuery(query.value.trim()),
  }));
  const requestFilter = computed(() => ({
    ...filter.value,
    ...(filter.value.after ? { after: utcDayStart(filter.value.after) } : {}),
    ...(filter.value.before ? { before: utcDayEnd(filter.value.before) } : {}),
  }));
  const operatorContext = computed(() =>
    active.value ? getMailSearchOperatorContext(query.value) : null,
  );
  const contactOperator = computed(() =>
    active.value ? getMailContactOperator(query.value) : null,
  );
  const choiceOperator = computed(() =>
    active.value ? getMailChoiceOperator(query.value) : null,
  );

  const results = computed<MailSearchResult[]>(() => {
    if (!active.value || !Array.isArray(searchResource.data?.[0])) return [];
    return searchResource.data[0].map(
      (mail: Omit<MailSearchResult, "resultType">) => ({
        ...mail,
        resultType: "mail" as const,
      }),
    );
  });
  const contactSuggestions = computed<MailContactSuggestion[]>(() => {
    if (!contactOperator.value?.partial || !Array.isArray(contactResource.data))
      return [];
    const partial = contactOperator.value.partial;
    const contacts = contactResource.data.map(
      (contact: { email: string; name?: string; user_image?: string }) => ({
        ...contact,
        value: contact.email,
        label: contact.name || contact.email,
        resultType: "mail-contact" as const,
      }),
    );
    if (
      !contacts.some(
        (contact: MailContactSuggestion) =>
          contact.email.toLowerCase() === partial.toLowerCase(),
      )
    ) {
      contacts.push({
        resultType: "mail-contact",
        value: partial,
        label: partial,
        email: partial,
      });
    }
    return contacts;
  });
  const filterSuggestions = computed<MailFilterSuggestion[]>(() => {
    const operator = choiceOperator.value;
    if (!operator) return [];
    const partial = operator.partial.toLowerCase();
    if (operator.key === "in") {
      return (getMailUser().mailboxes.data ?? [])
        .filter((mailbox: { _name: string }) =>
          mailbox._name.toLowerCase().includes(partial),
        )
        .map(
          (mailbox: {
            id: string;
            _name: string;
            color?: keyof typeof FOLDER_ICON_COLOR_MAP;
          }) => ({
            resultType: "mail-filter-suggestion" as const,
            value: mailbox.id,
            label: mailbox._name,
            filterKey: "inMailbox",
            filterValue: mailbox.id,
            icon: getIcon(mailbox),
            iconClass: mailbox.color
              ? FOLDER_ICON_COLOR_MAP[mailbox.color]
              : undefined,
          }),
        );
    }
    const choices =
      operator.key === "has"
        ? [
            {
              value: "attachment",
              label: "With attachments",
              filterKey: "hasAttachment",
              filterValue: "true",
              icon: "paperclip",
            },
            {
              value: "no-attachment",
              label: "Without attachments",
              filterKey: "hasAttachment",
              filterValue: "false",
              icon: "ban",
            },
          ]
        : [
            {
              value: "read",
              label: "Read",
              filterKey: "isRead",
              filterValue: "true",
              icon: "mail-open",
            },
            {
              value: "unread",
              label: "Unread",
              filterKey: "isRead",
              filterValue: "false",
              icon: "mail",
            },
          ];
    return choices
      .filter(
        (choice) =>
          choice.value.includes(partial) ||
          choice.label.toLowerCase().includes(partial),
      )
      .map((choice) => ({
        resultType: "mail-filter-suggestion" as const,
        ...choice,
      }));
  });
  const suggestions = computed(() => [
    ...contactSuggestions.value,
    ...filterSuggestions.value,
  ]);
  const availableFilterOptions = computed(() => {
    const applied = new Set(appliedFilters.value.map(({ key }) => key));
    return mailFilterOptions.filter(({ key }) => !applied.has(key));
  });

  function getFilterLabel(filter: MailSearchFilterBadge) {
    if (filter.key === "hasAttachment") return filter.displayValue;
    if (filter.key === "isRead")
      return `is:${filter.value === "true" ? "read" : "unread"}`;
    return `${FILTER_OPERATORS[filter.key] ?? filter.key}:${filter.displayValue}`;
  }

  function applyFilter(key: string, value: string, displayValue = value) {
    appliedFilters.value = [
      ...appliedFilters.value.filter((filter) => filter.key !== key),
      { key, value, displayValue },
    ];
  }

  function consumeFilterToken(value: string) {
    const match = value.match(
      /(?:^|\s)(in|from|to|cc|bcc|subject|after|before|has|is):(?:"[^"]+"|\S+)\s$/i,
    );
    if (!match || match.index == null) return false;
    const token = match[0].trim();
    const separator = token.indexOf(":");
    if (token.slice(0, separator).toLowerCase() === "in") {
      const mailboxName = token.slice(separator + 1).replace(/^"|"$/g, "");
      const mailbox = (getMailUser().mailboxes.data ?? []).find(
        (candidate: { id: string; _name: string }) =>
          candidate.id === mailboxName ||
          candidate._name.toLowerCase() === mailboxName.toLowerCase(),
      );
      if (!mailbox) return false;
      applyFilter("inMailbox", mailbox.id, mailbox._name);
      query.value = value.slice(0, match.index).trim();
      return true;
    }
    const parsed = parseMailSearchQuery(token);
    const entry = Object.entries(parsed).find(([key]) => key !== "text");
    if (!entry) return false;
    const [key, filterValue] = entry;
    applyFilter(
      key,
      filterValue,
      key === "hasAttachment"
        ? filterValue === "true"
          ? "With attachments"
          : "Without attachments"
        : filterValue,
    );
    query.value = value.slice(0, match.index).trim();
    return true;
  }

  function selectContact(contact: MailContactSuggestion) {
    const operator = contactOperator.value;
    if (!operator) return;
    applyFilter(operator.key, contact.email);
    query.value = query.value
      .replace(new RegExp(`(?:^|\\s)${operator.key}:[^\\s]*$`, "i"), "")
      .trim();
  }

  function selectFilterSuggestion(suggestion: MailFilterSuggestion) {
    const operator = choiceOperator.value;
    if (!operator) return;
    applyFilter(suggestion.filterKey, suggestion.filterValue, suggestion.label);
    query.value = query.value
      .replace(new RegExp(`(?:^|\\s)${operator.key}:[^\\s]*$`, "i"), "")
      .trim();
  }

  function search(value: string, account: string) {
    if (consumeFilterToken(value)) return;
    const text = value.trim();
    if (account && contactOperator.value?.partial) {
      contactResource.submit({
        account,
        text: contactOperator.value.partial,
        limit: 5,
      });
    }
    if (operatorContext.value) {
      searchResource.reset();
      return;
    }
    if (account && (text || appliedFilters.value.length)) {
      searchResource.submit({
        account,
        filter: requestFilter.value,
        limit: 20,
      });
    } else if (!appliedFilters.value.length) {
      reset();
    }
  }

  function cancel() {
    for (const resource of [searchResource, contactResource]) {
      resource.submit.cancel();
      resource.abort();
    }
  }

  function reset() {
    cancel();
    searchResource.reset();
    contactResource.reset();
  }

  return {
    appliedFilters,
    availableFilterOptions,
    filter,
    operatorContext,
    results,
    suggestions,
    applyFilter,
    getFilterLabel,
    selectContact,
    selectFilterSuggestion,
    search,
    cancel,
    reset,
  };
}
