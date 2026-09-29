import { computed, ref, watch, type Ref } from "vue";
import { createResource } from "frappe-ui";
import { useStorage } from "@vueuse/core";

import { FOLDER_ICON_COLOR_MAP } from "@/apps/mail/constants";
import { getSessionUser } from "@/utils/session";
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
  MailRecentSearch,
  MailSearchFilterBadge,
  MailSearchResult,
} from "@/apps/mail/components/CommandPalette/types";

export interface MailFilterOption {
  key: string;
  label: string;
  /** The query operator this filter is typed as, for the ones whose value is free text or a
   *  contact. Without the colon: the query line's punctuation belongs to whoever writes it. */
  operator?: string;
  /** Applied directly, for filters that are a single choice. */
  value?: string;
}

// The few filters worth reaching for without leaving the query line. The rest of them — the ones
// that want a field of their own — live in the filter panel behind the palette's filters button.
const mailFilterOptions: MailFilterOption[] = [
  { key: "inMailbox", label: "Folder", operator: "in" },
  { key: "from", label: "From", operator: "from" },
  { key: "to", label: "To", operator: "to" },
  { key: "isRead", label: "Unread", value: "false" },
  { key: "hasAttachment", label: "With attachments", value: "true" },
];

const ALL_ACCOUNTS_STORAGE_KEY = "mail-search-all-accounts";

// The searches the reader ran last, for the phone's search page to offer before anything is
// typed. Five, since the page is a list and this is its whole content until a word arrives;
// in the browser, like the all-accounts preference — a convenience of the device someone
// searches from, and not worth a round trip on every opening. Under the user's name, since a
// browser is shared more often than a search is: what one person looked for is not the next
// person's to see on their empty page.
const RECENT_SEARCHES_STORAGE_KEY = "mail-recent-searches";
const recentSearchesKey = () =>
  `${RECENT_SEARCHES_STORAGE_KEY}:${getSessionUser() ?? "guest"}`;
const RECENT_SEARCHES = 5;

// As many mails as the palette shows at once, with the way past them being the row at the bottom
// of the results rather than a longer list to scroll.
const RESULT_LIMIT = 10;

// The filters that hold one of two answers, and the word each answer goes by in a query. A badge
// for one of these is worth clicking: there is somewhere for the click to go.
const INVERTIBLE_FILTERS: Record<string, { true: string; false: string }> = {
  hasAttachment: { true: "attachments", false: "no-attachments" },
  isRead: { true: "read", false: "unread" },
};

// Every badge is shown as the query it stands for — `from:alice@example.com`, `in:Inbox`,
// `has:attachment` — which is both the one register for all of them and the thing you would type
// to get the same filter back.
const FILTER_OPERATORS: Record<string, string> = {
  inMailbox: "in",
  from: "from",
  to: "to",
  cc: "cc",
  bcc: "bcc",
  subject: "subject",
  after: "after",
  before: "before",
  hasAttachment: "has",
  isRead: "is",
};
const operatorFor = (key: string) => FILTER_OPERATORS[key] ?? key;

export function useMailCommandPaletteSearch(
  query: Ref<string>,
  active: Ref<boolean>,
) {
  const appliedFilters = ref<MailSearchFilterBadge[]>([]);
  let mailUser: ReturnType<typeof userStore> | undefined;
  const getMailUser = () => (mailUser ??= userStore());

  // Searching every account is a property of the search, not a filter on it: it widens where the
  // same filters are asked, so it sits beside them rather than among them. The choice is
  // remembered, because someone who keeps several accounts open searches the same way each time.
  const hasMultipleAccounts = computed(
    () => (getMailUser().userResource.data?.accounts?.length ?? 0) > 1,
  );
  const allAccounts = useStorage(ALL_ACCOUNTS_STORAGE_KEY, false);
  // A preference remembered from when there were several accounts must not quietly widen a search
  // for someone who now has one — it is the toggle's own state that is kept, not its effect.
  const searchesAllAccounts = computed(
    () => allAccounts.value && hasMultipleAccounts.value,
  );
  // A folder belongs to one account, so it cannot survive the widening.
  watch(allAccounts, (value) => {
    if (value) removeFilter("inMailbox");
  });

  // The last answer, kept apart from the resource that fetched it: the resource is reset whenever
  // the query goes empty — which the palette does on its way closed — but the search it answered
  // is very often the next one asked, when the palette is reopened over the same results.
  // Keyed on the request as it was submitted, not as it stands when the reply lands: only the
  // latest submit is ever left to reply, since each keystroke aborts the one before.
  let inflightKey = "";
  let lastAnswer: { key: string; data: unknown } | null = null;

  const searchResource = createResource({
    auto: false,
    method: "POST",
    url: "suite.mail.api.mail.search_mails",
    debounce: 180,
    onSuccess: (data: unknown) => {
      lastAnswer = { key: inflightKey, data };
      settle();
    },
    onError: () => settle(),
  });
  const contactResource = createResource({
    auto: false,
    method: "GET",
    url: "suite.mail.api.mail.get_email_suggestions",
    debounce: 180,
  });

  // The filters held as badges, keyed: what the filter panel edits, and what the parsed query
  // line is laid over to make the search. `absorbQueryFilters` moves typed operators across
  // before the panel opens, so it never loses a `from:` half-typed on the line.
  const filterValues = computed(() =>
    Object.fromEntries(
      appliedFilters.value.map(({ key, value }) => [key, value]),
    ),
  );
  const filter = computed(() => ({
    ...filterValues.value,
    ...parseMailSearchQuery(query.value.trim()),
  }));
  const requestFilter = computed(() => ({
    ...filter.value,
    ...(filter.value.after ? { after: utcDayStart(filter.value.after) } : {}),
    ...(filter.value.before ? { before: utcDayEnd(filter.value.before) } : {}),
  }));
  // --- Recent searches ---

  const recentSearches = useStorage<MailRecentSearch[]>(recentSearchesKey(), []);

  // A remembered search is known by what it asked — the words and the badges — which is what
  // makes a repeat a repeat and what a row stands for. Not by `at`: two searches committed in
  // the same millisecond share one, and forgetting the second forgot both.
  const searchKey = (entry: Pick<MailRecentSearch, "text" | "filters">) =>
    `${entry.text}\u0000${JSON.stringify(entry.filters)}`;

  /**
   * Keeps the search as it stands — the words as typed and the badges as applied — as the most
   * recent, dropping an earlier copy of the same one. Called when a search is committed to,
   * not on every keystroke: opening a result, or going to the results page. Recording as the
   * query changed would have kept every prefix on the way to the word that was meant.
   */
  const rememberSearch = () => {
    const text = query.value.trim();
    const filters = filterValues.value;
    if (!text && !Object.keys(filters).length) return;
    const label = [text, ...appliedFilters.value.map(getFilterLabel)]
      .filter(Boolean)
      .join(" · ");
    const key = searchKey({ text, filters });
    recentSearches.value = [
      {
        resultType: "mail-recent-search",
        text,
        filters,
        label,
        account: account.value,
        at: Date.now(),
      },
      ...recentSearches.value.filter((entry) => searchKey(entry) !== key),
    ].slice(0, RECENT_SEARCHES);
  };

  /**
   * Puts a remembered search back as it ran: the words on the line, the badges applied. All but
   * a folder from another account, or one under a search of every account: a folder's id names
   * one account's folder and nothing in any other, and the server drops it from a search across
   * accounts — so the badge would have stood for a narrowing the search did not make.
   */
  const restoreSearch = (entry: MailRecentSearch) => {
    const { inMailbox, ...filters } = entry.filters;
    const folderApplies =
      inMailbox && entry.account === account.value && !searchesAllAccounts.value;
    setFilters(folderApplies ? { ...filters, inMailbox } : filters);
    query.value = entry.text;
  };

  const forgetSearch = (entry: MailRecentSearch) => {
    const key = searchKey(entry);
    recentSearches.value = recentSearches.value.filter((kept) => searchKey(kept) !== key);
  };

  const clearRecentSearches = () => {
    recentSearches.value = [];
  };

  const operatorContext = computed(() =>
    active.value ? getMailSearchOperatorContext(query.value) : null,
  );
  const contactOperator = computed(() =>
    active.value ? getMailContactOperator(query.value) : null,
  );
  const choiceOperator = computed(() =>
    active.value ? getMailChoiceOperator(query.value) : null,
  );

  // Whether the results on screen answer the search as it now stands. Asked of the request rather
  // than of `loading`, because a request that is aborted or reset — which every keystroke does to
  // the one before it — stops loading without ever answering anything.
  // The account is part of the question: the same words asked of a different account are a
  // different search, and an answer kept for one must not be handed back for the other.
  const account = ref("");
  const requestKey = computed(() =>
    JSON.stringify([
      account.value,
      requestFilter.value,
      searchesAllAccounts.value,
    ]),
  );
  const answeredKey = ref<string | null>(null);
  const pending = computed(
    () => active.value && answeredKey.value !== requestKey.value,
  );
  const settle = () => (answeredKey.value = requestKey.value);
  // How many mails matched in all, which `search_mails` returns beside the page it hands back.
  // What the palette shows is capped at RESULT_LIMIT, so this is how it knows whether there is
  // anything past the rows on screen.
  const answer = computed<
    [Omit<MailSearchResult, "resultType">[], number] | null
  >(() =>
    active.value && Array.isArray(searchResource.data?.[0])
      ? searchResource.data
      : null,
  );
  const total = computed(() => Number(answer.value?.[1] ?? 0));
  const results = computed<MailSearchResult[]>(() => {
    if (!answer.value) return [];
    return answer.value[0].map(
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
    return `${operatorFor(filter.key)}:${filter.displayValue}`;
  }

  // One rule for what a badge says, so a filter reads the same however it arrived: typed as an
  // operator, chosen from a suggestion, set in the filter panel, or flipped where it stands.
  function badgeFor(key: string, value: string): MailSearchFilterBadge {
    const answers = INVERTIBLE_FILTERS[key];
    if (answers)
      return { key, value, displayValue: answers[value === "true" ? "true" : "false"] };
    if (key === "inMailbox")
      return { key, value, displayValue: findMailbox(value)?._name ?? value };
    return { key, value, displayValue: value };
  }

  function applyFilter(key: string, value: string) {
    appliedFilters.value = [
      ...appliedFilters.value.filter((filter) => filter.key !== key),
      badgeFor(key, value),
    ];
  }

  // `in:` names a folder, and only this composable can turn the name into the id the filter
  // wants — the parser leaves it alone. So folders come out of the query line first, here, and
  // the parser is handed what is left; a name no folder answers to stays as the words typed.
  function findMailbox(name: string) {
    const wanted = name.replace(/^"|"$/g, "");
    return (getMailUser().mailboxes.data ?? []).find(
      (mailbox: { id: string; _name: string }) =>
        mailbox.id === wanted ||
        mailbox._name.toLowerCase() === wanted.toLowerCase(),
    ) as { id: string; _name: string } | undefined;
  }

  function absorbQueryFilters() {
    let inMailbox: string | undefined;
    const rest = query.value
      .trim()
      .replace(/(^|\s)in:("[^"]*"|\S+)/gi, (token, lead, name) => {
        const mailbox = findMailbox(name);
        if (!mailbox) return token;
        inMailbox = mailbox.id;
        return lead;
      });
    const { text = "", ...operators } = parseMailSearchQuery(rest.trim());
    if (inMailbox) operators.inMailbox = inMailbox;
    if (!Object.keys(operators).length) return;
    setFilters({ ...filterValues.value, ...operators });
    query.value = text;
  }

  const canInvert = (key: string) => Boolean(INVERTIBLE_FILTERS[key]);

  // Inverted where it stands, rather than removed and re-applied: a badge that jumped to the end of
  // the row on every click would be a poor thing to click twice.
  function invertFilter(key: string) {
    if (!INVERTIBLE_FILTERS[key]) return;
    appliedFilters.value = appliedFilters.value.map((filter) =>
      filter.key === key
        ? badgeFor(key, filter.value === "true" ? "false" : "true")
        : filter,
    );
  }

  // The badge already reads as the token that set it, so clicking it hands that token back to the
  // query line — where it can be corrected, finished, or deleted like anything else typed there.
  // It stays text until a space closes it again, which is what `consumeFilterToken` waits for.
  //
  // Returns where the value sits in the new query, so the caller can select it: the operator was
  // never in question, and typing should replace what the filter was set to.
  function editFilter(key: string) {
    const filter = appliedFilters.value.find((entry) => entry.key === key);
    if (!filter) return null;
    removeFilter(key);
    const operator = operatorFor(key);
    const value = /\s/.test(filter.displayValue)
      ? `"${filter.displayValue}"`
      : filter.displayValue;
    const existing = findOperatorValue(operator);
    if (existing) {
      query.value =
        query.value.slice(0, existing.start) +
        value +
        query.value.slice(existing.end);
      return { start: existing.start, end: existing.start + value.length };
    }
    return appendOperator(operator, value);
  }

  // Asks the query line for an operator, for the filter row's buttons: the one already there if it
  // has one — pointing at its value, so a second press lands on what was typed rather than adding
  // another empty `from:` — and a fresh one at the end otherwise.
  function useOperator(operator: string) {
    return findOperatorValue(operator) ?? appendOperator(operator);
  }

  // Where an operator's value sits on the query line, if that operator is already on it. Two
  // `from:` tokens are not two senders, they are one sender and a question about which one means
  // it — so everything that writes an operator asks here first.
  function findOperatorValue(operator: string) {
    const match = query.value.match(
      new RegExp(`(^|\\s)${operator}:("[^"]*"|\\S*)`, "i"),
    );
    if (match?.index == null) return null;
    const start = match.index + match[1].length + operator.length + 1;
    return { start, end: start + match[2].length };
  }

  function appendOperator(operator: string, value = "") {
    const text = query.value.trimEnd();
    const prefix = `${text}${text ? " " : ""}${operator}:`;
    query.value = `${prefix}${value}`;
    return { start: prefix.length, end: prefix.length + value.length };
  }

  function removeFilter(key: string) {
    appliedFilters.value = appliedFilters.value.filter(
      (filter) => filter.key !== key,
    );
  }

  function setFilters(filters: Record<string, string>) {
    appliedFilters.value = Object.entries(filters).map(([key, value]) =>
      badgeFor(key, value),
    );
  }

  function consumeFilterToken(value: string) {
    const match = value.match(
      /(?:^|\s)(in|from|to|cc|bcc|subject|after|before|has|is):(?:"[^"]+"|\S+)\s$/i,
    );
    if (!match || match.index == null) return false;
    const token = match[0].trim();
    const separator = token.indexOf(":");
    if (token.slice(0, separator).toLowerCase() === "in") {
      const mailbox = findMailbox(token.slice(separator + 1));
      if (!mailbox) return false;
      applyFilter("inMailbox", mailbox.id);
      query.value = value.slice(0, match.index).trim();
      return true;
    }
    const parsed = parseMailSearchQuery(token);
    const entry = Object.entries(parsed).find(([key]) => key !== "text");
    if (!entry) return false;
    const [key, filterValue] = entry;
    applyFilter(key, filterValue);
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
    applyFilter(suggestion.filterKey, suggestion.filterValue);
    query.value = query.value
      .replace(new RegExp(`(?:^|\\s)${operator.key}:[^\\s]*$`, "i"), "")
      .trim();
  }

  function search(value: string, forAccount: string) {
    account.value = forAccount;
    if (consumeFilterToken(value)) return;
    const text = value.trim();
    if (forAccount && contactOperator.value?.partial) {
      contactResource.submit({
        account: forAccount,
        text: contactOperator.value.partial,
        limit: 5,
      });
    }
    if (operatorContext.value) {
      searchResource.reset();
      settle();
      return;
    }
    if (forAccount && (text || appliedFilters.value.length)) {
      // The same question, already answered: the rows on screen are that answer. Asking again
      // would blank them for as long as it took the very same rows to come back — which is what
      // going into the filter panel and straight back out used to do.
      if (!pending.value && searchResource.data) return;
      // Asked before and answered, since — handed the same answer back, without a request or
      // the blank that waiting for one would show.
      if (lastAnswer?.key === requestKey.value) {
        searchResource.setData(lastAnswer.data);
        settle();
        return;
      }
      inflightKey = requestKey.value;
      searchResource.reset();
      searchResource.submit({
        account: forAccount,
        filter: requestFilter.value,
        limit: RESULT_LIMIT,
        all_accounts: searchesAllAccounts.value,
      });
    } else {
      if (!appliedFilters.value.length) reset();
      settle();
    }
  }

  function cancel() {
    for (const resource of [searchResource, contactResource]) {
      resource.submit.cancel();
      resource.abort();
    }
  }

  function reset() {
    settle();
    cancel();
    searchResource.reset();
    contactResource.reset();
  }

  return {
    allAccounts,
    appliedFilters,
    searchesAllAccounts,
    availableFilterOptions,
    filter,
    filterValues,
    pending,
    hasMultipleAccounts,
    operatorContext,
    results,
    suggestions,
    total,
    absorbQueryFilters,
    applyFilter,
    canInvert,
    editFilter,
    invertFilter,
    useOperator,
    removeFilter,
    setFilters,
    getFilterLabel,
    selectContact,
    selectFilterSuggestion,
    search,
    cancel,
    reset,
    recentSearches,
    rememberSearch,
    restoreSearch,
    forgetSearch,
    clearRecentSearches,
    searchKey,
  };
}
