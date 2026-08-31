const SUGGESTION_LIMIT = 8;
const SEARCH_LIMIT = 8;

/** Turn the visible filters into the options shared by suggest and search. */
function mapStructuredFilterOptions(filters = {}) {
  const where = {};

  addFilter(where, "types", filters.types, false, false);
  addFilter(
    where,
    "tagsAny",
    filters.tagsAny === undefined ? filters.tags : filters.tagsAny,
    true,
  );
  addFilter(where, "statuses", filters.statuses);
  addFilter(where, "trustTiers", filters.trustTiers);
  addFilter(where, "conformance", filters.conformance);

  if (filters.stale === "current") where.stale = false;
  else if (filters.stale === "stale") where.stale = true;
  else if (filters.stale === true || filters.stale === false) {
    where.stale = filters.stale;
  }

  const options = {};
  if (Object.keys(where).length > 0) options.where = where;

  const asOf = asDate(filters.asOf);
  if (asOf) options.asOf = asOf;

  return options;
}

/** Map visible filters to the deliberate autoSuggest policy. */
export function mapFilterOptions(filters = {}) {
  return { limit: SUGGESTION_LIMIT, ...mapStructuredFilterOptions(filters) };
}

/** Map visible filters to the independent committed-search policy. */
export function mapSearchOptions(filters = {}) {
  return { limit: SEARCH_LIMIT, ...mapStructuredFilterOptions(filters) };
}

/** Choose the phrase committed by Enter or an active suggestion. */
export function resolveCommittedQuery(query, activeSuggestion) {
  if (typeof activeSuggestion?.suggestion === "string") {
    return activeSuggestion.suggestion.trim();
  }
  return typeof query === "string" ? query.trim() : "";
}

/** Suppress commit and close keys while an IME owns the event. */
export function isCompositionKey(event) {
  return Boolean(event?.isComposing) || event?.keyCode === 229;
}

/** Resolve keyboard input to the committed-search action used by the controller. */
export function resolveSearchKeyAction(event, query, activeSuggestion) {
  if (isCompositionKey(event)) return { type: "composition" };
  if (event?.key === "Escape") return { type: "close" };
  if (event?.key !== "Enter") return { type: "ignore" };

  const committedQuery = resolveCommittedQuery(query, activeSuggestion);
  return committedQuery
    ? { type: "commit", query: committedQuery }
    : { type: "ignore" };
}

/** Convert one public search hit to strings that the DOM renders as text. */
export function toSearchResultText(hit = {}) {
  const matchedFields = Array.from(hit.matchedFields ?? [], textValue);
  return {
    title: textValue(hit.title),
    path: textValue(hit.path),
    headingPath: textValue(hit.headingPath),
    snippet: textValue(hit.snippet),
    conformance: textValue(hit.conformance),
    lineRange: formatLineRange(hit.startLine, hit.endLine),
    matchedFields,
    score: formatScore(hit.score),
  };
}

/** Own committed-search calls and their replace-only result state. */
export function createCommittedSearchSession(search) {
  let state = blankSearchState();

  return {
    get state() {
      return state;
    },
    invalidate() {
      state = blankSearchState();
      return state;
    },
    commit(query, filters = {}) {
      const committedQuery = resolveCommittedQuery(query);
      if (!committedQuery) {
        state = blankSearchState();
        return state;
      }

      try {
        const hits = Array.from(
          search(committedQuery, mapSearchOptions(filters)),
          toSearchResultText,
        ).slice(0, SEARCH_LIMIT);
        state = hits.length > 0
          ? {
              status: "ready",
              message: `${hits.length} document${hits.length === 1 ? "" : "s"} found for “${committedQuery}”.`,
              query: committedQuery,
              hits,
            }
          : {
              status: "empty",
              message: `No documents found for “${committedQuery}”. Try a broader phrase or adjust the filters.`,
              query: committedQuery,
              hits: [],
            };
      } catch {
        state = {
          status: "error",
          message: `Search failed for “${committedQuery}”. Check the filters and try again.`,
          query: committedQuery,
          hits: [],
        };
      }
      return state;
    },
  };
}

function blankSearchState() {
  return {
    status: "blank",
    message: "Search results appear after you choose a suggestion or press Enter.",
    query: "",
    hits: [],
  };
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function addFilter(
  where,
  key,
  value,
  commaSeparated = false,
  trimValues = true,
) {
  const values = uniqueStrings(value, commaSeparated, trimValues);
  if (values.length > 0) where[key] = values;
}

function uniqueStrings(value, commaSeparated = false, trimValues = true) {
  const candidates = typeof value === "string"
    ? (commaSeparated ? value.split(",") : [value])
    : Array.isArray(value)
      ? value
      : [];
  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const item = trimValues ? candidate.trim() : candidate;
    if (!item.trim() || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }

  return result;
}

function asDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : new Date(value.getTime());
  }
  if (typeof value !== "string" || !value.trim()) return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Return the in-memory path assigned to a selected browser file. */
export function uploadPath(fileOrName) {
  const name = typeof fileOrName === "string"
    ? fileOrName
    : fileOrName && typeof fileOrName.name === "string"
      ? fileOrName.name
      : "";
  return `uploads/${name}`;
}

/** Decode bytes strictly so replacement characters never enter the index. */
export function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Read one selected file without writing it anywhere. */
export async function readUpload(file) {
  const path = uploadPath(file);
  if (!file || typeof file.arrayBuffer !== "function") {
    throw diagnosticError({
      code: "ERR_OKF_READ",
      path,
      message: "Selected upload is not a readable File.",
    });
  }

  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw diagnosticError({
      code: "ERR_OKF_READ",
      path,
      message: "Cannot read the selected file.",
    });
  }

  return { path, markdown: decodeUtf8(bytes) };
}

/** Move through the visible listbox without trapping Tab. */
export function moveActiveIndex(index, key, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;

  const current = Number.isInteger(index) && index >= 0 && index < itemCount
    ? index
    : -1;

  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return current < 0
    ? 0
    : (current + 1) % itemCount;
  if (key === "ArrowUp") return current < 0
    ? itemCount - 1
    : (current - 1 + itemCount) % itemCount;
  return current;
}

/** Own the keyboard-visible combobox state independently of the DOM. */
export function transitionCombobox(state, key, itemCount) {
  const current = {
    activeIndex: Number.isInteger(state?.activeIndex) ? state.activeIndex : -1,
    open: Boolean(state?.open),
  };

  if (key === "Escape") return { activeIndex: -1, open: false };
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return current;

  const activeIndex = moveActiveIndex(current.activeIndex, key, itemCount);
  return { activeIndex, open: activeIndex >= 0 };
}

function startWhenReady() {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const start = () => {
    const controller = createController(document, window);
    void controller.initialize();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

function createController(documentRef, windowRef) {
  const elements = {
    corpusStatus: documentRef.getElementById("corpus-status"),
    corpusStatusText: documentRef.getElementById("corpus-status-text"),
    filtersForm: documentRef.getElementById("filters-form"),
    typeOptions: documentRef.getElementById("type-options"),
    tagFilter: documentRef.getElementById("tag-filter"),
    asOf: documentRef.getElementById("as-of"),
    query: documentRef.getElementById("query"),
    suggestionList: documentRef.getElementById("suggestion-list"),
    completionState: documentRef.getElementById("completion-state"),
    searchResults: documentRef.getElementById("search-results"),
    searchStatus: documentRef.getElementById("search-status"),
    fileInput: documentRef.getElementById("upload-files"),
    uploadStatus: documentRef.getElementById("upload-status"),
    uploadOutcomes: documentRef.getElementById("upload-outcomes"),
    diagnosticsStatus: documentRef.getElementById("diagnostics-status"),
    diagnosticsList: documentRef.getElementById("diagnostics-list"),
    appError: documentRef.getElementById("app-error"),
  };

  let api;
  let handle;
  let indexedPaths = new Set();
  let seedFailures = [];
  let uploadOutcomes = [];
  let suggestions = [];
  let activeIndex = -1;
  let ready = false;
  const committedSearch = createCommittedSearchSession((query, options) =>
    handle.search(query, options));

  function initialize() {
    setControlsEnabled(false);
    setCorpusStatus("loading", "Loading sample bundle…");
    setCompletionState("loading", "Loading the sample bundle…");
    setDiagnostics([], "loading", "Waiting for the index…");

    api = windowRef.OkfMiniSearch;
    if (!hasPublicApi(api)) {
      showFatal(
        "CDN unavailable",
        "The okf-minisearch browser API did not load from jsDelivr. Check your network connection and reload.",
      );
      return Promise.resolve();
    }

    try {
      handle = api.createOkfSearch([]);
    } catch (error) {
      showFatal("CDN unavailable", errorMessage(error));
      return Promise.resolve();
    }

    wireEvents();
    setReferenceTime(documentRef);

    return loadSampleBundle()
      .then(() => {
        ready = true;
        setControlsEnabled(true);
        setUploadStatus("ready", "Ready for Markdown uploads. Files stay in memory.");
        refreshIndex();
      })
      .catch((error) => {
        showFatal(
          "Manifest unavailable",
          `${errorMessage(error)} Check that this project is served over HTTP, then reload.`,
        );
      });
  }

  function wireEvents() {
    elements.filtersForm?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    elements.filtersForm?.addEventListener("input", onVisibleControlsChanged);
    elements.filtersForm?.addEventListener("change", onVisibleControlsChanged);
    elements.query?.addEventListener("input", onVisibleControlsChanged);
    elements.query?.addEventListener("keydown", onQueryKeydown);
    elements.query?.addEventListener("focus", () => {
      if (suggestions.length > 0 && elements.query.value.trim()) {
        openSuggestions();
      }
    });
    elements.query?.addEventListener("blur", closeAfterBlur);
    elements.suggestionList?.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.('[role="option"]')) event.preventDefault();
    });
    elements.suggestionList?.addEventListener("click", (event) => {
      const option = event.target.closest?.('[role="option"]');
      if (!option) return;
      acceptSuggestion(Number(option.dataset.index));
    });
    elements.fileInput?.addEventListener("change", () => {
      const files = elements.fileInput.files
        ? Array.from(elements.fileInput.files)
        : [];
      void processUploads(files);
    });
  }

  async function loadSampleBundle() {
    const sampleBase = new URL("./assets/sample-bundle/", import.meta.url);
    const manifestUrl = new URL("./assets/sample-bundle/manifest.json", import.meta.url);
    const response = await fetchFromWindow(windowRef, manifestUrl);
    if (!response.ok) {
      throw new Error(`The sample manifest request failed (${response.status}).`);
    }

    let loadedManifest;
    try {
      loadedManifest = await response.json();
    } catch {
      throw new Error("The sample manifest is not valid JSON.");
    }
    if (!isManifest(loadedManifest)) {
      throw new Error("The sample manifest has no valid document list.");
    }

    seedFailures = [];
    indexedPaths = new Set();

    for (const entry of loadedManifest.documents) {
      try {
        const input = await loadSampleDocument(sampleBase, entry);
        handle.ingest(input);
        indexedPaths.add(input.path);
      } catch (error) {
        const diagnostic = toDiagnostic(error, entry.path, "ERR_OKF_READ");
        seedFailures.push({
          path: entry.path,
          diagnostics: [diagnostic],
        });
        if (diagnostic.code === "ERR_OKF_INDEX_UNUSABLE") {
          throw error;
        }
      }
    }
  }

  async function loadSampleDocument(sampleBase, entry) {
    if (!isSafeManifestPath(entry.path)) {
      throw diagnosticError({
        code: "ERR_OKF_FIELD",
        path: entry.path,
        field: "path",
        message: "Manifest document paths must be relative Markdown paths.",
      });
    }

    const response = await fetchFromWindow(windowRef, new URL(entry.path, sampleBase));
    if (!response.ok) {
      throw diagnosticError({
        code: "ERR_OKF_READ",
        path: entry.path,
        message: `Cannot load sample document (${response.status}).`,
      });
    }

    let bytes;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      throw diagnosticError({
        code: "ERR_OKF_READ",
        path: entry.path,
        message: "Cannot read the sample document bytes.",
      });
    }

    let markdown;
    try {
      markdown = decodeUtf8(bytes);
    } catch {
      throw diagnosticError({
        code: "ERR_OKF_PARSE",
        path: entry.path,
        message: "Cannot decode the sample document as UTF-8.",
      });
    }

    return { path: entry.path, markdown };
  }

  async function processUploads(files) {
    if (!ready || files.length === 0) return;

    clearSearchResults();
    uploadOutcomes = [];
    setUploadStatus("uploading", `Reading ${files.length} Markdown file${files.length === 1 ? "" : "s"}…`);
    setUploadEnabled(false);

    for (const file of files) {
      let outcome;
      try {
        outcome = await processUpload(file);
      } catch (error) {
        outcome = {
          state: "fatal",
          path: uploadPath(file),
          diagnostics: [toDiagnostic(error, uploadPath(file), "ERR_OKF_PARSE")],
        };
      }
      uploadOutcomes.push(outcome);
      renderUploadOutcomes();
    }

    try {
      refreshIndex();
      const summary = summarizeUploads(uploadOutcomes);
      setUploadStatus("ready", summary);
    } catch (error) {
      setUploadStatus("error", `Upload finished, but the index could not be refreshed: ${errorMessage(error)}`);
      showFatal("Index unavailable", errorMessage(error));
    } finally {
      setUploadEnabled(ready);
      if (elements.fileInput) elements.fileInput.value = "";
    }
  }

  async function processUpload(file) {
    const path = uploadPath(file);

    let input;
    try {
      input = await readUpload(file);
    } catch (error) {
      return {
        state: "fatal",
        path,
        diagnostics: [toDiagnostic(error, path, "ERR_OKF_PARSE")],
      };
    }

    let validation;
    try {
      validation = api.validateOkfDocument(input);
    } catch (error) {
      return {
        state: "fatal",
        path,
        diagnostics: [toDiagnostic(error, path, "ERR_OKF_PARSE")],
      };
    }

    if (!validation.isIndexable) {
      const diagnostics = Array.isArray(validation.errors)
        ? Array.from(validation.errors)
        : [toDiagnostic(
            new Error("The validator returned no diagnostics."),
            path,
            "ERR_OKF_PARSE",
          )];
      return {
        state: "rejected",
        path,
        diagnostics,
      };
    }

    try {
      const result = handle.ingest(input);
      indexedPaths.add(path);
      if (result.conformance === "degraded") {
        return {
          state: "degraded",
          path: result.path,
          diagnostics: Array.from(result.diagnostics),
        };
      }
      return {
        state: "strict",
        path,
        detail: "Indexed strictly in memory.",
      };
    } catch (error) {
      return {
        state: "fatal",
        path,
        diagnostics: [toDiagnostic(error, path, "ERR_OKF_PARSE")],
      };
    }
  }

  function refreshIndex() {
    if (!handle) return;

    clearSearchResults();
    const types = Array.from(handle.listTypes());
    renderTypes(types);

    const degraded = Array.from(handle.listDegradedDocuments());
    setDiagnostics(degraded, degraded.length || seedFailures.length ? "degraded" : "ready");
    updateCorpusStatus(types, degraded);
    refreshSuggestions();
  }

  function onVisibleControlsChanged() {
    clearSearchResults();
    refreshSuggestions();
  }

  function refreshSuggestions() {
    if (!ready || !handle) return;

    const query = elements.query.value.trim();
    if (!query) {
      suggestions = [];
      activeIndex = -1;
      closeSuggestions();
      setCompletionState("blank", "Type a phrase to see up to eight completions.");
      return;
    }

    try {
      const options = mapFilterOptions(readFilterValues());
      suggestions = Array.from(handle.autoSuggest(query, options)).slice(0, SUGGESTION_LIMIT);
      activeIndex = -1;
      renderSuggestions();
      if (suggestions.length === 0) {
        setCompletionState("empty", "No completion matches those filters. Try a shorter phrase or loosen a filter.");
      } else {
        setCompletionState("ready", `${suggestions.length} completion${suggestions.length === 1 ? "" : "s"} available. Use ↑ and ↓, then Enter to accept.`);
      }
    } catch (error) {
      suggestions = [];
      activeIndex = -1;
      closeSuggestions();
      setCompletionState("error", `Suggestions unavailable: ${errorMessage(error)}`);
    }
  }

  function readFilterValues() {
    const form = elements.filtersForm;
    if (!form) return {};

    return {
      types: checkedValues(form, "types"),
      tagsAny: elements.tagFilter?.value ?? "",
      statuses: checkedValues(form, "statuses"),
      trustTiers: checkedValues(form, "trustTiers"),
      stale: form.querySelector('input[name="stale"]:checked')?.value ?? "any",
      conformance: checkedValues(form, "conformance"),
      asOf: elements.asOf?.value ?? "",
    };
  }

  function checkedValues(form, name) {
    return Array.from(
      form.querySelectorAll(`input[name="${name}"]:checked`),
      (input) => input.value,
    );
  }

  function renderTypes(types) {
    if (!elements.typeOptions) return;
    const previous = new Set(checkedValues(elements.filtersForm, "types"));
    elements.typeOptions.replaceChildren();

    if (types.length === 0) {
      const empty = documentRef.createElement("span");
      empty.className = "muted-choice";
      empty.textContent = "No types in the index.";
      elements.typeOptions.append(empty);
      return;
    }

    for (const type of types) {
      const label = documentRef.createElement("label");
      label.className = "check-label";
      const input = documentRef.createElement("input");
      input.type = "checkbox";
      input.name = "types";
      input.value = type;
      input.checked = previous.has(type);
      const text = documentRef.createElement("span");
      text.textContent = type;
      label.append(input, text);
      elements.typeOptions.append(label);
    }
  }

  function renderSuggestions() {
    const list = elements.suggestionList;
    if (!list) return;
    list.replaceChildren();

    if (suggestions.length === 0) {
      closeSuggestions();
      return;
    }

    for (const [index, item] of suggestions.entries()) {
      const option = documentRef.createElement("li");
      option.id = `suggestion-${index}`;
      option.dataset.index = String(index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === activeIndex));

      const text = documentRef.createElement("span");
      text.className = "suggestion-text";
      text.textContent = item.suggestion;

      const score = documentRef.createElement("span");
      score.className = "suggestion-score";
      score.textContent = `score ${formatScore(item.score)}`;

      const terms = documentRef.createElement("span");
      terms.className = "suggestion-terms";
      terms.append("terms: ");
      const termList = Array.from(item.terms ?? [], String);
      terms.append(documentRef.createTextNode(termList.join(" · ") || "—"));

      option.append(text, score, terms);
      list.append(option);
    }

    openSuggestions();
    syncActiveDescendant();
  }

  function onQueryKeydown(event) {
    if (!ready) return;

    const activeSuggestion = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
    const action = resolveSearchKeyAction(
      event,
      elements.query?.value,
      activeSuggestion,
    );
    if (action.type === "composition") return;

    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && suggestions.length > 0) {
      event.preventDefault();
      const state = transitionCombobox(
        { activeIndex, open: !elements.suggestionList?.hidden },
        event.key,
        suggestions.length,
      );
      activeIndex = state.activeIndex;
      if (state.open) openSuggestions();
      syncActiveDescendant();
      return;
    }

    if (action.type === "commit") {
      event.preventDefault();
      if (activeSuggestion) {
        acceptCommittedSuggestion(action.query);
      } else {
        closeSuggestions();
        commitSearch(action.query);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      closeSuggestions();
      return;
    }

    if (action.type === "close") {
      event.preventDefault();
      const state = transitionCombobox(
        { activeIndex, open: true },
        event.key,
        suggestions.length,
      );
      activeIndex = state.activeIndex;
      if (!state.open) closeSuggestions();
    }
  }

  function acceptSuggestion(index) {
    const item = suggestions[index];
    if (!item || !elements.query) return;
    const action = resolveSearchKeyAction(
      { key: "Enter" },
      elements.query.value,
      item,
    );
    if (action.type === "commit") acceptCommittedSuggestion(action.query);
  }

  function acceptCommittedSuggestion(query) {
    elements.query.value = query;
    activeIndex = -1;
    closeSuggestions();
    setCompletionState("ready", `Accepted “${query}”.`);
    commitSearch(query);
  }

  function commitSearch(query) {
    if (!handle) {
      clearSearchResults();
      return;
    }

    elements.searchResults?.setAttribute("aria-busy", "true");
    const state = committedSearch.commit(query, readFilterValues());
    renderCommittedSearch(state);
    elements.searchResults?.setAttribute("aria-busy", "false");
  }

  function clearSearchResults() {
    renderCommittedSearch(committedSearch.invalidate());
  }

  function renderCommittedSearch(state) {
    renderSearchResults(state.hits);
    setSearchStatus(state.status, state.message);
  }

  function renderSearchResults(hits) {
    const list = elements.searchResults;
    if (!list) return;
    list.replaceChildren();

    for (const hit of hits) {
      const item = documentRef.createElement("li");
      const article = documentRef.createElement("article");
      article.className = "search-hit";

      const heading = documentRef.createElement("h3");
      heading.textContent = hit.title;

      const path = documentRef.createElement("div");
      path.className = "hit-path";
      path.textContent = hit.lineRange
        ? `${hit.path} · ${hit.lineRange}`
        : hit.path;

      article.append(heading, path);

      if (hit.headingPath.trim()) {
        const headingPath = documentRef.createElement("div");
        headingPath.className = "hit-heading-path";
        headingPath.textContent = hit.headingPath;
        article.append(headingPath);
      }

      const snippet = documentRef.createElement("p");
      snippet.className = "hit-snippet";
      snippet.textContent = hit.snippet;

      const meta = documentRef.createElement("div");
      meta.className = "hit-meta";
      meta.textContent = `${hit.conformance} · matched ${hit.matchedFields.join(", ") || "—"} · score ${hit.score}`;

      article.append(snippet, meta);
      item.append(article);
      list.append(item);
    }
  }

  function closeAfterBlur() {
    // Let a pointer click on an option finish before closing the listbox.
    windowRef.setTimeout(() => {
      if (documentRef.activeElement !== elements.query) closeSuggestions();
    }, 0);
  }

  function openSuggestions() {
    if (!elements.suggestionList || !elements.query || suggestions.length === 0) return;
    elements.suggestionList.hidden = false;
    elements.query.setAttribute("aria-expanded", "true");
  }

  function closeSuggestions() {
    activeIndex = -1;
    if (!elements.suggestionList || !elements.query) return;
    elements.suggestionList.hidden = true;
    elements.query.setAttribute("aria-expanded", "false");
    elements.query.setAttribute("aria-activedescendant", "");
    for (const option of elements.suggestionList.querySelectorAll('[role="option"]')) {
      option.setAttribute("aria-selected", "false");
    }
  }

  function syncActiveDescendant() {
    if (!elements.query || !elements.suggestionList) return;
    const active = activeIndex >= 0
      ? elements.suggestionList.querySelector(`#suggestion-${activeIndex}`)
      : null;
    elements.query.setAttribute("aria-activedescendant", active?.id ?? "");
    for (const option of elements.suggestionList.querySelectorAll('[role="option"]')) {
      option.setAttribute("aria-selected", String(option === active));
    }
  }

  function setControlsEnabled(enabled) {
    if (elements.filtersForm) {
      for (const control of elements.filtersForm.elements) control.disabled = !enabled;
    }
    if (elements.query) elements.query.disabled = !enabled;
    setUploadEnabled(enabled);
  }

  function setUploadEnabled(enabled) {
    if (elements.fileInput) elements.fileInput.disabled = !enabled;
  }

  function setCorpusStatus(state, text) {
    if (!elements.corpusStatus) return;
    elements.corpusStatus.dataset.state = state;
    if (elements.corpusStatusText) elements.corpusStatusText.textContent = text;
  }

  function updateCorpusStatus(types, degraded) {
    const count = indexedPaths.size;
    const issueText = degraded.length + seedFailures.length > 0
      ? `${degraded.length + seedFailures.length} needs attention`
      : "strict";
    setCorpusStatus(
      degraded.length + seedFailures.length > 0 ? "degraded" : "ready",
      `${count} docs · ${types.length} types · ${issueText}`,
    );
  }

  function setCompletionState(state, text) {
    if (!elements.completionState) return;
    elements.completionState.dataset.state = state;
    elements.completionState.textContent = text;
  }

  function setSearchStatus(state, text) {
    if (!elements.searchStatus) return;
    elements.searchStatus.dataset.state = state;
    elements.searchStatus.textContent = text;
  }

  function setUploadStatus(state, text) {
    if (!elements.uploadStatus) return;
    elements.uploadStatus.dataset.state = state;
    elements.uploadStatus.textContent = text;
  }

  function renderUploadOutcomes() {
    if (!elements.uploadOutcomes) return;
    elements.uploadOutcomes.replaceChildren();

    for (const outcome of uploadOutcomes) {
      const item = documentRef.createElement("li");
      item.dataset.state = outcome.state;

      const label = documentRef.createElement("span");
      label.className = "outcome-label";
      label.textContent = `${outcome.state} · ${outcome.path}`;
      item.append(label);

      if (outcome.detail) {
        const detail = documentRef.createElement("span");
        detail.className = "outcome-details";
        detail.textContent = outcome.detail;
        item.append(detail);
      }
      for (const diagnostic of outcome.diagnostics ?? []) {
        appendDiagnostic(item, diagnostic, "outcome-details");
      }
      elements.uploadOutcomes.append(item);
    }
  }

  function setDiagnostics(degraded, state, emptyText) {
    if (elements.diagnosticsStatus) {
      elements.diagnosticsStatus.dataset.state = state;
      elements.diagnosticsStatus.textContent = emptyText ?? diagnosticsSummary(degraded);
    }
    if (!elements.diagnosticsList) return;
    elements.diagnosticsList.replaceChildren();

    for (const document of degraded) {
      const block = documentRef.createElement("section");
      block.className = "diagnostic-document";
      const heading = documentRef.createElement("h3");
      heading.textContent = document.path;
      block.append(heading);
      const list = documentRef.createElement("ul");
      for (const diagnostic of document.diagnostics) appendDiagnostic(list, diagnostic, "");
      block.append(list);
      elements.diagnosticsList.append(block);
    }

    for (const failure of seedFailures) {
      const block = documentRef.createElement("section");
      block.className = "diagnostic-document";
      const heading = documentRef.createElement("h3");
      heading.textContent = `${failure.path} · sample load`;
      block.append(heading);
      const list = documentRef.createElement("ul");
      for (const diagnostic of failure.diagnostics) appendDiagnostic(list, diagnostic, "");
      block.append(list);
      elements.diagnosticsList.append(block);
    }
  }

  function appendDiagnostic(parent, diagnostic, className) {
    const item = documentRef.createElement("li");
    if (className) item.className = className;

    const code = documentRef.createElement("span");
    code.className = "diagnostic-code";
    code.textContent = diagnostic.code;
    item.append(code);
    if (diagnostic.field) {
      const field = documentRef.createElement("span");
      field.className = "diagnostic-field";
      field.textContent = ` · ${diagnostic.field}`;
      item.append(field);
    }
    const message = documentRef.createElement("span");
    message.textContent = ` — ${diagnostic.message}`;
    item.append(message);
    parent.append(item);
  }

  function diagnosticsSummary(degraded) {
    const count = degraded.length + seedFailures.length;
    if (count === 0) return "No degraded documents. The current index is strict.";
    return `${count} document${count === 1 ? "" : "s"} need attention.`;
  }

  function summarizeUploads(outcomes) {
    const counts = new Map();
    for (const outcome of outcomes) counts.set(outcome.state, (counts.get(outcome.state) ?? 0) + 1);
    const parts = [];
    for (const state of ["strict", "degraded", "rejected", "fatal"]) {
      const count = counts.get(state);
      if (count) parts.push(`${count} ${state}`);
    }
    return `Upload complete: ${parts.join(" · ")}. Files stay in memory.`;
  }

  function showFatal(title, detail) {
    ready = false;
    clearSearchResults();
    setControlsEnabled(false);
    setCorpusStatus("error", title);
    setCompletionState("error", detail);
    setDiagnostics([], "error", detail);
    if (elements.appError) {
      elements.appError.hidden = false;
      elements.appError.textContent = `${title}: ${detail}`;
    }
  }

  return { initialize };
}

function hasPublicApi(candidate) {
  return Boolean(candidate) &&
    typeof candidate.createOkfSearch === "function" &&
    typeof candidate.validateOkfDocument === "function";
}

function fetchFromWindow(windowRef, url) {
  if (typeof windowRef.fetch !== "function") {
    return Promise.reject(new Error("This browser does not provide fetch."));
  }
  return windowRef.fetch(url);
}

function isManifest(value) {
  return Boolean(value) && typeof value === "object" &&
    value.schemaVersion === 1 &&
    Number.isInteger(value.documentCount) &&
    Array.isArray(value.documents) &&
    value.documentCount === value.documents.length &&
    value.documents.every((entry) =>
      Boolean(entry) && typeof entry.path === "string" &&
      Number.isInteger(entry.bytes) && entry.bytes >= 0,
    );
}

function isSafeManifestPath(path) {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  return path.endsWith(".md") &&
    !segments.includes("") &&
    !segments.includes(".") &&
    !segments.includes("..");
}

function diagnosticError(diagnostic) {
  const error = new Error(diagnostic.message);
  Object.assign(error, diagnostic);
  return error;
}

function toDiagnostic(error, fallbackPath, fallbackCode) {
  const candidate = error && typeof error === "object" ? error : {};
  const code = typeof candidate.code === "string" ? candidate.code : fallbackCode;
  const path = typeof candidate.path === "string" ? candidate.path : fallbackPath;
  const field = typeof candidate.field === "string" ? candidate.field : undefined;
  const message = typeof candidate.message === "string"
    ? candidate.message
    : String(error);
  return {
    code,
    path,
    ...(field ? { field } : {}),
    message,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatLineRange(startLine, endLine) {
  if (!Number.isSafeInteger(startLine) || startLine <= 0 ||
      !Number.isSafeInteger(endLine) || endLine <= 0 || endLine < startLine) {
    return "";
  }
  return startLine === endLine
    ? `line ${startLine}`
    : `lines ${startLine}–${endLine}`;
}

function formatScore(score) {
  return typeof score === "number" && Number.isFinite(score)
    ? score.toFixed(3)
    : "—";
}

function setReferenceTime(documentRef) {
  const input = documentRef?.getElementById("as-of");
  if (!input || input.value) return;
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  input.value = local.toISOString().slice(0, 16);
}

startWhenReady();
