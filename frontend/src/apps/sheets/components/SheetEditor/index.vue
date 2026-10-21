<template>
  <div class="sn-root">
    <!-- Load-time error state: the sheet doesn't exist, the caller lacks
         access to it, or the request failed for some other reason. We
         distinguish denied vs missing because the recovery is different
         ("ask the owner to share" vs "broken link / deleted"). The user
         can always click the brand mark or the "Back to home" button to
         exit. -->
    <div v-if="loadError" class="sn-load-error">
      <div class="sn-load-error-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#A3A3A3" stroke-width="1.5" />
          <path d="M12 7v6" stroke="#A3A3A3" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="#A3A3A3" />
        </svg>
      </div>
      <h2 class="sn-load-error-title">
        <template v-if="loadError.kind === 'denied'">You don't have access to this sheet</template>
        <template v-else-if="loadError.kind === 'missing'">this sheet doesn't exist</template>
        <template v-else-if="loadError.kind === 'crashed'">{{
          __('This sheet stopped working')
        }}</template>
        <template v-else>Couldn't open this sheet</template>
      </h2>
      <p class="sn-load-error-sub">
        <template v-if="loadError.kind === 'denied'"
          >Ask the owner to share it with you, then reload.</template
        >
        <template v-else-if="loadError.kind === 'missing'"
          >It may have been deleted, or the link is wrong.</template
        >
        <template v-else-if="loadError.kind === 'crashed'">{{
          __('Reload to keep working. Edits from the last few seconds may not have been saved.')
        }}</template>
        <template v-else>{{ loadError.message }}</template>
      </p>
      <Button v-if="loadError.kind === 'crashed'" variant="solid" @click="reloadPage">{{
        __('Reload')
      }}</Button>
      <Button :variant="loadError.kind === 'crashed' ? 'subtle' : 'solid'" @click="emit('close')"
        >Back to home</Button
      >
    </div>

    <template v-else>
      <!-- Bar 1 · Identity. The status chips and the app actions are defined once
         and placed in either top bar. -->
      <DefineTopbarStatus>
        <template v-if="saveError">
          <span class="sn-save-error">
            <Badge class="max-w-full" theme="red" variant="subtle" size="sm" :tooltip="saveError">
              <span class="truncate">{{ saveError }}</span>
            </Badge>
          </span>
          <Button
            aria-label="Retry save"
            variant="ghost"
            size="sm"
            icon="lucide-refresh-cw"
            tooltip="Retry save"
            :loading="isSaving"
            @click="onRetrySave"
          />
        </template>
        <Badge
          v-if="protectionNotice"
          theme="gray"
          variant="subtle"
          size="sm"
          :label="protectionNotice"
          :tooltip="protectionNotice"
        />
      </DefineTopbarStatus>
      <DefineTopbarActions>
        <SheetTopbarActions
          :ai-enabled="aiEnabled"
          :read-only="readOnly"
          :file-dropdown-options="fileDropdownOptions"
          :compact-menu-options="compactMenuOptions"
          :notes-open="notesPanel.open"
          :notes-count="allNotes.length"
          :present-users="presentUsers"
          :current-sheet="currentSheet"
          @ask-ai="openAskBar"
          @toggle-notes="toggleNotesPanel"
          @shortcuts="showShortcutsHelp = true"
        />
        <input
          ref="csvInputRef"
          name="csv-import"
          type="file"
          accept=".csv"
          style="display: none"
          @change="importCSV"
        />
        <input
          ref="xlsxInputRef"
          name="xlsx-import"
          type="file"
          accept=".xlsx,.xls,.xlsm,.ods"
          style="display: none"
          @change="importXLSX"
        />
      </DefineTopbarActions>

      <!-- On /d/ the surface draws the Drive document header: title, Comments,
         Versions and Share. The editor fills its status and actions. -->
      <slot
        v-if="embedded"
        name="header"
        :view-only="readOnly"
        :status="ReuseTopbarStatus"
        :actions="ReuseTopbarActions"
      />
      <SheetTopbar
        v-else
        v-model:title="currentTitle"
        :brand-menu-options="brandMenuOptions"
        :is-title-editing="isTitleEditing"
        :sheet-breadcrumbs="sheetBreadcrumbs"
        :sheet-home-breadcrumbs="sheetHomeBreadcrumbs"
        :is-saving="isSaving"
        :just-saved="justSaved"
        :read-only="readOnly"
        :user-initial="userInitial"
        :user-image="userImage"
        :user-full-name="userFullName"
        :user-email="userEmail"
        @finish-title="finishTitleEditing"
        @cancel-title="cancelTitleEditing"
      >
        <template #status><ReuseTopbarStatus /></template>
        <template #actions><ReuseTopbarActions /></template>
      </SheetTopbar>

      <!-- Bar 2 · Formatting toolbar (SheetToolbar.vue) -->
      <SheetToolbar
        v-model:show-sort-filter="showSortFilter"
        :read-only="readOnly"
        :active-format="activeFormat"
        :number-format-dropdown-options="numberFormatDropdownOptions"
        :number-format-label="numberFormatLabel"
        :currency-dropdown-options="currencyDropdownOptions"
        :active-number-format-type="activeNumberFormatType"
        :active-currency-symbol="activeCurrencySymbol"
        :font-family-dropdown-options="fontFamilyDropdownOptions"
        :active-font-family-label="activeFontFamilyLabel"
        :align-dropdown-options="alignDropdownOptions"
        :h-align-icon="hAlignIcon"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :is-painting-format="isPaintingFormat"
        :text-wrap-dropdown-options="textWrapDropdownOptions"
        :text-wrap-icon="textWrapIcon"
        :border-dropdown-options="borderDropdownOptions"
        :more-toolbar-options="moreToolbarOptions"
        @number-format="toggleNumberFmt"
        @adjust-decimals="adjustDecimals"
        @font-size-input="onFontSizeInput"
        @toggle-format="toggleFmt"
        @set-color="setColor"
        @undo="undo"
        @redo="redo"
        @toggle-format-painter="toggleFormatPainter"
        @clear-formatting="clearFormatting"
        @cond-format="openCfDialog(null)"
        @hyperlink="openHyperlinkDialog"
        @merge="toggleMerge"
        @chart="openChartDialog()"
      />

      <!-- Bar 3 · Formula bar -->
      <div class="sn-formula-bar">
        <Tooltip :text="`Active cell ${activeCell}`">
          <span class="sn-cell-ref">{{ activeCell }}</span>
        </Tooltip>
        <span class="sn-fx-label" aria-hidden="true">fx</span>
        <div class="sn-formula-wrap">
          <input
            ref="formulaInputRef"
            name="formula-bar"
            aria-label="Cell value or formula"
            class="sn-formula-input"
            :value="formulaValue"
            :readonly="readOnly"
            :placeholder="readOnly ? '' : 'Enter value or formula'"
            spellcheck="false"
            autocomplete="off"
            @input="onFormulaInput"
            @keydown="onFormulaKey"
            @blur="closeAc"
          />
          <div v-if="acVisible" class="sn-ac-list" :class="{ 'sn-ac-list--up': acUp }">
            <div
              v-for="(item, i) in acItems"
              :key="item.name + item.kind"
              class="sn-ac-item"
              :class="{ active: i === acIdx }"
              @mousedown.prevent="commitAc(item)"
            >
              <span class="sn-ac-name">{{ item.name }}</span>
              <span v-if="item.kind === 'fn'" class="sn-ac-sig">{{ AC_FUNS[item.name] }}</span>
              <span v-else class="sn-ac-badge">sheet</span>
            </div>
          </div>
        </div>
      </div>

      <SheetUpgradeBanner
        v-if="legacyUpgrade && !upgradeBannerClosed"
        :upgrade="legacyUpgrade"
        :read-only="readOnly"
        @close="upgradeBannerClosed = true"
      />

      <!-- Canvas grid + filter overlay -->
      <!-- wheel.capture: the link hover card is anchored to a cell's pixel rect,
         which any scroll invalidates — hide it rather than let it float. -->
      <div
        ref="gridWrapRef"
        class="sn-grid-wrap"
        :class="{ 'sn-painting-format': isPaintingFormat }"
        @wheel.capture.passive="linkCard.open = false"
      >
        <canvas ref="canvasRef" />

        <!-- Initial-load shim. The canvas is mounted (so grid.resize / event
           wiring works) but blank until loadSheet/autoCreate finishes —
           without this overlay the first paint looks like a deleted sheet
           for the first 100–500 ms on slow networks. -->
        <div v-if="isInitialLoad" class="sn-canvas-loading" aria-busy="true">
          <Spinner class="sn-canvas-loading-spinner" />
        </div>

        <!-- Non-blocking spinner while a large pivot aggregates in the background. -->
        <div v-if="pivotBuilding" class="sn-pivot-building" aria-busy="true">
          <Spinner class="sn-canvas-loading-spinner" />
          <span>Building pivot…</span>
        </div>

        <!-- Floating charts (filtered to current sub-sheet by the overlay). -->
        <ChartOverlay
          :charts="chartList"
          :current-sheet="currentSheet"
          :get-matrix="getChartMatrix"
          :data-version="chartMatrixVersion"
          :selected-id="selectedChartId"
          :suppressed="chartDialogOpen"
          @select="selectChart"
          @edit="openChartEdit"
          @delete="onChartDelete"
          @refresh="onChartRefresh"
          @move="onChartMove"
          @resize="onChartResize"
        />

        <!-- The surface's Drive panels (comments, versions) dock the same edge. -->
        <slot name="side-panel" />

        <!-- Notes side panel (NotesPanel.vue) -->
        <NotesPanel
          v-if="notesPanel.open"
          :groups="notesGrouped"
          :count="allNotes.length"
          :active-cell="activeCell"
          :current-sheet="currentSheet"
          @close="notesPanel.open = false"
          @add="addNoteFromPanel"
          @jump="jumpToNote"
        />

        <CellHistoryPopover
          v-model="cellHistory.open"
          :cell-ref="cellHistory.cell"
          :entries="cellHistory.entries"
          :loading="cellHistory.loading"
          :error="cellHistory.error"
        />

        <SplitTextPopover
          :open="splitText.open"
          :anchor="splitText.anchor"
          :selected="splitText.choice"
          @choose="onSplitChoose"
          @apply="onSplitApply"
          @cancel="onSplitCancel"
        />

        <LinkPreviewCard
          :open="linkCard.open"
          :anchor="linkCard.anchor"
          :url="linkCard.url"
          :preview="linkCard.preview"
          :can-edit="!readOnly"
          :offer-replace="linkCard.offerReplace"
          @enter="onLinkCardEnter"
          @leave="onLinkCardLeave"
          @open="openLinkCardUrl"
          @edit="editLinkCardCell"
          @unlink="unlinkLinkCardCell"
          @replace="replaceLinkWithTitle"
        />

        <!-- Outline around the active filter's range so its extent is visible.
           pointer-events:none keeps clicks reaching the canvas underneath. -->
        <div
          v-if="filterHighlightStyle"
          class="sn-filter-range"
          :style="filterHighlightStyle"
          aria-hidden="true"
        />

        <!-- Filter chevrons on row 0 (the user's header row of data) -->
        <div v-if="showSortFilter" class="sn-filter-overlay">
          <button
            v-for="col in visibleFilterCols"
            :key="col.col"
            class="sn-filter-btn"
            :class="{ active: filterConfig[col.col] }"
            :style="col.style"
            :aria-label="`Filter column ${colLabel(col.col)}`"
            @click="openFilterPanel(col.col)"
          >
            <FeatherIcon name="chevron-down" class="sn-filter-btn-icon" />
          </button>
        </div>

        <!-- Remote cursor overlays — one per peer on the same sub-sheet.
           `data-moved` flips when the peer's (row,col) actually changes so
           the CSS only animates left/top/width/height on real motion, not
           on the local viewport scroll. -->
        <div
          v-for="cur in visibleRemoteCursors"
          :key="cur.user"
          class="sn-remote-cursor"
          :class="{ 'sn-remote-cursor--moved': cur.justMoved }"
          :style="cur.style"
          :title="cur.fullName"
        >
          <span class="sn-remote-cursor-label">{{ cur.firstName }}</span>
        </div>

        <!-- Pivot highlight overlay — thin coloured border drawn over the
           pivot output range so users can tell it's a generated table.
           pointer-events:none so the canvas keeps receiving clicks. -->
        <div
          v-if="activePivotConfig && pivotHighlightStyle"
          class="sn-pivot-highlight"
          :style="pivotHighlightStyle"
          aria-hidden="true"
        />

        <!-- Pivot FAB — floats below the Grand Total row, like Google Sheets -->
        <Dropdown v-if="activePivotConfig && pivotFabStyle" :options="pivotBannerMenuOptions">
          <template #default="{ open }">
            <button
              class="sn-pivot-fab"
              :class="{ open }"
              :style="pivotFabStyle"
              title="Pivot table options"
            >
              <FeatherIcon name="pencil" class="sn-pivot-fab-icon" />
            </button>
          </template>
        </Dropdown>

        <!-- Inline filter panel (FilterPanel.vue) -->
        <FilterPanel
          v-if="filterPanel.open"
          :key="filterPanel.seq"
          :style="filterPanelStyle"
          :col="filterPanel.col"
          :all-values="filterPanel.allValues"
          :spec="filterPanel.spec"
          @sort="(dir) => doSort(filterPanel.col, dir)"
          @apply="applyFilter"
          @clear="clearFilterCol"
          @close="filterPanel.open = false"
        />
      </div>

      <!-- Add-more-rows strip — only when the user has scrolled near the bottom -->
      <div v-if="showAddRows" class="sn-addrows">
        <span class="sn-addrows-label">Add</span>
        <input
          v-model.number="addRowsCount"
          name="add-rows-count"
          aria-label="Number of rows to add"
          class="sn-addrows-input"
          type="number"
          min="1"
          max="10000"
        />
        <span class="sn-addrows-label">more rows at the bottom</span>
        <Button
          variant="subtle"
          size="sm"
          icon-left="lucide-plus"
          label="Add"
          @click="doAddMoreRows"
        />
      </div>

      <!-- Bottom · sheet tabs + selection stats (SheetTabsBar.vue) -->
      <SheetTabsBar
        :read-only="readOnly"
        :sheet-names="sheetNames"
        :current-sheet="currentSheet"
        :is-pivot-sheet="isPivotSheet"
        :tab-drag-over="tabDragOver"
        :tab-drag-name="tabDragName"
        :peers-by-sub-sheet="peersBySubSheet"
        :selection-stats="selectionStats"
        @add-sheet="addSheet"
        @drag-start="onTabDragStart"
        @drag-end="onTabDragEnd"
        @drag-over="onTabDragOver"
        @tab-drop="onTabDrop"
        @tab-mousedown="onTabMousedown"
        @tab-click="onTabClick"
        @rename="openRenameDialog"
        @tab-menu="_onTabMenu"
      />

      <!-- Sheet-tab context menu (SheetTabMenu.vue) -->
      <SheetTabMenu
        v-if="tabMenu.open"
        :menu="tabMenu"
        :locked="tabMenuSheetLocked()"
        :can-delete="sheetNames.length > 1"
        @rename="openRenameDialog(tabMenu.name)"
        @duplicate="doDuplicateSheet(tabMenu.name)"
        @toggle-protect="toggleSheetProtection(tabMenu.name)"
        @delete="doDeleteSheet(tabMenu.name)"
      />

      <!-- Rename sheet dialog -->
      <Dialog v-model:open="showRenameDialog" title="Rename sheet" size="sm">
        <template #default>
          <FormControl
            ref="renameInputRef"
            v-model="renameValue"
            label="New name"
            placeholder="Sheet name"
            @keydown.enter="confirmRename"
          />
          <p v-if="renameError" class="sn-rename-err">{{ renameError }}</p>
        </template>
        <template #actions>
          <div class="flex flex-row-reverse gap-2">
            <Button variant="solid" @click="confirmRename">Rename</Button>
            <Button @click="showRenameDialog = false">Cancel</Button>
          </div>
        </template>
      </Dialog>

      <!-- Right-click context menu (SheetContextMenu.vue) -->
      <SheetContextMenu
        v-if="contextMenu.open"
        :menu="contextMenu"
        :freeze-rows="freezeRows"
        :freeze-cols="freezeCols"
        :has-hidden-rows="manualHiddenRows.size > 0"
        :has-hidden-cols="manualHiddenCols.size > 0"
        :can-paste="clipboardHas"
        :range-protected="selectionHasProtectedRange()"
        :show-cell-history="props.id !== 'new'"
        :active-cell="activeCell"
        @insert-row="doInsertRow"
        @insert-col="doInsertCol"
        @insert-many="(kind) => openInsertMany(kind, false)"
        @delete-row="doDeleteRow()"
        @delete-col="doDeleteCol()"
        @move-col-left="doMoveColLeft()"
        @move-col-right="doMoveColRight()"
        @auto-fit-row="doAutoFitRow()"
        @auto-fit-col="doAutoFitCol()"
        @hide-rows="doHideRows()"
        @hide-cols="doHideCols()"
        @unhide-all-rows="doUnhideAllRows()"
        @unhide-all-cols="doUnhideAllCols()"
        @freeze-row="doFreezeRow()"
        @freeze-col="doFreezeCol()"
        @unfreeze-rows="doUnfreezeRows()"
        @unfreeze-cols="doUnfreezeCols()"
        @paste-special="doPasteSpecial"
        @validation="fromContextMenu(openValidationDialog)"
        @cond-format="fromContextMenu(() => openCfDialog(null))"
        @protect="protectSelection()"
        @unprotect="unprotectSelection()"
        @split-text="doSplitTextToColumns()"
        @pivot="openPivotDialog()"
        @chart="openChartDialog()"
        @slicer="insertSlicer()"
        @cell-history="openCellHistory()"
      />

      <!-- Pivot dialog -->
      <PivotDialog
        v-model="pivotDialogOpen"
        :read-range="_readSourceRange"
        :sheet-names="sheetNames"
        :current-sheet="currentSheet"
        :initial-range="pivotInitialRange"
        :pivot-id="pivotEditId"
        :existing-config="pivotEditConfig"
        @confirm="onPivotConfirm"
      />

      <!-- Chart dialog -->
      <ChartDialog
        v-model="chartDialogOpen"
        :read-range="_readDisplays"
        :used-extent="_usedExtent"
        :current-sheet="currentSheet"
        :initial-range="chartInitialRange"
        :chart-id="chartEditId"
        :existing-config="chartEditConfig"
        @confirm="onChartConfirm"
      />

      <!-- Named ranges dialog -->
      <NamedRangesDialog
        v-model="namedRangesDialogOpen"
        :named-ranges="namedRanges"
        :sheet-names="sheetNames"
        :current-sheet="currentSheet"
        @changed="_onNamedRangesChanged"
      />

      <!-- AI Assist settings (in-app, never the desk form) -->
      <AISettingsDialog v-model="aiSettingsOpen" @saved="onAiSettingsSaved" />

      <!-- AI Assist "Ask" command bar -->
      <AskBar
        v-if="askOpen"
        :busy="askBusy"
        :selection-label="askSelectionLabel"
        :error="askError"
        :answer="askAnswer"
        :pending="aiPending"
        @submit="onAskSubmit"
        @keep="onAskKeep"
        @undo="onAskUndo"
        @close="closeAskBar"
      />

      <!-- Find & Replace panel -->
      <FindReplace
        v-if="showFindReplace"
        ref="findReplaceRef"
        :find="_findCells"
        :write="_replaceCells"
        :is-protected="(id) => _cellSilentlyProtected(id)"
        @close="closeFindReplace"
        @navigate-to="onNavigateTo"
      />

      <!-- Hyperlink dialog (Ctrl+L) — HyperlinkDialog.vue -->
      <HyperlinkDialog
        ref="hyperlinkDialogRef"
        :has-link="hasActiveHyperlink"
        @apply="confirmHyperlink"
        @remove="removeHyperlink"
      />

      <!-- Data validation dialog -->
      <ValidationDialog
        ref="validationDialogRef"
        @apply="_applyValidation"
        @remove="removeValidation"
      />

      <!-- Insert N rows / columns dialog -->
      <Dialog
        v-model:open="showInsertManyDialog"
        :title="insertMany.kind === 'row' ? 'Insert rows' : 'Insert columns'"
        size="sm"
      >
        <template #default>
          <FormControl
            v-model.number="insertMany.count"
            type="number"
            :min="1"
            :max="1000"
            :label="insertMany.kind === 'row' ? 'Number of rows' : 'Number of columns'"
            @keydown.enter="confirmInsertMany"
          />
        </template>
        <template #actions>
          <div class="flex flex-row-reverse gap-2">
            <Button variant="solid" @click="confirmInsertMany">Insert</Button>
            <Button @click="showInsertManyDialog = false">Cancel</Button>
          </div>
        </template>
      </Dialog>

      <!-- Custom number-format dialog -->
      <Dialog v-model:open="customFormatDialog.open" title="Custom number format" size="sm">
        <template #default>
          <div class="sn-form-stack">
            <FormControl
              v-model="customFormatDialog.pattern"
              label="Format code"
              placeholder="#,##0.00"
              @keydown.enter="confirmCustomFormat"
            />
            <div class="text-sm text-ink-gray-6">
              Preview:
              <span class="font-medium text-ink-gray-9">{{ customFormatPreview || '—' }}</span>
            </div>
            <div class="text-xs text-ink-gray-5 leading-relaxed">
              <code>0</code> padded digit · <code>#</code> optional digit · <code>,</code> thousands
              · <code>.</code> decimal · <code>%</code> percent · <code>"text"</code> literal. e.g.
              <code>#,##0.00</code>, <code>0.0%</code>, <code>"$"#,##0</code>
            </div>
          </div>
        </template>
        <template #actions>
          <div class="flex flex-row-reverse gap-2">
            <Button variant="solid" @click="confirmCustomFormat">Apply</Button>
            <Button @click="customFormatDialog.open = false">Cancel</Button>
          </div>
        </template>
      </Dialog>

      <!-- Keyboard shortcut help — frappe-ui's KeyboardShortcutsModal, generated
         from the shortcut registry populated by useShortcuts.js (via useShortcut),
         so it can never drift from the handlers. -->
      <KeyboardShortcutsDialog v-model:open="showShortcutsHelp" title="Keyboard shortcuts" />

      <!-- Slicers — floating value-filter controls (SlicerPanel.vue) -->
      <SlicerPanel
        v-for="sl in activeSlicers"
        :key="sl.id"
        :slicer="sl"
        @drag-start="(e) => startSlicerDrag(sl, e)"
        @change-col="(col) => changeSlicerColumn(sl, col)"
        @remove="removeSlicer(sl)"
        @select-all="selectAllSlicer(sl)"
        @clear="clearSlicerValues(sl)"
        @toggle="(v) => toggleSlicerValue(sl, v)"
      />

      <!-- Threaded comment panel (floating near cell) -->
      <div
        v-if="commentPanel.open"
        class="sn-comment-panel"
        :style="{ left: commentPanel.x + 'px', top: commentPanel.y + 'px' }"
      >
        <div class="sn-comment-header">
          <span class="sn-comment-title">
            Note
            <span v-if="commentPanel.resolved" class="sn-comment-resolved">Resolved</span>
          </span>
          <div class="sn-comment-hactions">
            <Button
              v-if="commentPanel.thread.length"
              variant="ghost"
              size="sm"
              :icon="commentPanel.resolved ? 'lucide-rotate-ccw' : 'lucide-check'"
              :tooltip="commentPanel.resolved ? 'Reopen' : 'Mark resolved'"
              :aria-label="commentPanel.resolved ? 'Reopen' : 'Mark resolved'"
              @click="toggleResolveComment"
            />
            <Button
              variant="ghost"
              size="sm"
              icon="lucide-x"
              aria-label="Close note"
              @click="commentPanel.open = false"
            />
          </div>
        </div>

        <div v-if="commentPanel.thread.length" class="sn-comment-thread">
          <div
            v-for="(r, i) in commentPanel.thread"
            :key="`${r.ts}-${r.author}`"
            class="sn-comment-reply"
          >
            <div class="sn-comment-reply-head">
              <span class="sn-comment-author">{{ r.name || r.author || 'Someone' }}</span>
              <span class="sn-comment-time">{{ commentTime(r.ts) }}</span>
              <Button
                v-if="r.author && r.author === userEmail"
                aria-label="Delete reply"
                variant="ghost"
                size="sm"
                icon="lucide-trash-2"
                tooltip="Delete"
                class="sn-comment-del"
                @click="deleteCommentReply(i)"
              />
            </div>
            <div class="sn-comment-text">{{ r.text }}</div>
          </div>
        </div>

        <textarea
          v-model="commentPanel.draft"
          class="sn-comment-ta"
          rows="2"
          :placeholder="commentPanel.thread.length ? 'Reply…' : 'Add a note…'"
          @keydown.enter.exact.prevent="addCommentReply"
        />
        <div class="sn-comment-actions">
          <Button
            size="sm"
            variant="solid"
            :disabled="!commentPanel.draft.trim()"
            @click="addCommentReply"
          >
            {{ commentPanel.thread.length ? 'Reply' : 'Add note' }}
          </Button>
          <Button
            v-if="commentPanel.thread.length"
            size="sm"
            variant="ghost"
            theme="red"
            @click="deleteComment"
            >Delete all</Button
          >
        </div>
      </div>

      <!-- Validation dropdown panel -->
      <div
        v-if="dropdownPanel.open"
        class="sn-dropdown-panel"
        :style="{
          left: dropdownPanel.x + 'px',
          top: dropdownPanel.y + 'px',
          minWidth: dropdownPanel.w + 'px',
        }"
      >
        <div
          v-for="opt in dropdownPanel.options"
          :key="opt"
          class="sn-dropdown-opt"
          :class="{ 'is-active': opt === dropdownPanel.value }"
          @mousedown.prevent="pickDropdownOption(opt)"
        >
          <FeatherIcon
            name="check"
            class="sn-dropdown-check"
            :style="{ visibility: opt === dropdownPanel.value ? 'visible' : 'hidden' }"
          />
          <span
            class="sn-dropdown-chip"
            :style="{ background: chipColor(opt, dropdownPanel.rule) }"
            >{{ opt }}</span
          >
        </div>
        <div
          v-if="dropdownPanel.value"
          class="sn-dropdown-opt sn-dropdown-clear"
          @mousedown.prevent="pickDropdownOption('')"
        >
          <FeatherIcon name="x" class="sn-dropdown-check" />
          <span class="sn-dropdown-label">Clear</span>
        </div>
      </div>

      <!-- Conditional formatting dialog -->
      <ConditionalFormatDialog
        ref="cfDialogRef"
        :cond-format="condFormat"
        :current-sheet="currentSheet"
        :render-version="renderVersion"
        @before-change="history.push()"
        @changed="_onCfChanged"
      />
    </template>
  </div>
</template>

<script setup>
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import {
  Badge,
  Button,
  Dialog,
  Dropdown,
  FormControl,
  KeyboardShortcutsDialog,
  Spinner,
  Tooltip,
  usePageMeta,
} from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import {
  computed,
  customRef,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

import { useCurrentUser, useSessionStore } from '@/boot/session'
import { useSettingsMenuOption } from '@/composables/useSettingsMenuOption'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import { appPageMeta } from '@/platform/page-meta'
import { confirmLeave } from '@/utils/confirmLeave'

import { chipColor } from '../../canvas/chip-geometry'
import { createGrid } from '../../canvas/index'
import { createChartEngine } from '../../engine/charts.js'
import { createClipboard } from '../../engine/clipboard.js'
import { createCommentsEngine } from '../../engine/comments.js'
import { createCondFormatEngine } from '../../engine/cond-format.js'
import { formatScope } from '../../engine/format-scope.js'
import { createFormatsEngine } from '../../engine/formats.js'
import { detectHyperlink, isAutoLinkText } from '../../engine/links.js'
import { createMergeEngine } from '../../engine/merge.js'
import { createNamedRanges } from '../../engine/named-ranges.js'
import { createPivotEngine } from '../../engine/pivot.js'
import { createProtectionEngine } from '../../engine/protection.js'
import { deleteMap, insertMap, moveMap } from '../../engine/ref-remap.js'
import { createSlicerEngine } from '../../engine/slicers.js'
import { createSortFilter } from '../../engine/sortFilter.js'
import { parseSparkline, sparkSpec } from '../../engine/sparkline.js'
import { createValidationEngine } from '../../engine/validation.js'
import { numFmtFromEngine } from '../../engine/xlsx-io.js'
import { cellHistory as fetchCellHistory } from '../../services/versions.js'
import { cellId, colLabel, parseCellId } from '../../utils/cells.js'
import { applyNumberFmt, buildNumberFmt, parseNumberFmt } from '../../utils/format-number.js'
import { AC_FUN_KEYS } from '../../utils/formula-ac.js'
import { autoCloseKey } from '../../utils/formula-autoclose.js'
import { userInitials } from '../../utils/session.js'
import { getTextWrap } from '../../utils/text-wrap.js'
import AISettingsDialog from './AISettingsDialog.vue'
import AskBar from './AskBar.vue'
import CellHistoryPopover from './CellHistoryPopover.vue'
import ChartDialog from './ChartDialog.vue'
import ChartOverlay from './ChartOverlay.vue'
import ConditionalFormatDialog from './ConditionalFormatDialog.vue'
import FilterPanel from './FilterPanel.vue'
import FindReplace from './FindReplace.vue'
import HyperlinkDialog from './HyperlinkDialog.vue'
import LinkPreviewCard from './LinkPreviewCard.vue'
import NamedRangesDialog from './NamedRangesDialog.vue'
import NotesPanel from './NotesPanel.vue'
import PivotDialog from './PivotDialog.vue'
import SheetContextMenu from './SheetContextMenu.vue'
import SheetTabMenu from './SheetTabMenu.vue'
import SheetTabsBar from './SheetTabsBar.vue'
import SheetToolbar from './SheetToolbar.vue'
import SheetTopbar from './SheetTopbar.vue'
import SheetTopbarActions from './SheetTopbarActions.vue'
import SheetUpgradeBanner from './SheetUpgradeBanner.vue'
import SlicerPanel from './SlicerPanel.vue'
import SplitTextPopover from './SplitTextPopover.vue'
import { buildAlignOptions, buildBorderOptions, buildMoreToolbarOptions } from './toolbar.config.js'
import { useAiAssist } from './useAiAssist.js'
import { useChartIntegration } from './useChartIntegration.js'
import { useClipboard } from './useClipboard.js'
import { useCollaboration } from './useCollaboration.js'
import { useContextMenu } from './useContextMenu.js'
import { useEditOps } from './useEditOps.js'
import { useExportImport } from './useExportImport.js'
import { useFill } from './useFill.js'
import { AC_FUNS, useFormulaAutocomplete } from './useFormulaAutocomplete.js'
import { useHistory } from './useHistory.js'
import { useLinkCard } from './useLinkCard.js'
import { useNotesPanel } from './useNotesPanel.js'
import { usePersistence } from './usePersistence.js'
import { usePivotIntegration } from './usePivotIntegration.js'
import { useProtection } from './useProtection.js'
import { useSheetTabs } from './useSheetTabs.js'
import { useShortcuts } from './useShortcuts.js'
import { useSlicers } from './useSlicers.js'
import { useSmartFill } from './useSmartFill.js'
import { useSortFilter } from './useSortFilter.js'
import { useSplitText } from './useSplitText.js'
import { useToolbar } from './useToolbar.js'
import { useWorkbook } from './useWorkbook.js'
import ValidationDialog from './ValidationDialog.vue'

const props = defineProps({
  id: {
    type: String,
    default: 'new',
  },
  // Mounted by the /d/ surface. The surface fills the `header` and
  // `side-panel` slots, owns the title, sharing and the leave guard, and its
  // Drive session records the visit. The `header` slot receives `viewOnly`,
  // and the editor's `status` and `actions` as components to place; the save
  // state is on the exposed handle.
  embedded: {
    type: Boolean,
    default: false,
  },
  // The surface's access verdict. False freezes the editor and cancels every
  // pending save, retries included.
  writable: {
    type: Boolean,
    default: true,
  },
  // The Drive title while embedded. Saves carry it, so it must follow a rename.
  title: {
    type: String,
    default: null,
  },
  // The Drive session's fetch while embedded. Load, save and the collaboration
  // relay go through it, so a caller who holds a share link reaches the sheet.
  credentialFetch: {
    type: Function,
    default: undefined,
  },
  requestContext: {
    type: Object,
    default: undefined,
  },
})
// `access-refused`: the server refused a save, or the collaboration relay
// refused a write. `notes-opened`: the notes panel took the right edge.
const emit = defineEmits(['close', 'saved', 'access-refused', 'notes-opened'])
// The top bar's status chips and app actions, drawn in the editor's own bar or
// handed to the surface's header when embedded.
const [DefineTopbarStatus, ReuseTopbarStatus] = createReusableTemplate()
const [DefineTopbarActions, ReuseTopbarActions] = createReusableTemplate()
const sessionStore = useSessionStore()
const themeMenuOption = useThemeMenuOption()
const settingsMenuOption = useSettingsMenuOption()
const isTitleEditing = ref(false)
const sheetHomeBreadcrumbs = computed(() => [
  // A path, not the route name: in the unified shell the Sheets routes register
  // only once /sheets is first visited, so the name does not resolve yet.
  {
    label: 'Sheets',
    route: '/sheets',
  },
])
const sheetBreadcrumbs = computed(() => [
  ...sheetHomeBreadcrumbs.value,
  {
    label: currentTitle.value || 'Untitled Sheet',
    onClick: startTitleEditing,
  },
])
const brandMenuOptions = computed(() => [
  {
    group: '',
    options: [
      settingsMenuOption,
      themeMenuOption,
      ...(sessionStore.isLoggedIn
        ? [
            {
              label: 'Log out',
              icon: 'lucide-log-out',
              onClick: () => sessionStore.logout.submit(),
            },
          ]
        : []),
    ],
  },
])

// ── Engine instances ──────────────────────────────────────────────────────────

// The open tab. The editor owns it; IronCalc's sheet list sets it on load.
const currentSheet = ref('Sheet1')
// IronCalc holds every cell (see useWorkbook.js). Declared up here because
// setup code (the sheet tabs) reads it.
const {
  startEngine: _startEngine,
  stopEngine: _stopEngine,
  engineClient: _client,
  engineBytes: _engineBytes,
  command: _command,
  writeInputs: _writeInputs,
  syncDefinedNames: _syncDefinedNames,
  inputAt: _inputAt,
  paintedInput: _paintedInput,
  readRect: _readRect,
  readInputs: _readInputs,
  readIds: _readIds,
  readInput: _readInput,
  displayValue: _displayValue,
  isNumberAt: _isNumberAt,
  refreshUsedCells: _refreshUsedCells,
  usedCellIds: _usedCellIds,
  usedExtent: _usedExtent,
  readWholeSheet: _readWholeSheet,
  readDisplays: _readDisplays,
  readSourceRange: _readSourceRange,
  clearRect: _clearRect,
  clearSheet: _clearSheet,
} = useWorkbook({
  currentSheet,
  // Created below; read only once the engine runs.
  namedRanges: () => namedRanges,
  getGrid: () => grid,
  syncNames: () => syncNames(),
  onVersion: () => _onEngineVersion(),
  onUsedExtent: (max) => {
    if (grid) _expandGridTo(max.maxCol, max.maxRow)
  },
  onCrash: (reason) => _onEngineCrash(reason),
})
const formats = createFormatsEngine()
const merge = createMergeEngine()
const sortFilter = createSortFilter({
  read: (sn, rect) => _readRect(sn, rect),
  write: (sn, map) => _writeInputs(sn, map),
})
const slicers = createSlicerEngine()
const comments = createCommentsEngine()
const validation = createValidationEngine()
const protection = createProtectionEngine()
const condFormat = createCondFormatEngine()
const clipboard = createClipboard({
  cells: {
    read: (sn, rect, opts) => _readRect(sn, rect, opts),
    write: (sn, map) => _writeInputs(sn, map),
  },
  getCurrentSheet: () => currentSheet.value,
  formats,
  condFormat,
  validation,
  protection,
  // Late-bound to the pivot integration (declared below). Only invoked at
  // copy/paste time, long after setup runs, so the forward reference is safe.
  getPivotAt: (sel, sn) => getPivotAt(sel, sn),
  createPivotFromPaste: (blob, anchorId, sn) => createPastedPivot(blob, anchorId, sn),
})
const pivot = createPivotEngine()
const charts = createChartEngine()
// Named ranges: the validator hook prevents users from defining names that
// collide with the formula engine's built-in functions (SUM, VLOOKUP, etc.).
// The functions autocomplete offers (each one IronCalc evaluates; see
// core/function-catalog.test.js).
const _builtinFns = new Set(AC_FUN_KEYS)
const namedRanges = createNamedRanges({
  isBuiltinFunction: (n) => _builtinFns.has(n),
})

// Dialog state — toolbar / context-menu entries flip this open. Changes
// inside the dialog (add/edit/delete) mark the workbook dirty and push a
// history snapshot so undo/redo behaves predictably.
const namedRangesDialogOpen = ref(false)
function openNamedRangesDialog() {
  contextMenu.open = false
  namedRangesDialogOpen.value = true
}
function _onNamedRangesChanged() {
  _syncDefinedNames()
  // The engine notifies via onChange too, but we explicitly push history
  // here so each batched add/edit/delete becomes its own undoable event.
  history.push()
  isDirty.value = true
  // Names that map to range references can affect cell display via the
  // formula engine — repaint so any =Name cells refresh.
  _repopulateGrid()
}

// Smart Fill — Cmd/Ctrl+E. Looks at the user's example values in the
// selected column, detects a heuristic transform (case / concat / word /
// substring / email-part), and fills the rest.
const { runSmartFill: _runSmartFill } = useSmartFill({
  readInputs: (rect, sn) => _readInputs(rect, sn),
  writeInputs: (sn, map) => _writeInputs(sn, map),
  currentSheet,
  getGrid: () => grid,
  queueOp: (...a) => _queueOp(...a),
  getHistory: () => history,
  getIsDirty: () => isDirty,
})
async function runSmartFill() {
  const result = await _runSmartFill()
  if (!result.ok) {
    // Hint the user when there's nothing to fill — quiet failure feels broken.
    const hints = {
      'single-column-only': 'Smart Fill works on a single column at a time.',
      'no-examples': 'Fill in 1–2 example cells first, then select the range and press Cmd+E.',
      'no-empty-cells': 'No empty cells in the selection to fill.',
      'no-source-columns': 'Smart Fill needs adjacent columns with source data.',
      'no-pattern': "Couldn't detect a pattern from your examples.",
      'no-fills': "Detected a pattern but couldn't apply it to any rows.",
    }
    saveError.value = hints[result.reason] || 'Smart Fill could not run.'
    setTimeout(() => {
      saveError.value = ''
    }, 3500)
  }
}

// Undo/redo (see useHistory.js).
const {
  history,
  undo,
  redo,
  structural: _structural,
} = useHistory({
  currentSheet,
  engines: {
    formats,
    merge,
    sortFilter,
    slicers,
    comments,
    validation,
    protection,
    condFormat,
    pivot,
    charts,
    namedRanges,
  },
  getGrid: () => grid,
  engineClient: _client,
  command: _command,
  writeInputs: _writeInputs,
  syncDefinedNames: _syncDefinedNames,
  addSheet: (name) => _addSheet(name),
  deleteSheet: (name) => _deleteSheet(name),
  getLocalTouches: () => _drainCollabLocalTouches(),
  syncFlags: () => syncFlags(),
  markDirty: () => {
    isDirty.value = true
  },
  afterStructural: (sn) => _afterStructural(sn),
  afterNavigate: () => _afterHistoryNavigate(),
})

// Forward-declaration: `useCollaboration` (further down the script) sets
// `_collabDrainLocalTouches` to its real implementation once the binding
// is up. Before that, the history degrades cleanly to full-restore by
// returning an empty set.
let _collabDrainLocalTouches = () => new Set()
function _drainCollabLocalTouches() {
  return _collabDrainLocalTouches()
}

// ── Vue state ─────────────────────────────────────────────────────────────────

const canvasRef = ref(null)
const gridWrapRef = ref(null)
const formulaInputRef = ref(null)
const csvInputRef = ref(null)
const xlsxInputRef = ref(null)
const activeCell = ref('A1')
const formulaValue = ref('')
const canUndo = ref(false)
const canRedo = ref(false)
const currentTitle = ref('Untitled Sheet')
// Embedded, the document host names the tab like every other document.
if (!props.embedded) usePageMeta(() => appPageMeta(currentTitle.value, 'Sheets'))
const activeNumberFormat = ref('')

// Cross-sheet picker: when the user starts a `=…` edit in the top formula
// bar then clicks another sheet's tab, we keep the in-progress formula alive
// across the switch. These refs remember where to write the formula back on
// commit; null when no cross-sheet edit is in flight.
const editingHomeSheet = ref(null)
const editingHomeCell = ref(null)
// The cell the formula bar or the cell editor last took typed text for. Reset
// when that edit is committed or cancelled, or the selection moves.
let _typedCell = null
// Dropdown reflects the *type* only ('number' / 'currency' / ...), so a stored
// `number:3` still shows "Number" as selected.
const activeNumberFormatType = computed(() => parseNumberFmt(activeNumberFormat.value).type)
const showFindReplace = ref(false)
const findReplaceRef = ref(null)
function openFindReplace() {
  document.activeElement?.blur?.()
  showFindReplace.value = true
  const triggerFocus = () => findReplaceRef.value?.focusInput?.()
  nextTick(triggerFocus)
  setTimeout(triggerFocus, 0)
  setTimeout(triggerFocus, 50)
}
const showShortcutsHelp = ref(false)
const showInsertManyDialog = ref(false)
const insertMany = reactive({
  kind: 'row',
  count: 5,
  below: false,
})
const hasActiveHyperlink = computed(() => !!activeFormat.value?.hyperlink)
const showFormulas = ref(false)
const selectionStats = ref(null)
let _dirtyRevision = 0
const isDirty = customRef((track, trigger) => {
  let value = false
  return {
    get() {
      track()
      return value
    },
    set(next) {
      if (next) _dirtyRevision += 1
      if (next === value) return
      value = next
      trigger()
    },
  }
})
const isPaintingFormat = ref(false)

// ── Comment UI state ──────────────────────────────────────────────────────────
const commentPanel = reactive({
  open: false,
  id: '',
  x: 0,
  y: 0,
  thread: [],
  resolved: false,
  draft: '',
})

// ── Dropdown (validation) UI state ────────────────────────────────────────────
const dropdownPanel = reactive({
  open: false,
  id: '',
  options: [],
  rule: null,
  value: '',
  x: 0,
  y: 0,
  w: 120,
})
const cellHistory = reactive({
  open: false,
  cell: '',
  loading: false,
  error: '',
  entries: [],
})
const borderColor = ref('#000000')
const borderStyle = ref('thin')
const freezeRows = ref(0)
const freezeCols = ref(0)
const justSaved = ref(false)

// Short keys keep the select narrow; the full CSS stack lives in FONT_FAMILY_STACK
// so the persisted format value is still a complete font-family string.
const FONT_FAMILY_OPTIONS = [
  {
    label: 'Inter',
    value: 'inter',
  },
  {
    label: 'Serif',
    value: 'serif',
  },
  {
    label: 'Mono',
    value: 'mono',
  },
  {
    label: 'System',
    value: 'system',
  },
]
const FONT_FAMILY_STACK = {
  inter: 'InterVar, Inter, ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
}
// `activeFontFamilyKey` is defined further down — after the useToolbar() call
// that creates `activeFormat`. See "Composables" block.

// Flat list driving the dropdown — groups give the menu its sectioned layout.
// Each entry is a stored format string; clicking applies it as-is.
const NUMBER_FORMAT_GROUPS = [
  {
    group: 'General',
    options: [
      {
        label: 'General',
        value: '',
      },
      {
        label: 'Plain text',
        value: 'text',
      },
    ],
  },
  {
    group: 'Number',
    options: [
      {
        label: 'Decimal',
        value: 'number',
      },
      {
        label: 'Decimal — Indian (1,23,456)',
        value: 'number:in',
      },
      {
        label: 'Percent',
        value: 'percentage',
      },
    ],
  },
  {
    group: 'Currency',
    options: [
      {
        label: 'USD ($)',
        value: 'currency:USD:2',
      },
      {
        label: 'EUR (€)',
        value: 'currency:EUR:2',
      },
      {
        label: 'GBP (£)',
        value: 'currency:GBP:2',
      },
      {
        label: 'INR (₹)',
        value: 'currency:INR:2',
      },
      {
        label: 'JPY (¥)',
        value: 'currency:JPY:0',
      },
    ],
  },
  {
    group: 'Date',
    options: [
      {
        label: 'Auto (locale)',
        value: 'date',
      },
      {
        label: 'DD/MM/YYYY',
        value: 'date:dmy',
      },
      {
        label: 'MM/DD/YYYY',
        value: 'date:mdy',
      },
      {
        label: 'YYYY-MM-DD',
        value: 'date:ymd',
      },
      {
        label: '15 Jan 2025',
        value: 'date:long',
      },
      {
        label: 'Mon, 15 Jan 2025',
        value: 'date:full',
      },
    ],
  },
  {
    group: 'Time',
    options: [
      {
        label: '15:30',
        value: 'time:hm',
      },
      {
        label: '15:30:45',
        value: 'time:hms',
      },
      {
        label: '3:30 PM',
        value: 'time:hm12',
      },
      {
        label: '3:30:45 PM',
        value: 'time:hms12',
      },
    ],
  },
  {
    group: 'Date + Time',
    options: [
      {
        label: '15/01/2025, 3:30 PM',
        value: 'datetime:dmy_hm12',
      },
      {
        label: '15 Jan 2025, 3:30 PM',
        value: 'datetime:long_hm12',
      },
      {
        label: '2025-01-15, 15:30:00',
        value: 'datetime:ymd_hms',
      },
    ],
  },
]

// Quick-pick currencies surfaced via the $ button. Click cycles to that
// currency; clicking the active one toggles currency back off.
const CURRENCY_QUICK_PICKS = [
  {
    label: 'USD ($)',
    code: 'USD',
    symbol: '$',
  },
  {
    label: 'EUR (€)',
    code: 'EUR',
    symbol: '€',
  },
  {
    label: 'GBP (£)',
    code: 'GBP',
    symbol: '£',
  },
  {
    label: 'INR (₹)',
    code: 'INR',
    symbol: '₹',
  },
  {
    label: 'JPY (¥)',
    code: 'JPY',
    symbol: '¥',
  },
]
const fileDropdownOptions = computed(() => [
  {
    group: 'Export',
    options: [
      {
        label: 'Export as CSV',
        icon: 'lucide-download',
        onClick: () => exportCSV(),
      },
      {
        label: 'Export as XLSX',
        icon: 'lucide-download',
        onClick: () => exportXLSX(),
      },
      {
        label: 'Export as PDF',
        icon: 'lucide-printer',
        onClick: () => exportPDF(),
      },
    ],
  },
  // Import writes cells — hide it for viewers (export/read stays available).
  ...(readOnly.value
    ? []
    : [
        {
          group: 'Import',
          options: [
            {
              label: 'Import CSV',
              icon: 'lucide-upload',
              onClick: () => csvInputRef.value?.click(),
            },
            {
              label: 'Import XLSX',
              icon: 'lucide-upload',
              onClick: () => xlsxInputRef.value?.click(),
            },
          ],
        },
      ]),
  // Only shown to admins — gated server-side via the boot flag so non-admins
  // never see a settings entry they can't use.
  ...(window.frappe?.boot?.ai_assist_can_configure
    ? [
        {
          group: 'AI',
          options: [
            {
              label: 'AI settings',
              icon: 'lucide-cpu',
              onClick: () => {
                aiSettingsOpen.value = true
              },
            },
          ],
        },
      ]
    : []),
])

// The narrow top bar's one menu: what the wide bar shows as separate buttons.
const compactMenuOptions = computed(() => [
  ...(aiEnabled.value && !readOnly.value
    ? [
        {
          label: 'Ask AI',
          icon: 'lucide-sparkles',
          onClick: () => openAskBar(),
        },
      ]
    : []),
  ...fileDropdownOptions.value,
  {
    group: 'Help',
    options: [
      {
        label: 'Keyboard shortcuts',
        icon: 'lucide-help-circle',
        onClick: () => {
          showShortcutsHelp.value = true
        },
      },
    ],
  },
])

// ── AI Assist ─────────────────────────────────────────────────────────────────
// The Ask bar and AI settings (see useAiAssist.js).
const {
  aiEnabled,
  askOpen,
  askBusy,
  askError,
  askAnswer,
  aiPending,
  askSelectionLabel,
  aiSettingsOpen,
  onAiSettingsSaved,
  openAskBar,
  closeAskBar,
  onAskSubmit,
  onAskKeep,
  onAskUndo,
} = useAiAssist({
  getGrid: () => grid,
  getDocName: () => props.id,
  currentSheet,
  history,
  isDirty,
  syncFlags,
  undo,
  // Defined further down (useToolbar, useProtection): resolved at call time.
  refreshActiveFormat: () => refreshActiveFormat(),
  readIds: _readIds,
  writeInputs: _writeInputs,
  queueOp: _queueOp,
  popLastOp: _popLastOp,
  cellSilentlyProtected: (id, sn) => _cellSilentlyProtected(id, sn),
  flashProtected: (sn) => _flashProtected(sn),
  refitRowsFor: _refitRowsFor,
})

// Remove the most recently queued op of a given type (used when an AI change
// is undone before it has been flushed to the server).
function _popLastOp(opType) {
  for (let i = _opQueue.length - 1; i >= 0; i--) {
    if (_opQueue[i].opType === opType) {
      _opQueue.splice(i, 1)
      return
    }
  }
}

// After a write ({cellId: value}), the rows it touched fit their wrapped or
// multi-line text unless sized by hand, like Google Sheets: they grow or
// shrink with the new values. Returns the height change, which the write puts
// on its history op (beforeRowH / afterRowH) so undo/redo restores it;
// _queueOp destructures only the known keys, so server sync is unaffected.
// Row heights live in the open sheet's canvas view, so a write to another
// sheet doesn't refit.
function _refitRowsFor(sn, writes) {
  if (sn !== currentSheet.value) return null
  return grid?.refitRowsFor?.(writes) ?? null
}

// {cellId: IronCalc num_fmt} for a rect's formatted cells: the format a
// typed `$1.50` or `15%` got from IronCalc, which fill carries along.
async function _readEngineFormats(rect, sn) {
  const { numFmts } = await _readRect(sn, rect, { numFmts: true })
  const out = {}
  numFmts.forEach((row, i) =>
    row.forEach((fmt, j) => {
      if (fmt && !/^general$/i.test(fmt)) out[cellId(rect.r0 + i, rect.c0 + j)] = fmt
    }),
  )
  return out
}

// Sets cells back to IronCalc's general number format (Clear formatting).
function _resetEngineFormats(ids, sn) {
  const commands = ids.map((id) => {
    const p = parseCellId(id)
    const range = { r1: p.row + 1, c1: p.col + 1, r2: p.row + 1, c2: p.col + 1 }
    return _command('setRangeStyle', { sheet: sn, range, style: { num_fmt: 'general' } })
  })
  if (commands.length) _client()?.dispatch(_command('batch', { commands }))
}
const hAlignIcon = computed(() => {
  if (activeFormat.value?.align === 'center') return 'lucide-align-center'
  if (activeFormat.value?.align === 'right') return 'lucide-align-right'
  return 'lucide-align-left'
})

// The logged-in user for the top-right avatar, from the shared suite session
// store (cookie-backed, refreshed by userResource — see @/boot/session). The
// old window.frappe.session reads only worked on the standalone www page; the
// suite shell never sets window.frappe, so the avatar collapsed to "U".
const { user: userEmail, fullName: userFullName, imageURL: userImage } = useCurrentUser()
const userInitial = computed(() => userInitials(userFullName.value, userEmail.value))

const { exportCSV, exportXLSX, exportPDF, importCSV, importXLSX } = useExportImport({
  cells: {
    readSheet: _readWholeSheet,
    write: _writeInputs,
    clear: _clearSheet,
    addSheet: (name) => _client()?.dispatch(_command('addSheet', { name })),
    idle: () => (_client() ? _client().idle() : Promise.resolve()),
  },
  // Lazy: useSheetTabs defines sheetNames further down.
  sheetNames: () => sheetNames.value,
  currentSheet,
  getCurrentTitle: () => currentTitle.value,
  getFormats: () => formats,
  getMerge: () => merge,
  repopulateGrid: _repopulateGrid,
  // Defined later by useSheetTabs — lazy-wrapped so they resolve at call time.
  syncNames: () => syncNames(),
  switchSheet: (n) => switchSheet(n),
  syncFlags,
  isDirty,
})

let grid = null
let ro = null
function syncFlags() {
  canUndo.value = history.canUndo()
  canRedo.value = history.canRedo()
}
function selectionIds() {
  if (!grid) return [activeCell.value]
  const { r0, c0, r1, c1 } = grid.getSelection()
  const ids = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ids.push(colLabel(c) + (r + 1))
  return ids
}

// ── Selection stats ───────────────────────────────────────────────────────────

// Count / Sum / Avg in the status bar. Called from onSelect on every
// selection change (arrow nav, click, drag-extend, Enter advancing), so
// it has to be cheap.
//
// The worker adds the range up (rangeStats), visiting only rows that hold
// data, so a whole-column selection costs the used rows. RAF-coalesced so a
// drag-extend that fires onSelect 1000× still asks once per frame, and a
// newer selection's token drops an older answer.
let _statsRAF = null
let _statsToken = 0
function computeSelectionStats() {
  _statsToken++
  if (_statsRAF) cancelAnimationFrame(_statsRAF)
  const token = _statsToken
  _statsRAF = requestAnimationFrame(() => {
    _statsRAF = null
    _computeSelectionStatsAsync(token)
  })
}
async function _computeSelectionStatsAsync(token) {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  if ((r1 - r0 + 1) * (c1 - c0 + 1) <= 1) {
    selectionStats.value = null
    return
  }
  const sn = currentSheet.value
  if (!_client()) return
  const { count, numCount, sum } = await _client().rangeStats({
    sheet: sn,
    r1: r0 + 1,
    c1: c0 + 1,
    r2: r1 + 1,
    c2: c1 + 1,
  })
  if (token !== _statsToken) return
  selectionStats.value =
    count === 0
      ? null
      : {
          count,
          sum: numCount > 0 ? sum : null,
          avg: numCount > 0 ? sum / numCount : null,
        }
}

// ── Number format helpers ─────────────────────────────────────────────────────
// Grammar + renderer live in utils/format-number.js so they can be unit-tested
// in isolation. The toolbar wiring below is the only Vue-specific bit.

// Bump decimal precision for the selection. Treats 'General' as 'number:1' on
// first +, no-op on -. Numeric types pick a sensible default if no decimals
// were previously set. A cell with no format of ours starts from the one
// IronCalc gave a typed `$1.50` or `50%`, so the $ or % stays.
async function adjustDecimals(delta) {
  const ids = selectionIds()
  const sh = currentSheet.value
  const sel = grid?.getSelection()
  const small = sel && (sel.r1 - sel.r0 + 1) * (sel.c1 - sel.c0 + 1) <= 10000
  const engineFmts = small ? await _readEngineFormats(sel, sh) : {}
  _recordFormatOp(ids, sh, () => {
    for (const id of ids) {
      const cur = formats.get(id, sh).numberFormat || numFmtFromEngine(engineFmts[id])
      let { type, variant, decimals } = parseNumberFmt(cur)
      if (!type) {
        if (delta < 0) continue
        type = 'number'
        decimals = 0
      }
      const defaultDec = type === 'currency' ? 2 : type === 'percentage' ? 2 : 2
      if (decimals == null) decimals = defaultDec
      decimals = Math.max(0, Math.min(20, decimals + delta))
      const next = buildNumberFmt(type, variant, decimals)
      formats.applyToRange(
        [id],
        {
          numberFormat: next,
        },
        sh,
      )
    }
  })
  grid?.render?.() // the grid applies number formats as it paints
  _syncNumberFormat(activeCell.value)
  syncFlags()
  isDirty.value = true
  recordAction?.('adjustDecimals', [delta])
}

// ── Composables ───────────────────────────────────────────────────────────────

const {
  activeFormat,
  refreshActiveFormat,
  toggleFmt,
  setAlign,
  setValign,
  setColor,
  clearFormatting,
  getLastAction,
  recordAction,
} = useToolbar({
  currentSheet,
  formats,
  getGrid: () => grid,
  history,
  selectionIds,
  getScope: _selectionScope,
  syncFlags,
  markDirty: () => {
    isDirty.value = true
  },
  readEngineFormats: _readEngineFormats,
  resetEngineFormats: _resetEngineFormats,
})

// Selection + grid bounds, so full-column / full-row / whole-sheet selections
// format at the column/row level (one entry) instead of per cell. Null when
// the grid isn't mounted yet → callers fall back to per-cell.
function _selectionScope() {
  if (!grid) return null
  return {
    rect: grid.getSelection(),
    totalRows: grid.getTotalRows(),
    totalCols: grid.getTotalCols(),
  }
}

// Toolbar dropdown configs that don't depend on pivot composable.
function toggleSortFilter() {
  showSortFilter.value = !showSortFilter.value
}
const alignDropdownOptions = buildAlignOptions({
  setAlign,
  setValign,
})
const borderDropdownOptions = buildBorderOptions({
  applyBorder,
})

// Maps the current cell's font-family string back to a short key so the
// toolbar select shows e.g. "Inter" instead of the full CSS stack.
const activeFontFamilyKey = computed(() => {
  const f = activeFormat.value?.fontFamily
  if (!f) return 'inter'
  for (const [k, v] of Object.entries(FONT_FAMILY_STACK)) if (v === f) return k
  return 'inter'
})
const activeFontFamilyLabel = computed(
  () => FONT_FAMILY_OPTIONS.find((o) => o.value === activeFontFamilyKey.value)?.label || 'Inter',
)
const fontFamilyDropdownOptions = computed(() =>
  FONT_FAMILY_OPTIONS.map((o) => ({
    label: o.label,
    onClick: () => setFontFamily(o.value),
  })),
)

// Maps the stored format string → human label shown on the dropdown trigger.
// Falls back to the type when the exact format isn't a named preset (e.g.
// the user bumped decimals on a currency format).
const _FORMAT_LABELS = (() => {
  const m = new Map()
  for (const g of NUMBER_FORMAT_GROUPS) for (const it of g.options) m.set(it.value, it.label)
  return m
})()

// Custom number-format dialog. `pattern` is a raw Excel-style code; it's
// stored as `custom:<pattern>` so the display path routes it to applyCustomFmt.
const customFormatDialog = reactive({
  open: false,
  pattern: '',
})
function openCustomFormatDialog() {
  const cur = parseNumberFmt(activeNumberFormat.value)
  customFormatDialog.pattern = cur.type === 'custom' ? cur.pattern : '#,##0.00'
  customFormatDialog.open = true
}

// Live preview against a representative value so the user sees the effect
// before applying. Falls back to empty on a pattern that throws.
const customFormatPreview = computed(() => {
  const p = customFormatDialog.pattern.trim()
  if (!p) return ''
  try {
    return applyNumberFmt(1234.567, 'custom:' + p)
  } catch {
    return ''
  }
})
function confirmCustomFormat() {
  const p = customFormatDialog.pattern.trim()
  if (p) onNumberFormatChange('custom:' + p)
  customFormatDialog.open = false
}
const numberFormatLabel = computed(() => {
  const cur = activeNumberFormat.value
  if (_FORMAT_LABELS.has(cur)) return _FORMAT_LABELS.get(cur)
  const { type, variant } = parseNumberFmt(cur)
  if (!type) return 'General'
  // Synthesise a label for variants that don't have a preset (e.g. user
  // adjusted decimals on a known type+variant combo).
  if (type === 'currency') return `Currency · ${variant || 'USD'}`
  if (type === 'date') return variant ? `Date · ${variant}` : 'Date'
  if (type === 'time') return variant ? `Time · ${variant}` : 'Time'
  if (type === 'datetime') return 'Date + Time'
  return type[0].toUpperCase() + type.slice(1)
})
const numberFormatDropdownOptions = computed(() => [
  ...NUMBER_FORMAT_GROUPS.map((g) => ({
    group: g.group,
    options: g.options.map((it) => ({
      label: it.label,
      onClick: () => onNumberFormatChange(activeNumberFormat.value === it.value ? '' : it.value),
    })),
  })),
  {
    group: 'Custom',
    options: [
      {
        label: 'Custom format…',
        onClick: () => openCustomFormatDialog(),
      },
    ],
  },
])

// Active currency code (for the $-button symbol). Defaults to $ when the cell
// isn't a currency at all, so the button always says *something* clickable.
const activeCurrencySymbol = computed(() => {
  const { type, variant } = parseNumberFmt(activeNumberFormat.value)
  if (type !== 'currency') return '$'
  const hit = CURRENCY_QUICK_PICKS.find((c) => c.code === (variant || 'USD'))
  return hit ? hit.symbol : '$'
})
const currencyDropdownOptions = computed(() =>
  CURRENCY_QUICK_PICKS.map((c) => {
    const fmt = `currency:${c.code}:${c.code === 'JPY' ? 0 : 2}`
    return {
      label: c.label,
      onClick: () => onNumberFormatChange(activeNumberFormat.value === fmt ? '' : fmt),
    }
  }),
)
function repeatLast() {
  const last = getLastAction()
  if (!last) return
  const handlers = {
    toggleFmt,
    setAlign,
    setValign,
    setColor,
    clearFormatting,
    adjustDecimals,
    adjustFontSize,
    setFontSize,
    setFontFamily,
    toggleWrap,
  }
  handlers[last.kind]?.(...last.args)
}

// Writes `textWrap` (overflow | clip | wrap) for the selection, then refits
// its rows: they grow to show wrapped text, or shrink back when wrapping is
// turned off. Rows sized by hand keep their height.
function setTextWrap(mode) {
  formats.applyToRange(
    selectionIds(),
    {
      textWrap: mode,
    },
    currentSheet.value,
  )
  refreshActiveFormat()
  isDirty.value = true
  if (grid) {
    const { r0, r1 } = grid.getSelection()
    grid.refitRows(r0, r1)
  }
  recordAction?.('setTextWrap', [mode])
}

// Kept for the repeat-last shortcut handler (which dispatches by action
// name); rebound to setTextWrap('wrap') / 'overflow' toggle.
function toggleWrap() {
  setTextWrap(activeTextWrap.value === 'wrap' ? 'overflow' : 'wrap')
}
const activeTextWrap = computed(() => getTextWrap(activeFormat.value))
const TEXT_WRAP_ICON = {
  overflow: 'lucide-corner-down-right',
  clip: 'lucide-minimize',
  wrap: 'lucide-corner-down-left',
}
const textWrapIcon = computed(
  () => TEXT_WRAP_ICON[activeTextWrap.value] || 'lucide-corner-down-left',
)
const textWrapDropdownOptions = computed(() => [
  {
    label: 'Overflow',
    icon: TEXT_WRAP_ICON.overflow,
    onClick: () => setTextWrap('overflow'),
  },
  {
    label: 'Clip',
    icon: TEXT_WRAP_ICON.clip,
    onClick: () => setTextWrap('clip'),
  },
  {
    label: 'Wrap',
    icon: TEXT_WRAP_ICON.wrap,
    onClick: () => setTextWrap('wrap'),
  },
])

// View state is now per-sheet (kept in useSheetTabs._viewBySheet) so freeze /
// hidden rows / column widths / etc. follow each tab independently. usePersistence
// is constructed before useSheetTabs, so the get/apply callbacks late-bind via
// `_sheetTabs` once that hook returns its API. The `grid?.viewSnapshot/Restore`
// fallbacks only cover the impossible window where someone saves before
// useSheetTabs has finished initializing.
let _sheetTabs = null
const {
  isSaving,
  saveError,
  canWrite,
  loadError,
  legacyUpgrade,
  loadSheet,
  autoCreate,
  saveExisting,
  retrySave,
  workbookJson,
} = usePersistence({
  engine: {
    start: _startEngine,
    toBytes: _engineBytes,
    client: _client,
    syncDefinedNames: _syncDefinedNames,
  },
  formats,
  merge,
  comments,
  validation,
  protection,
  condFormat,
  sortFilter,
  slicers,
  pivot,
  charts,
  namedRanges,
  getViewState: () => _sheetTabs?.viewSnapshot?.() ?? grid?.viewSnapshot?.(),
  applyViewState: (s) => {
    if (_sheetTabs?.viewRestore) _sheetTabs.viewRestore(s)
    else grid?.viewRestore?.(s)
  },
  currentTitle,
  emit,
  isWritable: () => props.writable,
  onRefused: () => emit('access-refused'),
  recordVisits: !props.embedded,
  requestContext: props.requestContext,
})

// View-only mode: the loaded sheet is shared with the current user at read
// (not write) permission. Everything that mutates the doc keys off this — the
// grid edit gate, the toolbar/formula-bar disable, the context menu, and the
// autosave path all no-op so a viewer is never misled into editing a doc they
// can't persist (and never triggers the server's PermissionError on save).
const readOnly = computed(() => !canWrite.value || !props.writable)
// Where the workbook's edits are: clean, saving, unsaved or failed.
const saveState = computed(() =>
  isSaving.value ? 'saving' : saveError.value ? 'failed' : isDirty.value ? 'unsaved' : 'clean',
)

// Losing write access drops every pending edit from the save path: the queued
// autosave, the failed-save watchdog, the op queue, and a failed batch. The
// surface keeps those edits as its recovery copy instead. A save already in
// flight stops before its next retry, and `_accessEpoch` disowns its result.
// When access comes back the surface remounts the editor, so it reloads the
// server workbook before editing resumes.
let _accessEpoch = 0
watch(readOnly, (frozen) => {
  if (!frozen) return
  _accessEpoch += 1
  clearTimeout(_autoSaveTimer)
  clearTimeout(_saveWatchdogTimer)
  _opQueue.length = 0
  _pendingSaveBatch = null
  isDirty.value = false
  saveError.value = ''
})
if (props.embedded) {
  watch(
    () => props.title,
    (title) => {
      if (title != null) currentTitle.value = title
    },
    {
      immediate: true,
    },
  )
}
_sheetTabs = useSheetTabs({
  names: () => _client()?.sheets ?? [currentSheet.value],
  run: (type, payload) => _client()?.dispatch(_command(type, payload)),
  currentSheet,
  formats,
  extras: [merge, comments, validation, protection, condFormat, sortFilter, slicers, charts, pivot],
  getGrid: () => grid,
  activeCell,
  showInput: (id) => _showInputInFormulaBar(id),
  refreshActiveFormat,
  onSwitch: () => {
    filterPanel.open = false // close any open filter popover so it doesn't carry stale state
    _repopulateGrid()
    // The cut/copy stays pending so it can be pasted on this tab; only its
    // marching ants, drawn for the other tab, go.
    grid?.setMarchingAnts(null)
    _applyHiddenRows() // refresh filter-driven row hides for the new sheet
    // Re-mirror freeze / hidden refs into the Vue state so the context-menu
    // predicates and toolbar reflect the new sheet's restored view.
    _syncViewMirrors()
  },
})
const {
  sheetNames,
  switchSheet,
  addSheet: _addSheet,
  renameSheet: _renameSheet,
  duplicateSheet: _duplicateSheet,
  deleteSheet: _deleteSheet,
  reorderSheets,
  syncNames,
} = _sheetTabs

// Formula autocomplete — placed here because sheetNames comes from useSheetTabs above.
const { acItems, acIdx, acUp, acVisible, updateAc, commitAc, closeAc } = useFormulaAutocomplete({
  formulaInputRef,
  formulaValue,
  sheetNames,
})

// Context menu — placed here because contextMenu is passed to usePivotIntegration below.
const {
  contextMenu,
  tabMenu,
  openCanvasContextMenu: onCanvasContextMenu,
  openTabMenu,
} = useContextMenu({
  getGrid: () => grid,
})

// The right-click menu is entirely mutation actions (insert/delete/freeze/
// paste-special/…), so suppress it for viewers — the native browser menu still
// offers copy. Defined here (after the alias) and wired at listener setup.
function _onCanvasContextMenu(e) {
  if (readOnly.value) return
  onCanvasContextMenu(e)
}

// Same reasoning for the sheet-tab menu: every item (rename/duplicate/protect/
// delete) mutates, so a viewer has nothing to do there. Suppress it entirely —
// `.prevent` on the binding still eats the native menu — rather than open an
// empty popover. Rename (dbl-click) and reorder (drag) are gated separately.
function _onTabMenu(e, name) {
  if (readOnly.value) return
  openTabMenu(e, name)
}

// renderVersion is defined here because usePivotIntegration reads it at call time.
const renderVersion = ref(0)

// Pivot integration — placed here because switchSheet/syncNames come from useSheetTabs above.
const {
  pivotDialogOpen,
  pivotInitialRange,
  pivotEditId,
  pivotEditConfig,
  pivotBuilding,
  activePivotConfig,
  pivotFabStyle,
  pivotHighlightStyle,
  pivotBannerMenuOptions,
  isPivotSheet,
  openPivotDialog,
  onPivotConfirm,
  recomputePivotsForSheet,
  drillDownAt,
  getPivotAt,
  createPastedPivot,
} = usePivotIntegration({
  pivot,
  cells: {
    readRange: _readSourceRange,
    readSheet: _readWholeSheet,
    write: _writeInputs,
    clear: _clearRect,
    addSheet: (name) => _client()?.dispatch(_command('addSheet', { name })),
    idle: () => (_client() ? _client().idle() : Promise.resolve()),
  },
  sheetNames: () => sheetNames.value,
  formats,
  currentSheet,
  activeCell,
  renderVersion,
  getGrid: () => grid,
  contextMenu,
  switchSheet,
  syncNames,
  history,
  isDirty,
  repopulateGrid: _repopulateGrid,
})

// Chart integration — engine + dialog wiring. Charts float above the canvas
// (ChartOverlay) and re-derive their source matrices reactively from the
// sheet engine, so any cell edit propagates without explicit refresh calls.
const {
  chartDialogOpen,
  chartInitialRange,
  chartEditId,
  chartEditConfig,
  charts: chartList,
  selectedChartId,
  chartDataVersion,
  matrixVersion: chartMatrixVersion,
  openInsert: openChartDialog,
  openEdit: openChartEdit,
  onChartConfirm,
  onChartDelete,
  onChartMove,
  onChartResize,
  onChartRefresh,
  selectChart,
  getMatrix: getChartMatrix,
} = useChartIntegration({
  chart: charts,
  readRange: (sn, rect) => _readDisplays(sn, rect),
  currentSheet,
  contextMenu,
  history,
  isDirty,
  getGrid: () => grid,
})

// Mirrors the `.sn-tool-extra` media query in SheetToolbar.vue's <style>: below
// this width the inline tool groups are hidden and the "…" menu carries them.
const toolbarCollapsed = useMediaQuery('(max-width: 1280px)')
const moreToolbarOptions = computed(() =>
  buildMoreToolbarOptions({
    toggleFmt,
    toggleWrap,
    toggleFormatPainter,
    clearFormatting,
    adjustDecimals,
    openCfDialog,
    openHyperlinkDialog,
    toggleMerge,
    toggleSortFilter,
    applyBorder,
    zoomBy,
    resetZoom,
    openPivotDialog,
    openChartDialog,
    openNamedRangesDialog,
    runSmartFill,
    collapsed: toolbarCollapsed.value,
  }),
)

// Collaboration — placed here because currentSheet comes from useSheetTabs above.
const {
  presentUsers,
  remoteCursors,
  broadcastCellChange,
  broadcastBatchChange,
  broadcastCursor,
  drainLocalTouches,
} = useCollaboration({
  sheetId: computed(() => props.id),
  currentSheet,
  repopulateGrid: _repopulateGrid,
  onRefused: () => emit('access-refused'),
  credentialFetch: props.credentialFetch,
})
// Wire the binding's per-segment touch-tracking into the history we declared
// up top — undo() will now revert only this client's writes from the undone
// segment, leaving any remote-applied cells alone.
_collabDrainLocalTouches = drainLocalTouches

// Split text — placed after currentSheet from useSheetTabs.
const {
  splitText,
  doSplitTextToColumns,
  onSplitChoose,
  onSplitApply,
  onSplitCancel,
  revertSplitPreview: _revertSplitPreview,
  closeSplit: _closeSplit,
} = useSplitText({
  readInputs: (rect, sn) => _readInputs(rect, sn),
  writeInputs: (sn, map) => _writeInputs(sn, map),
  getGrid: () => grid,
  getGridWrap: () => gridWrapRef.value,
  contextMenu,
  currentSheet,
  pushEditOp: (sn, before, after, summary, extra) => _pushEditOp(sn, before, after, summary, extra),
  blockProtected: (rect, sn) => _rectBlocked(rect, sn),
})

// Adding a sheet used to push a full-workbook snapshot (history.push deep-clones
// every cell of every sheet — ~2s on a large workbook). The new sheet is empty,
// so undo/redo only needs its name: a cheap structural op instead of a snapshot.
function addSheet() {
  const name = _addSheet()
  history.pushOp({
    opType: 'sheet_add',
    subSheet: name,
    name,
  })
  isDirty.value = true
}

// ── Sheet-tab click — cross-sheet picker support ──────────────────────────────
// When the user is mid-edit in the formula bar (`=…` content + bar has focus),
// clicking another tab should keep the edit alive instead of trashing it.
// The trick is two-fold: prevent the default mousedown so focus stays on the
// input, and call switchSheet with preserveEdit so activeCell + formulaValue
// don't get clobbered by the switch.
function _isEditingFormulaInBar() {
  return (
    document.activeElement === formulaInputRef.value &&
    typeof formulaValue.value === 'string' &&
    formulaValue.value.startsWith('=')
  )
}
function _isEditingFormulaInCell() {
  return grid?.isEditingFormula?.() ?? false
}
function _isEditingFormula() {
  return _isEditingFormulaInBar() || _isEditingFormulaInCell()
}
function onTabMousedown(e, _name) {
  // Default mousedown on the tab button focuses it, which would blur the
  // formula-bar input (or the in-cell overlay) before our click handler can
  // snapshot the edit. Suppress only when an active formula edit needs the
  // focused element to keep focus.
  if (_isEditingFormula()) e.preventDefault()
}
function onTabClick(name) {
  if (_isEditingFormula()) {
    if (!editingHomeSheet.value) {
      editingHomeSheet.value = currentSheet.value
      editingHomeCell.value = activeCell.value
    }
    switchSheet(name, {
      preserveEdit: true,
    })
    // Re-focus whichever input was being edited — some Buttons steal focus
    // on click despite mousedown preventDefault.
    nextTick(() => {
      if (_isEditingFormulaInCell()) return // overlay handles its own focus
      formulaInputRef.value?.focus()
    })
  } else {
    switchSheet(name)
  }
}

// ── Sheet-tab drag-to-reorder ─────────────────────────────────────────────────
const tabDragName = ref(null)
const tabDragOver = ref(null)

// Reorder is a mutation. `:draggable="!readOnly"` stops a viewer starting a
// drag, but dragover/drop still fire when *another* element is dragged onto a
// tab — guard the whole lifecycle so the invariant "viewers can't reorder" is
// explicit here, not just an emergent effect of the null tabDragName.
function onTabDragStart(e, name) {
  if (readOnly.value) return
  tabDragName.value = name
  e.dataTransfer.effectAllowed = 'move'
  // Some browsers require setData to allow the drag
  try {
    e.dataTransfer.setData('text/plain', name)
  } catch (_) {}
}
function onTabDragOver(e, name) {
  if (readOnly.value) return
  if (!tabDragName.value || tabDragName.value === name) return
  e.dataTransfer.dropEffect = 'move'
  tabDragOver.value = name
}
function onTabDrop(e, target) {
  if (readOnly.value) return
  const src = tabDragName.value
  if (!src || src === target) {
    tabDragOver.value = null
    return
  }
  const next = sheetNames.value.filter((n) => n !== src)
  const idx = next.indexOf(target)
  next.splice(idx, 0, src)
  reorderSheets(next)
  tabDragOver.value = null
  tabDragName.value = null
  history.push()
  isDirty.value = true
}
function onTabDragEnd() {
  tabDragName.value = null
  tabDragOver.value = null
}

// ── Add more rows ─────────────────────────────────────────────────────────────
const addRowsCount = ref(1000)

// The strip is hidden until the viewport reaches the last ~10 rows, then
// surfaces so the user can extend the sheet without scrolling past empty space.
// `renderVersion` ticks on every canvas render, so this reactively updates with
// scroll, resize, freeze, and expandRows.
const showAddRows = computed(() => {
  renderVersion.value
  return grid?.isNearBottom?.(10) ?? false
})
function doAddMoreRows() {
  const n = Math.max(1, Math.min(10000, parseInt(addRowsCount.value, 10) || 1000))
  grid?.expandRows(n)
  history.push()
  isDirty.value = true
}

// ── Sort & Filter ─────────────────────────────────────────────────────────────
// The filter, its overlay geometry and the filter panel (see useSortFilter.js).
const {
  filterPanel,
  showSortFilter,
  filterConfig,
  visibleFilterCols,
  filterPanelStyle,
  filterHighlightStyle,
  detectContiguousBlock: _detectContiguousBlock,
  openFilterPanel,
  openQuickFilterForActive,
  applyFilter,
  clearFilterCol,
  doSort,
} = useSortFilter({
  sortFilter,
  currentSheet,
  activeCell,
  renderVersion,
  gridWrapRef,
  history,
  getGrid: () => grid,
  readRect: _readRect,
  rectBlocked: (rect, sn) => _rectBlocked(rect, sn),
  pushEditOp: (sn, before, after, summary, extra) => _pushEditOp(sn, before, after, summary, extra),
  repopulateGrid: () => _repopulateGrid(),
  applyHiddenRows: () => _applyHiddenRows(),
  markDirty: () => {
    isDirty.value = true
  },
  formats,
  captureFormatsRange: _captureFormatsRange,
  readEngineFormats: _readEngineFormats,
  resetEngineFormats: _resetEngineFormats,
})

// Per-sub-sheet peer dots — small colored circles next to each tab label
// so you can see at a glance who's looking at which tab without having
// to switch. Caps at 3 dots + "+N" overflow per tab.
const peersBySubSheet = computed(() => {
  const out = new Map() // name → Array<{user, color, full_name}>
  for (const u of presentUsers.value) {
    if (!u.sub_sheet) continue
    if (!out.has(u.sub_sheet)) out.set(u.sub_sheet, [])
    out.get(u.sub_sheet).push(u)
  }
  return out
})

// Per-user memory of the last-seen remote (row, col, subSheet) so we can
// tell "the peer actually moved" from "the local viewport scrolled". The
// CSS transition on `.sn-remote-cursor--moved` only fires on real motion.
const _lastRemoteRC = new Map() // user → 'r:c:subSheet'

// Remote cursors for users on the same sheet — re-evaluated when the canvas renders
// (renderVersion) or when remoteCursors updates.
const visibleRemoteCursors = computed(() => {
  renderVersion.value
  if (!grid) return []
  // Prune lastRC entries for peers that left so the Map doesn't grow
  // unbounded as users come and go through a long session.
  for (const user of _lastRemoteRC.keys()) {
    if (!remoteCursors.value.has(user)) _lastRemoteRC.delete(user)
  }
  return [...remoteCursors.value.entries()]
    .filter(([, cursor]) => cursor.subSheet === currentSheet.value)
    .map(([user, cursor]) => {
      // Compute a single rect that covers the whole remote range. We pull
      // the top-left cell rect for x/y and the bottom-right cell rect to
      // sum the trailing width/height — handles non-uniform column widths
      // / row heights correctly.
      const r = cursor.range || {
        r0: cursor.row,
        c0: cursor.col,
        r1: cursor.row,
        c1: cursor.col,
      }
      const tl = grid.getCellRect?.(r.r0, r.c0)
      const br = grid.getCellRect?.(r.r1, r.c1)
      if (!tl || !br) return null
      const width = br.x + br.width - tl.x
      const height = br.y + br.height - tl.y
      // Motion detection: the row/col/subSheet stamp is what determines
      // whether the *peer* moved. If the stamp is unchanged but the pixel
      // rect differs, that's a local scroll/resize — we leave justMoved
      // false so the cursor teleports with the viewport rather than
      // sliding under the user's mouse.
      const stamp = `${cursor.row}:${cursor.col}:${cursor.subSheet}`
      const prev = _lastRemoteRC.get(user)
      const justMoved = prev !== undefined && prev !== stamp
      _lastRemoteRC.set(user, stamp)
      return {
        user,
        firstName: cursor.firstName || cursor.initials,
        initials: cursor.initials,
        color: cursor.color,
        fullName: cursor.fullName,
        justMoved,
        style: {
          left: tl.x + 'px',
          top: tl.y + 'px',
          width: width + 'px',
          height: height + 'px',
          '--rc': cursor.color,
        },
      }
    })
    .filter(Boolean)
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// ── Mount phases ─────────────────────────────────────────────────────────────

function _setupGridInstance() {
  grid = createGrid(canvasRef.value, {
    // What the grid reads about cells (CellProvider).
    cells: {
      getStyle: (id) => formats.get(id, currentSheet.value),
      // Lazy render value source (Phase 1, off by default). Mirrors exactly what
      // _repopulateGrid / onCellChanged bake into the grid's eager `data` cache,
      // so the lazy and eager render paths produce identical pixels. When enabled
      // (grid.setLazyValues(true)), the grid pulls this per visible cell instead
      // of materialising every cell up front.
      getDisplay: _cellDisplay,
      // The in-cell editor opens with the raw input (the formula, not its
      // result), matching the formula bar set in onSelect.
      getEditValue: (id) => _inputAt(id) ?? (id === activeCell.value ? formulaValue.value : ''),
      // Non-empty cell ids for the current sheet — the lazy path's source for
      // cold-path scans (Cmd+A extent, autofit) that used to walk the grid's
      // own `data` keys.
      getCellIds: () => _usedCellIds(),
      // Formulas shown as text: let the painter guess from what it shows.
      isNumber: (id) => (showFormulas.value ? undefined : _isNumberAt(id)),
      getMergeInfo: (id) => merge.getMasterInfo(id, currentSheet.value),
      isSlave: (id) => merge.isSlave(id, currentSheet.value),
      getMasterId: (id) => merge.getMasterId(id, currentSheet.value),
      getComment: (id) => comments.hasOpenComment(id, currentSheet.value),
      getValidation: (id) => validation.get(id, currentSheet.value),
      getCondFormat: (id, val) =>
        condFormat.getFormatOverride(id, val, currentSheet.value, (cid) => _displayValue(cid)),
      // A SPARKLINE formula evaluates to a spec object; the painter draws it.
      // In show-formulas mode the cell shows its =SPARKLINE(...) text instead.
      getSparkline: (id) => (showFormulas.value ? null : _sparklineAt(id)),
      getRightInset: (id) => {
        const range = sortFilter.getRange(currentSheet.value)
        if (!range) return 0
        const p = parseCellId(id)
        if (!p) return 0
        // Reserve 19px right-padding in the filter header row inside the active range.
        return p.row === range.r0 && p.col >= range.c0 && p.col <= range.c1 ? 19 : 0
      },
      isCellEditable: (r, c) => !protection.isProtected(r, c, currentSheet.value),
    },
    // What the grid reports, and the app state it asks for (GridHost).
    host: {
      onSelect(id) {
        activeCell.value = id
        _typedCell = null
        _showInputInFormulaBar(id)
        refreshActiveFormat()
        _syncNumberFormat(id)
        computeSelectionStats()
        if (isPaintingFormat.value) _applyPaintedFormat()
        const p = parseCellId(id)
        if (p) {
          // Send the full selection rect so peers can paint a range outline,
          // not just a single anchor cell.
          const sel = grid?.getSelection?.()
          const range = sel
            ? {
                r0: sel.r0,
                c0: sel.c0,
                r1: sel.r1,
                c1: sel.c1,
              }
            : null
          broadcastCursor(p.row, p.col, currentSheet.value, range)
        }
      },
      onCommit(id, value) {
        // Cross-sheet path: in-cell overlay was editing on `homeSheet`, user
        // hopped over to another sheet to pick a range, then pressed Enter.
        // Write the formula back to the home sheet and snap the canvas there
        // so the next-row move-down on Enter lands on the home sheet too.
        const homeSheet = editingHomeSheet.value
        const writeSheet =
          homeSheet && homeSheet !== currentSheet.value ? homeSheet : currentSheet.value

        // Protection first — blocks writes AND clears (empty value) on a locked
        // cell. Nothing was written, so repaint the pre-edit value and bail.
        if (_cellBlocked(id, writeSheet)) {
          grid?.render?.()
          editingHomeSheet.value = null
          editingHomeCell.value = null
          _typedCell = null
          syncFlags()
          return
        }

        // Enforce data validation rules. The engine stores rules in the snapshot
        // and the canvas paints a dropdown arrow for `list` rules, but until
        // now nothing surfaced number / text_length rejection — so "between 1
        // and 10" silently accepted any value. Skip the check for empty values
        // so the user can always clear a cell (matches Google Sheets).
        const trimmed = String(value ?? '').trim()
        if (trimmed !== '') {
          const v = validation.validate(id, value, writeSheet)
          // 'warn' rules let the value through but surface a transient notice;
          // 'reject' (default) blocks the edit and repaints the pre-edit value.
          if (!v.valid && v.severity !== 'warn') {
            const msg = v.message || 'Value rejected by data validation rule'
            saveError.value = msg
            setTimeout(() => {
              if (saveError.value === msg) saveError.value = ''
            }, 3500)
            // Force a re-render so the canvas repaints with the pre-edit value
            // (we never called sheet.setCell so the engine still has it).
            grid?.render?.()
            editingHomeSheet.value = null
            editingHomeCell.value = null
            _typedCell = null
            syncFlags()
            return
          }
          if (!v.valid && v.severity === 'warn') {
            const msg = v.message || 'Value flagged by data validation rule'
            saveError.value = msg
            setTimeout(() => {
              if (saveError.value === msg) saveError.value = ''
            }, 3500)
          }
        }
        const before = _inputAt(id, writeSheet) ?? ''
        _writeInputs(writeSheet, { [id]: value })
        // Delete clears the cell in place; the selection doesn't move, so
        // nothing else refreshes the formula bar.
        if (writeSheet === currentSheet.value && id === activeCell.value) formulaValue.value = value
        if (writeSheet !== currentSheet.value) {
          switchSheet(writeSheet, {
            preserveEdit: true,
          })
        }
        if (before !== value) {
          // The same op shape feeds both server sync (_queueOp drains on
          // autosave) and undo history (pushOp keeps it on the local stack).
          // Op-based history replaces the old markEdited → snapshot path:
          // ~750 ms (deep-clone every engine) → ~10 µs (push the op object).
          const op = {
            opType: 'edit',
            subSheet: writeSheet,
            cellRefs: [id],
            before: {
              [id]: before,
            },
            after: {
              [id]: value,
            },
          }
          // The row refits to the edit (wrapped text, Cmd+Enter lines).
          const rowH = _refitRowsFor(writeSheet, { [id]: value })
          if (rowH) {
            op.beforeRowH = rowH.before
            op.afterRowH = rowH.after
          }
          _queueOp(op)
          history.pushOp(op)
          broadcastCellChange(writeSheet, id, value)
        }
        // Outside the changed-guard: re-committing an unchanged URL text (e.g.
        // pre-existing "frappe.io" data) still picks up its link.
        _maybeAutoLink(
          [
            {
              id,
              value,
              before,
            },
          ],
          writeSheet,
        )
        editingHomeSheet.value = null
        editingHomeCell.value = null
        _typedCell = null
        syncFlags()
        isDirty.value = true
        recomputePivotsForSheet(writeSheet)
      },
      onInput(id, value) {
        formulaValue.value = value
        _typedCell = {
          sheet: currentSheet.value,
          cell: id,
        }
      },
      onCancel(id) {
        const homeSheet = editingHomeSheet.value
        if (homeSheet && homeSheet !== currentSheet.value) {
          switchSheet(homeSheet) // full reset so canvas snaps back to home cell
        }
        editingHomeSheet.value = null
        editingHomeCell.value = null
        _typedCell = null
        _showInputInFormulaBar(id)
      },
      onHyperlinkClick(url) {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
      onLinkHover: _onLinkHover,
      onDropdownClick(id, rule, pos) {
        openDropdown(id, rule, pos)
      },
      onCheckboxToggle(id) {
        toggleCheckbox(id)
      },
      onPivotDrill(r, c) {
        return drillDownAt(r, c)
      },
      getSheetNames() {
        return sheetNames.value
      },
      // Cross-sheet picker — grid prefixes inserted refs with the current sheet
      // when it differs from the edit's home sheet. Home is null outside of an
      // active cross-sheet edit, in which case the prefix is omitted.
      getCurrentSheet() {
        return currentSheet.value
      },
      getEditingHomeSheet() {
        return editingHomeSheet.value
      },
      onBlockedEdit: () => _flashProtected(currentSheet.value),
      onFill(src, total, { withModifier = false } = {}) {
        if (_fillDestBlocked(src, total)) return // only the destination cells, not the source
        _fillFromHandle(src, total, withModifier).catch((e) =>
          console.error('[sheets] fill failed', e),
        )
      },
      onBatchCommit(cells) {
        if (_cellsBlocked(cells.map((c) => c.id))) return
        const { before, after, refs } = diffCells(cells, (id) => _inputAt(id) ?? '')
        _writeInputs(
          currentSheet.value,
          Object.fromEntries(cells.map(({ id, value }) => [id, value])),
        )
        // The formula bar shows the active cell; Delete may have just cleared it.
        const active = cells.find(({ id }) => id === activeCell.value)
        if (active) formulaValue.value = active.value
        if (refs.length) {
          const op = {
            opType: 'edit',
            subSheet: currentSheet.value,
            cellRefs: refs,
            before,
            after,
            summary: refs.length > 1 ? `Edited ${refs.length} cells` : '',
          }
          // Delete clears wrapped text: its rows shrink back.
          const rowH = _refitRowsFor(currentSheet.value, after)
          if (rowH) {
            op.beforeRowH = rowH.before
            op.afterRowH = rowH.after
          }
          _queueOp(op)
          history.pushOp(op)
          broadcastBatchChange(
            currentSheet.value,
            refs.map((id) => ({
              id,
              value: after[id],
            })),
          )
        }
        _maybeAutoLink(
          cells.map(({ id, value }) => ({
            id,
            value,
            before: before[id] !== undefined ? before[id] : value,
          })),
          currentSheet.value,
        )
        syncFlags()
        isDirty.value = true
        recomputePivotsForSheet(currentSheet.value)
      },
      onResizeEnd() {
        history.push()
        isDirty.value = true
      },
      onColMove(fromCol, toCol, count) {
        if (readOnly.value) return
        doMoveCol(fromCol, toCol, count)
      },
      // Gate every in-canvas mutation (begin-edit, delete, fill, resize,
      // checkbox/dropdown) on write permission. Read-only viewers keep
      // selection, navigation and copy.
      canEdit: () => !readOnly.value,
    },
    lazyValues: true,
  })
  // Keep DOM overlays (filter chevrons) in sync with canvas scroll/resize/freeze.
  grid.onRender(() => {
    renderVersion.value++
  })
}
function _pinGridWrapScroll() {
  const wrap = gridWrapRef.value
  if (!wrap) return
  if (wrap.scrollTop) wrap.scrollTop = 0
  if (wrap.scrollLeft) wrap.scrollLeft = 0
}
function _setupEventListeners() {
  canvasRef.value.addEventListener('contextmenu', _onCanvasContextMenu)
  // computeSelectionStats fires from the grid's onSelect callback on every
  // selection change (moveSel + extendSel both emit it). The redundant
  // mouseup/keyup listeners that used to live here doubled the per-event
  // cost — each keypress walked the cell scan twice. Drop them.
  ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    grid.resize(width, height)
  })
  ro.observe(gridWrapRef.value)
  // Safety net: the grid-wrap must never scroll natively — all scrolling flows
  // through the canvas + custom scrollbars, so its scrollTop/Left are meant to
  // stay 0. An overlay taller/wider than the viewport can still give it
  // scrollable overflow, and a stray focus/scrollIntoView then scrolls it,
  // dragging the canvas off-position. Pin it back the instant that happens.
  gridWrapRef.value.addEventListener('scroll', _pinGridWrapScroll, {
    passive: true,
  })
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('paste', onDocPaste)
  document.addEventListener('copy', onDocCopy)
  document.addEventListener('cut', onDocCut)
  document.addEventListener('mousedown', _onDocMouseDown)
  // Re-arm the grid for paste when the user switches back to this window
  // (copied from another app) or back to this tab, so Cmd+V works without a
  // priming click. 'focus' covers app/window switches; 'visibilitychange'
  // covers tab switches within the same window.
  window.addEventListener('focus', _refocusGridIfIdle)
  document.addEventListener('visibilitychange', _refocusGridIfIdle)
  // Reload / tab close never unmount the editor, so onBeforeUnmount's save
  // doesn't run for them. These two cover the page going away.
  window.addEventListener('beforeunload', _onBeforeUnload)
  document.addEventListener('visibilitychange', _saveWhenHidden)
}
// The tab each viewer had open, per document, kept in this browser only: a
// convenience, so it never makes a save. Storage can be unavailable
// (private windows, blocked site data), so every access is guarded.
const _lastTabKey = () => `sheets:last-tab:${props.id}`
function _lastTab() {
  try {
    return localStorage.getItem(_lastTabKey())
  } catch {
    return null
  }
}
// Off until the load has reopened the saved tab, which loading could
// otherwise overwrite with the first sheet.
let _rememberTab = false
watch(currentSheet, (sn) => {
  if (!_rememberTab) return
  try {
    localStorage.setItem(_lastTabKey(), sn)
  } catch {
    // not remembered; the first tab opens next time
  }
})

async function _loadInitialData() {
  history.init()
  syncFlags()
  if (props.id && props.id !== 'new') {
    await loadSheet(props.id)
    if (props.embedded && props.title != null) currentTitle.value = props.title
    // sheet.restore() now fires onCellsChanged → _repopulateGrid() as a
    // single bulk pass, so the explicit call here was duplicating work
    // (parseCellId + grid.setCell × every cell, on top of the per-cell
    // notification cascade we already paid). The view-state catch-up below
    // doesn't depend on the canvas being painted, so it's safe to skip.
    const restored = grid.viewSnapshot?.()
    if (restored) {
      freezeRows.value = restored.freezeRows || 0
      freezeCols.value = restored.freezeCols || 0
      // Legacy docs (saved before filter hides were split out of the view)
      // baked the active sheet's filter rows into hiddenRows. Strip the
      // sheet's current filter rows so they aren't mistaken for manual hides
      // and re-applied to every sheet. Harmless for clean docs.
      const filterHidden = new Set(sortFilter.computeHiddenRows(currentSheet.value))
      manualHiddenRows.clear()
      for (const r of restored.hiddenRows || []) if (!filterHidden.has(r)) manualHiddenRows.add(r)
      manualHiddenCols.clear()
      for (const c of restored.hiddenCols || []) manualHiddenCols.add(c)
    }
    // The view now holds manual hides only; re-apply the active sheet's filter
    // so a saved filter still shows its hidden rows on first load.
    _applyHiddenRows()
    syncNames()
    // Reopen the tab this browser had open last (a converted develop sheet:
    // the one that editor had open).
    const last = _lastTab() ?? legacyUpgrade.value?.current
    if (last && last !== currentSheet.value && sheetNames.value.includes(last)) switchSheet(last)
    _rememberTab = true
    activeCell.value = 'A1'
    _showInputInFormulaBar('A1')
    refreshActiveFormat()
    _syncNumberFormat('A1')
    // Re-baseline history to the loaded state. The pre-load init() above
    // seeded an EMPTY snapshot; a plain init() here is a no-op (stack already
    // seeded), which would leave the empty snapshot as the undo baseline and
    // blank the sheet on the first snapshot-based undo (e.g. insert column).
    history.reset()
    syncFlags()
    // A develop sheet converted on open is saved in the IronCalc format.
    if (legacyUpgrade.value?.save && !readOnly.value) isDirty.value = true
  } else {
    // A new sheet starts as an empty workbook.
    await _startEngine()
    history.reset() // the baseline holds the engine's bytes, which init() could not
    syncFlags()
    _rememberTab = true
    if (props.id === 'new') {
      // Google-Sheets model: create the doc immediately so there is never an
      // "unsaved" state.  The parent swaps the URL to ?id=<name> via onSaved.
      const name = await autoCreate(currentTitle.value || 'Untitled Sheet')
      if (name) emit('saved', name)
    }
  }
}

// Drives the canvas loading overlay (sn-canvas-loading). True until
// _loadInitialData has either populated the engines from get_sheet or
// surfaced a load error — flipped in a finally so a thrown exception
// never strands the editor with a permanent spinner.
const isInitialLoad = ref(true)
// The develop-sheet upgrade banner, closed by its ×.
const upgradeBannerClosed = ref(false)
onMounted(async () => {
  _setupGridInstance()
  _setupEventListeners()
  try {
    await _loadInitialData()
  } finally {
    isInitialLoad.value = false
  }
  // Focus the grid on open so arrow-key nav and Cmd+V work immediately, without
  // a priming click. Idle-guarded so a load that opened a dialog keeps its focus.
  _refocusGridIfIdle()
})
onBeforeUnmount(() => {
  clearTimeout(_autoSaveTimer)
  // CRITICAL: flush any pending debounced save before the component dies.
  // Without this, navigating away within ~2s of an edit (the autosave
  // debounce window) silently drops the most recent changes — exactly the
  // "data is lost when I come back" report. Unmount only happens on in-app
  // navigation, where the page lives on and the request completes, so no
  // `keepalive`: it would cap the body at 64 KB and skip the retries.
  const lastSave =
    isDirty.value && !readOnly.value && props.id && props.id !== 'new'
      ? saveExisting(props.id, currentTitle.value).catch(() => {})
      : null
  // That save reads the workbook from the worker, so stop it only after.
  if (lastSave) void lastSave.finally(_stopEngine)
  else _stopEngine()
  gridWrapRef.value?.removeEventListener('scroll', _pinGridWrapScroll)
  ro?.disconnect()
  grid?.destroy()
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('paste', onDocPaste)
  document.removeEventListener('copy', onDocCopy)
  document.removeEventListener('cut', onDocCut)
  document.removeEventListener('mousedown', _onDocMouseDown)
  window.removeEventListener('focus', _refocusGridIfIdle)
  document.removeEventListener('visibilitychange', _refocusGridIfIdle)
  window.removeEventListener('beforeunload', _onBeforeUnload)
  document.removeEventListener('visibilitychange', _saveWhenHidden)
})

// ── Save ──────────────────────────────────────────────────────────────────────

let _autoSaveTimer = null
let _savePromise = null
let _pendingSaveBatch = null
function hasUnsavedChanges() {
  return isDirty.value || isSaving.value
}
// The IronCalc worker died. The cells lived in it, so nothing more can be
// saved: drop the pending save and show the crash screen, whose Reload
// opens the last saved copy (at most one autosave's worth of edits behind).
function _onEngineCrash(reason) {
  console.error('[sheets] IronCalc worker crashed:', reason)
  clearTimeout(_autoSaveTimer)
  isDirty.value = false
  loadError.value = { kind: 'crashed', message: reason }
}
function reloadPage() {
  window.location.reload()
}
const confirmUnsavedNavigation = () => {
  // Embedded, the surface's leave guard flushes and keeps a recovery copy.
  if (props.embedded) return true
  if (!hasUnsavedChanges() || readOnly.value) return true
  return confirmLeave()
}
// Reload / tab close with unsaved edits: start the save now and ask the
// browser to confirm leaving. A save can't be finished during unload (it reads
// the workbook from the worker first), so staying gives it time to land and
// leaving is the user's informed choice.
function _onBeforeUnload(e) {
  if (!hasUnsavedChanges() || readOnly.value) return
  _flushSoon()
  e.preventDefault()
  e.returnValue = '' // older browsers need it set to show the prompt
}
// Tab hidden (switch, minimise, phone backgrounded; also the start of a
// close): save now instead of waiting out the autosave debounce. On phones
// this is the last event that reliably fires before the page is killed.
function _saveWhenHidden() {
  if (document.visibilityState === 'hidden' && isDirty.value) _flushSoon()
}
// Not for a doc that has no id yet: _doAutoSave skips it without clearing
// isDirty, so flushSave would loop forever.
function _flushSoon() {
  if (readOnly.value || !props.id || props.id === 'new') return
  void flushSave().catch(() => {})
}
onBeforeRouteLeave(confirmUnsavedNavigation)
onBeforeRouteUpdate((to, from) => {
  if (to.params.id === from.params.id) return true
  return confirmUnsavedNavigation()
})

// Operation queue — populated by _queueOp() at write sites (paste, fill,
// import, cell edit, etc.).  Flushed after each successful save so each
// op is hard-linked to the Version row it produced.  See versions.py
// record_op + list_versions for the consumer side.
const _opQueue = []
function _queueOp({
  opType,
  cellRefs = null,
  before = null,
  after = null,
  summary = '',
  subSheet = '',
}) {
  if (props.id === 'new') return // pre-save doc has no version yet
  _opQueue.push({
    opType,
    cellRefs,
    before,
    after,
    summary,
    subSheet,
  })
}

// Snapshot {id → format} for the rect. Used by paste/fill ops so undo
// can revert the format changes too — without this the value-only op
// shape would leave pasted formats stuck on undo, contradicting the
// old snapshot-based history's full revert.
function _captureFormatsRange(rect, sheetName) {
  const out = {}
  if (!rect) return out
  const sn = sheetName || currentSheet.value
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const id = cellId(r, c)
      out[id] = formats.getCellFormat(id, sn) || null
    }
  }
  return out
}

// Record a cell-level format change to `ids` as an op DIFF instead of a full
// history.push() snapshot (the snapshot deep-clones every cell — ~2s on a
// 2M-cell sheet, ×50 in the undo stack). Captures cell-LEVEL formats so undo
// restores the cell layer without baking column/row formats into cells.
// Used by handlers that must touch cells directly (number formats bake the
// display string per cell). `mutate` runs between the before/after captures.
function _recordFormatOp(ids, sn, mutate) {
  const beforeFormats = {}
  for (const id of ids) beforeFormats[id] = formats.getCellFormat(id, sn) || null
  mutate()
  const afterFormats = {}
  for (const id of ids) afterFormats[id] = formats.getCellFormat(id, sn) || null
  history.pushOp({
    opType: 'format',
    subSheet: sn,
    beforeFormats,
    afterFormats,
  })
}

// Scope-aware variant for VISUAL formats (font, size, painted format) that the
// renderer resolves live via the column<row<cell cascade. Full-column /
// full-row selections write one layer entry instead of per-cell records, so
// "set font on the whole sheet" stays tiny and instant. `ops` supplies the
// three mutation variants: { cols, rows, cells }.
function _recordScopedFormatOp(ops) {
  const sn = currentSheet.value
  const info = _selectionScope()
  const scope = info
    ? formatScope(info.rect, info.totalRows, info.totalCols)
    : {
        kind: 'cells',
      }
  const op = {
    opType: 'format',
    subSheet: sn,
  }
  if (scope.kind === 'cols') {
    op.beforeCols = _captureAxis('col', scope.cols, sn)
    ops.cols(scope.cols, sn)
    op.afterCols = _captureAxis('col', scope.cols, sn)
  } else if (scope.kind === 'rows') {
    op.beforeRows = _captureAxis('row', scope.rows, sn)
    ops.rows(scope.rows, sn)
    op.afterRows = _captureAxis('row', scope.rows, sn)
  } else {
    const ids = selectionIds()
    op.beforeFormats = {}
    for (const id of ids) op.beforeFormats[id] = formats.getCellFormat(id, sn) || null
    ops.cells(ids, sn)
    op.afterFormats = {}
    for (const id of ids) op.afterFormats[id] = formats.getCellFormat(id, sn) || null
  }
  history.pushOp(op)
}
function _captureAxis(axis, keys, sn) {
  const get = axis === 'col' ? formats.getCol : formats.getRow
  const out = {}
  for (const k of keys) out[k] = get(k, sn) || null
  return out
}
function _captureValidationRange(rect, sheetName) {
  const out = {}
  if (!rect) return out
  const sn = sheetName || currentSheet.value
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const id = cellId(r, c)
      out[id] = validation.get(id, sn) || null
    }
  }
  return out
}

// Every cell a paste can touch — used so the paste's before/after capture
// (and thus undo) covers all of it:
//   1. the destination selection (tiled pastes fill exactly this),
//   2. the paste's output rect — anchor + buffer dimensions — so a single-cell
//      selection still records the whole pasted block, and
//   3. for a cut, the source range the paste vacates; its cells are cleared,
//      and any outside the destination would otherwise be lost on undo.
// Returns an array of rects; callers merge per-cell captures across them.
// Must be called BEFORE clipboard.paste(), which consumes the cut buffer.
// A cut from another sheet is covered by _cutSourceElsewhere instead.
function _pasteAffectedRects(destSel) {
  const rects = destSel ? [destSel] : []
  const src = clipboard.getSourceSel()
  if (src) {
    const anch = parseCellId(activeCell.value)
    if (anch)
      rects.push({
        r0: anch.row,
        c0: anch.col,
        r1: anch.row + (src.r1 - src.r0),
        c1: anch.col + (src.c1 - src.c0),
      })
    if (clipboard.getMode() === 'cut' && clipboard.getSourceSheet() === currentSheet.value)
      rects.push(src)
  }
  return rects
}

// A cut pasted onto another sheet clears its source on the sheet it came
// from, so undo needs that sheet's cells too. Call before clipboard.paste().
function _cutSourceElsewhere(sn) {
  const sheetName = clipboard.getSourceSheet()
  if (clipboard.getMode() !== 'cut' || !sheetName || sheetName === sn) return null
  return { sheet: sheetName, rect: clipboard.getSourceSel() }
}

// ── Protection ────────────────────────────────────────────────────────────────
// Write guards and the protect/unprotect actions (see useProtection.js).
const {
  protectionNotice,
  flashProtected: _flashProtected,
  rectBlocked: _rectBlocked,
  cellBlocked: _cellBlocked,
  cellsBlocked: _cellsBlocked,
  cellSilentlyProtected: _cellSilentlyProtected,
  fillDestBlocked: _fillDestBlocked,
  protectSelection,
  unprotectSelection,
  toggleSheetProtection,
  selectionHasProtectedRange,
  tabMenuSheetLocked,
} = useProtection({
  protection,
  currentSheet,
  contextMenu,
  tabMenu,
  history,
  getGrid: () => grid,
  markDirty: () => {
    isDirty.value = true
  },
})

// Diff two id→value maps, returning the ids whose value changed.  Used to
// trim noisy before/after pairs down to the cells that actually moved.
function _diffRefs(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...ids].filter((id) => before?.[id] !== after?.[id])
}

// Per-op cap on the serialized before/after JSON. Anything larger drops
// the heavy fields and falls back to a lightweight summary — the new state
// still lives in sheets_data, and the prior state can be reconstructed from
// the preceding snapshot, so we lose nothing audit-wise. Without this, a
// large CSV import builds a 20+ MB op that blows past nginx's body cap and
// the server returns an HTML 413 instead of JSON.
const _MAX_OP_PAYLOAD_BYTES = 64 * 1024

// Snapshot the queue without removing entries. They are removed only after the
// save succeeds, so a failed save can retry without losing operation history.
function _opsForSave() {
  if (!_opQueue.length || props.id === 'new')
    return {
      ops: [],
      count: 0,
    }
  const batch = _opQueue.slice()
  return {
    ops: batch.map(_serialiseOp),
    count: batch.length,
  }
}
function _serialiseOp(op) {
  const cellRefsJson = op.cellRefs ? JSON.stringify(op.cellRefs) : undefined
  const beforeJson = op.before ? JSON.stringify(op.before) : undefined
  const afterJson = op.after ? JSON.stringify(op.after) : undefined
  const heavy = (beforeJson?.length || 0) + (afterJson?.length || 0)
  const truncated = heavy > _MAX_OP_PAYLOAD_BYTES
  return {
    op_type: op.opType,
    sub_sheet: op.subSheet || undefined,
    cell_refs: cellRefsJson,
    before: truncated ? undefined : beforeJson,
    after: truncated ? undefined : afterJson,
    summary: truncated ? _truncatedSummary(op) : op.summary || undefined,
  }
}
function _truncatedSummary(op) {
  const base = op.summary || op.opType || 'bulk edit'
  const count = Array.isArray(op.cellRefs) ? op.cellRefs.length : 0
  return count ? `${base} (${count} cells, details truncated)` : base
}
function _triggerAutoSave() {
  clearTimeout(_autoSaveTimer)
  _autoSaveTimer = setTimeout(_doAutoSave, 2000)
}
async function _doAutoSave() {
  if (_savePromise) await _savePromise.catch(() => {})
  if (!isDirty.value) return
  // Backstop: a viewer should never reach save_sheet (which would throw
  // PermissionError). The input layer already blocks their edits, so isDirty
  // stays false — but guard here too in case a mutation path is ever missed.
  if (readOnly.value) return
  // Bootstrap is handled by _loadInitialData's autoCreate(); calling
  // saveExisting('new') would explode with "Sheet new not found". If the
  // bootstrap save failed for any reason, leave it to a subsequent reload
  // rather than spamming the server on every typed character.
  if (props.id === 'new') return
  isDirty.value = false
  const epoch = _accessEpoch
  // Drain queued ops BEFORE the save so the batch lands atomically with the
  // implicit `save` op and keeps the canonical user-action ordering intact.
  const batch = _pendingSaveBatch || {
    ..._opsForSave(),
    revision: _dirtyRevision,
  }
  _pendingSaveBatch = batch
  _savePromise = _pendingSaveBatch.failed
    ? retrySave()
    : saveExisting(props.id, currentTitle.value, {
        ops: batch.ops,
      })
  try {
    await _savePromise
  } catch (error) {
    batch.failed = true
    if (epoch === _accessEpoch) isDirty.value = true
    throw error
  } finally {
    _savePromise = null
  }
  // Access narrowed while this save was out. Its edits left the save path.
  if (epoch !== _accessEpoch) {
    saveError.value = ''
    return
  }
  if (saveError.value) {
    batch.failed = true
    isDirty.value = true
    return
  }
  _opQueue.splice(0, batch.count)
  _pendingSaveBatch = null
  isDirty.value = _dirtyRevision > batch.revision
  justSaved.value = true
  setTimeout(() => {
    justSaved.value = false
  }, 2500)
}
async function flushSave() {
  clearTimeout(_autoSaveTimer)
  do {
    await _doAutoSave()
  } while (isDirty.value && !saveError.value)
}

// Manual retry handler — bound to the refresh button next to the
// save-error chip. Routes through _doAutoSave (rather than calling
// retrySave directly) so freshly-queued ops since the last failure
// also ride along, and so the dirty/justSaved flags are managed in
// one place. If somehow the user clicked retry from a sheet that
// isn't dirty (rare race), still try once via retrySave.
async function onRetrySave() {
  if (isSaving.value || readOnly.value) return
  if (isDirty.value && props.id && props.id !== 'new') {
    await _doAutoSave()
  } else {
    await retrySave().catch(() => {})
  }
}

// Watchdog: when a save has failed but we still have unsaved work,
// nudge another attempt after 30 s without waiting for the user to
// type something else. Catches the "user stepped away during a flaky
// network blip and came back to find their last change lost" case.
let _saveWatchdogTimer = null
watch(saveError, (msg) => {
  clearTimeout(_saveWatchdogTimer)
  if (!msg) return
  _saveWatchdogTimer = setTimeout(() => {
    if (saveError.value && isDirty.value && !isSaving.value && props.id && props.id !== 'new') {
      void _doAutoSave().catch(() => {})
    }
  }, 30_000)
})

// Watch for any dirty change → schedule auto-save
watch(isDirty, (dirty) => {
  if (dirty) _triggerAutoSave()
})

// Title focus/blur — mark `isDirty` when the value changed during the focus
// session so `_doAutoSave` doesn't bail on its `!isDirty` guard. Without
// this, a rename-then-save flow (no cell edit in between) silently dropped
// the new title because `flushSave` exited early. Snapshotting on focus avoids spurious saves
// when the user just clicks into and out of the field without typing.
let _titleAtFocus = ''
function startTitleEditing() {
  _titleAtFocus = currentTitle.value
  isTitleEditing.value = true
}
function finishTitleEditing() {
  if (!isTitleEditing.value) return
  if (currentTitle.value !== _titleAtFocus) isDirty.value = true
  isTitleEditing.value = false
  _triggerAutoSave()
}
function cancelTitleEditing() {
  currentTitle.value = _titleAtFocus
  isTitleEditing.value = false
}
function onSave() {
  void _doAutoSave().catch(() => {})
}

// ── Formula bar ───────────────────────────────────────────────────────────────

function onFormulaInput(e) {
  formulaValue.value = e.target.value
  _typedCell = {
    sheet: currentSheet.value,
    cell: activeCell.value,
  }
  updateAc(e.target.value, e.target.selectionStart)
}
function onFormulaKey(e) {
  if (acVisible.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      acIdx.value = Math.min(acIdx.value + 1, acItems.value.length - 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      acIdx.value = Math.max(acIdx.value - 1, 0)
      return
    }
    if ((e.key === 'Tab' || e.key === 'Enter') && acItems.value[acIdx.value]) {
      e.preventDefault()
      commitAc(acItems.value[acIdx.value])
      return
    } // item obj
    if (e.key === 'Escape') {
      acItems.value = []
      return
    }
  }
  // Auto-close parens in the formula bar, mirroring the in-cell editor.
  const ac = autoCloseKey(e.key, e.target.value, e.target.selectionStart, e.target.selectionEnd)
  if (ac) {
    e.preventDefault()
    const el = e.target
    formulaValue.value = ac.value
    updateAc(ac.value, ac.caret)
    nextTick(() => el.setSelectionRange(ac.caret, ac.caret))
    return
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    _commitFormulaBar()
    canvasRef.value?.focus()
  }
  if (e.key === 'Escape') {
    _cancelFormulaBar()
    canvasRef.value?.focus()
  }
}

// Write the in-progress formula back to the cell it was started on, even if
// the user wandered off to another sheet to pick a range. If there's no
// cross-sheet edit, this collapses to the legacy "write to activeCell" path.
function _commitFormulaBar() {
  const homeSheet = editingHomeSheet.value
  const homeCell = editingHomeCell.value
  const targetSheet = homeSheet || currentSheet.value
  const targetId = homeCell || activeCell.value
  // Protected target — discard the edit and restore the bar to the cell value.
  if (_cellBlocked(targetId, targetSheet)) {
    editingHomeSheet.value = null
    editingHomeCell.value = null
    _typedCell = null
    _showInputInFormulaBar(targetId, targetSheet)
    return
  }
  const value = formulaValue.value
  const before = _inputAt(targetId, targetSheet) ?? ''
  if (homeSheet && homeSheet !== currentSheet.value) {
    switchSheet(homeSheet, {
      preserveEdit: true,
    })
  }
  _writeInputs(targetSheet, { [targetId]: value })
  editingHomeSheet.value = null
  editingHomeCell.value = null
  _typedCell = null
  if (before !== value) {
    const op = {
      opType: 'edit',
      subSheet: targetSheet,
      cellRefs: [targetId],
      before: { [targetId]: before },
      after: { [targetId]: value },
      summary: 'Edit cell',
    }
    // The row refits to the edit, as a commit in the cell does.
    const rowH = _refitRowsFor(targetSheet, { [targetId]: value })
    if (rowH) {
      op.beforeRowH = rowH.before
      op.afterRowH = rowH.after
    }
    _queueOp(op)
    history.pushOp(op)
    broadcastCellChange(targetSheet, targetId, value)
    syncFlags()
    isDirty.value = true
  }
  _maybeAutoLink(
    [
      {
        id: targetId,
        value,
        before,
      },
    ],
    targetSheet,
  )
}
function _cancelFormulaBar() {
  const homeSheet = editingHomeSheet.value
  const homeCell = editingHomeCell.value
  if (homeSheet && homeSheet !== currentSheet.value) {
    // Return to the home sheet *without* preserveEdit so activeCell snaps
    // back to where the user started and formulaValue reflects the cell's
    // committed contents (i.e. the edit is discarded cleanly).
    switchSheet(homeSheet)
    activeCell.value = homeCell
    _showInputInFormulaBar(homeCell, homeSheet)
  } else {
    _showInputInFormulaBar(activeCell.value)
  }
  editingHomeSheet.value = null
  editingHomeCell.value = null
  _typedCell = null
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

// ── Fill ──────────────────────────────────────────────────────────────────────
// The drag fill handle and Ctrl+D / Ctrl+R (see useFill.js).
const {
  fillFromHandle: _fillFromHandle,
  fillDown,
  fillRight,
} = useFill({
  getGrid: () => grid,
  currentSheet,
  formats,
  merge,
  validation,
  condFormat,
  history,
  isDirty,
  syncFlags,
  markEdited,
  readInputs: _readInputs,
  writeInputs: _writeInputs,
  captureFormatsRange: _captureFormatsRange,
  captureValidationRange: _captureValidationRange,
  diffRefs: _diffRefs,
  queueOp: _queueOp,
  rectBlocked: _rectBlocked,
  refitRowsFor: _refitRowsFor,
  readEngineFormats: _readEngineFormats,
})

// Mirrors `clipboard.hasData()` reactively so the context menu can show /
// hide its Paste-Special entries without polling.
const clipboardHas = ref(false)

// Keyboard-driven insert/delete of rows or columns (Ctrl+Alt+= / Ctrl+Alt+-).
// The context-menu handlers key off contextMenu.target{Row,Col}, which only a
// right-click normally populates — so seed it from the live selection first. A
// whole-column selection acts on columns; anything else acts on rows (matching
// Google Sheets). The delete/insert span (N selected lines) flows from the
// selection the same way the right-click menu computes it.
function _insertRowsColsFromSelection() {
  if (readOnly.value) return
  const s = grid?.getSelection?.()
  if (!s) return
  if (s.mode === 'col') {
    contextMenu.targetCol = s.c0
    doInsertCol(false, s.c1 - s.c0 + 1)
  } else {
    contextMenu.targetRow = s.r0
    doInsertRow(false, s.r1 - s.r0 + 1)
  }
}
function _deleteRowsColsFromSelection() {
  if (readOnly.value) return
  const s = grid?.getSelection?.()
  if (!s) return
  if (s.mode === 'col') {
    contextMenu.targetCol = s.c0
    doDeleteCol()
  } else {
    contextMenu.targetRow = s.r0
    doDeleteRow()
  }
}
const { onGlobalKey } = useShortcuts({
  formulaInputEl: () => formulaInputRef.value,
  undo,
  redo,
  onSave,
  toggleFmt,
  repeatLast,
  toggleShowFormulas,
  showFindReplace,
  openFindReplace,
  openHyperlinkDialog,
  openCommentPanel,
  openQuickFilterForActive,
  zoomBy,
  resetZoom,
  commentPanel,
  dropdownPanel,
  splitText,
  revertSplitPreview: _revertSplitPreview,
  closeSplit: _closeSplit,
  clipboard,
  clipboardHas,
  setMarchingAnts: (v) => grid?.setMarchingAnts(v),
  fillDown,
  fillRight,
  runSmartFill,
  insertRowsCols: _insertRowsColsFromSelection,
  deleteRowsCols: _deleteRowsColsFromSelection,
  applyNumberFormat: onNumberFormatChange,
  pasteValues: () => doPasteSpecial('values'),
  readOnly: () => readOnly.value,
})

// ── Clipboard ─────────────────────────────────────────────────────────────────
// Copy / cut / paste listeners and Paste special (see useClipboard.js).
const {
  refocusGridIfIdle: _refocusGridIfIdle,
  onDocCopy,
  onDocCut,
  onDocPaste,
  doPasteSpecial,
} = useClipboard({
  clipboard,
  getGrid: () => grid,
  canvasRef,
  formulaInputRef,
  gridWrapRef,
  readOnly,
  currentSheet,
  activeCell,
  clipboardHas,
  contextMenu,
  condFormat,
  history,
  isDirty,
  syncFlags,
  rectBlocked: _rectBlocked,
  flashProtected: _flashProtected,
  showInput: _showInputInFormulaBar,
  readInputs: _readInputs,
  queueOp: _queueOp,
  pasteAffectedRects: _pasteAffectedRects,
  cutSourceElsewhere: _cutSourceElsewhere,
  captureFormatsRange: _captureFormatsRange,
  captureValidationRange: _captureValidationRange,
  diffRefs: _diffRefs,
  refitRowsFor: _refitRowsFor,
})

// ── History ───────────────────────────────────────────────────────────────────

// Re-mirror the canvas view state into the Vue refs that drive context-menu
// predicates (freezeRows > 0, manualHiddenRows.size > 0, ...). Called every
// time a snapshot lands — load, undo, redo — so the UI catches up with the
// grid's restored state.
function _syncViewMirrors() {
  const v = grid?.viewSnapshot?.()
  if (!v) return
  freezeRows.value = v.freezeRows || 0
  freezeCols.value = v.freezeCols || 0
  manualHiddenRows.clear()
  for (const r of v.hiddenRows || []) manualHiddenRows.add(r)
  manualHiddenCols.clear()
  for (const c of v.hiddenCols || []) manualHiddenCols.add(c)
}
function _afterHistoryNavigate() {
  _repopulateGrid()
  _applyHiddenRows() // filter state restored → re-apply to grid
  _syncViewMirrors()
  syncNames()
  // The comment panel holds a reference into the (now-replaced) engine thread —
  // close it so a stale index can't delete the wrong reply after undo/redo.
  commentPanel.open = false
  activeCell.value = 'A1'
  _showInputInFormulaBar('A1')
  refreshActiveFormat()
  _syncNumberFormat('A1')
  syncFlags()
  grid?.setMarchingAnts(null)
  clipboard.clear()
  clipboardHas.value = false
  // An undo or redo changes the document like any edit, so it is saved.
  isDirty.value = true
}

// ── Number format ─────────────────────────────────────────────────────────────

function _syncNumberFormat(id) {
  const fmt = formats.get(id, currentSheet.value)
  activeNumberFormat.value = fmt.numberFormat || ''
}
function toggleNumberFmt(type) {
  onNumberFormatChange(activeNumberFormatType.value === type ? '' : type)
}

// ── Format painter ────────────────────────────────────────────────────────────

let _copiedFormat = null
function toggleFormatPainter() {
  if (isPaintingFormat.value) {
    isPaintingFormat.value = false
    _copiedFormat = null
    return
  }
  const srcId = activeCell.value
  _copiedFormat = {
    ...formats.get(srcId, currentSheet.value),
  }
  isPaintingFormat.value = true
}
function _applyPaintedFormat() {
  if (!isPaintingFormat.value || !_copiedFormat) return
  _recordScopedFormatOp(_patchFmtOps(_copiedFormat))
  syncFlags()
  isDirty.value = true
  isPaintingFormat.value = false
  _copiedFormat = null
  refreshActiveFormat()
}
function onNumberFormatChange(value) {
  const sn = currentSheet.value
  const ids = selectionIds()
  _recordFormatOp(ids, sn, () =>
    formats.applyToRange(
      ids,
      {
        numberFormat: value,
      },
      sn,
    ),
  )
  grid?.render?.() // the grid applies number formats as it paints
  _syncNumberFormat(activeCell.value)
  syncFlags()
  isDirty.value = true
}

// ── Comments ──────────────────────────────────────────────────────────────────

function openCommentPanel() {
  if (!grid) return
  const id = activeCell.value
  const p = parseCellId(id)
  const cv = canvasRef.value?.getBoundingClientRect()
  // Cell rect is canvas-local CSS coords (zoom already applied). The panel
  // is position:fixed so we add the canvas's viewport offset. Prefer placing
  // it just to the right of the cell so the cell stays visible while typing;
  // flip left/up if it would overflow the viewport.
  const cell = p && grid.getCellRect ? grid.getCellRect(p.row, p.col) : null
  const PANEL_W = 260,
    PANEL_H = 200,
    GAP = 6
  let x, y
  if (cv && cell) {
    x = cv.left + cell.x + cell.width + GAP
    y = cv.top + cell.y
    if (x + PANEL_W > window.innerWidth) x = cv.left + cell.x - PANEL_W - GAP
    if (x < 4) x = 4
    if (y + PANEL_H > window.innerHeight) y = Math.max(4, window.innerHeight - PANEL_H - 4)
  } else {
    const rect = cv || {
      left: 100,
      top: 100,
    }
    x = rect.left + 60
    y = rect.top + 40
  }
  commentPanel.id = id
  commentPanel.x = x
  commentPanel.y = y
  commentPanel.draft = ''
  _loadCommentThread()
  commentPanel.open = true
}

// Mirror the engine's thread for `commentPanel.id` into the reactive panel.
function _loadCommentThread() {
  const t = comments.getThread(commentPanel.id, currentSheet.value)
  commentPanel.thread = t ? t.thread : []
  commentPanel.resolved = t ? t.resolved : false
}

// Shared post-mutation: repaint, record for undo (comments ride the snapshot),
// and flag dirty so autosave persists the change.
function _afterCommentChange() {
  _loadCommentThread()
  notesPanel.rev++
  grid?.render()
  history.push()
  isDirty.value = true
}
function addCommentReply() {
  const text = commentPanel.draft.trim()
  if (!text) return
  comments.addReply(
    commentPanel.id,
    {
      author: userEmail.value,
      name: userFullName.value || userEmail.value,
      text,
    },
    currentSheet.value,
  )
  commentPanel.draft = ''
  _afterCommentChange()
}
function toggleResolveComment() {
  comments.resolve(commentPanel.id, !commentPanel.resolved, currentSheet.value)
  _afterCommentChange()
}
function deleteCommentReply(i) {
  comments.removeReply(commentPanel.id, i, currentSheet.value)
  _afterCommentChange()
  if (!commentPanel.thread.length) commentPanel.open = false
}
function deleteComment() {
  comments.clear(commentPanel.id, currentSheet.value)
  commentPanel.open = false
  notesPanel.rev++
  grid?.render()
  history.push()
  isDirty.value = true
}

// "5m ago" style relative time for a reply's epoch-ms timestamp.
function commentTime(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

// ── Notes side panel ──────────────────────────────────────────────────────────
// The cross-sheet note list and its panel (see useNotesPanel.js).
const { notesPanel, allNotes, notesGrouped, toggleNotesPanel, jumpToNote } = useNotesPanel({
  comments,
  sheetNames,
  currentSheet,
  activeCell,
  getGrid: () => grid,
  switchSheet: (n) => switchSheet(n),
  openCommentPanel: () => openCommentPanel(),
  onOpened: () => emit('notes-opened'),
})

// The /d/ surface's handle on the editor: where the cursor is, how to reach
// a commented cell, and the save state its leave guard and restore act on.
function goToCell(sheetName, id) {
  if (!grid || !sheetNames.value.includes(sheetName)) return false
  const p = parseCellId(id)
  if (!p) return false
  if (sheetName !== currentSheet.value) switchSheet(sheetName)
  nextTick(() => {
    grid.moveTo(p.row, p.col)
    activeCell.value = id
  })
  return true
}

// The text in the formula bar or the cell editor that is not committed yet.
// Both mirror into `formulaValue`. A cross-sheet formula edit writes back to
// its home cell; any other edit to the cell it was typed for.
function _draftEdit() {
  const target = editingHomeCell.value
    ? {
        sheet: editingHomeSheet.value,
        cell: editingHomeCell.value,
      }
    : _typedCell
  if (!target) return null
  const committed = _inputAt(target.cell, target.sheet) ?? ''
  if (String(committed ?? '') === String(formulaValue.value ?? '')) return null
  return {
    ...target,
    value: formulaValue.value,
  }
}
defineExpose({
  activeCell,
  currentSheet,
  saveState,
  flushSave,
  // The workbook for a recovery copy, with the cell edit still in progress.
  workbookJson: () => workbookJson(_draftEdit()),
  hasDraft: () => _draftEdit() !== null,
  goToCell,
  closeNotes: () => {
    notesPanel.open = false
  },
})
function addNoteFromPanel() {
  // Convenience: same as topbar note button, but invoked from inside the panel.
  openCommentPanel()
}

// Runs a context-menu item's action after closing the menu.
function fromContextMenu(action) {
  contextMenu.open = false
  action()
}

// ── Data validation ───────────────────────────────────────────────────────────
// The rule form is ValidationDialog.vue; it hands back a rule, and this
// applies it to the selection.

const validationDialogRef = ref(null)
function openValidationDialog() {
  validationDialogRef.value?.open(validation.get(activeCell.value, currentSheet.value))
}
async function _applyValidation(rule) {
  const ids = selectionIds()
  const sn = currentSheet.value
  if (rule.type !== 'checkbox') {
    for (const id of ids) validation.set(id, rule, sn)
    grid?.render()
    history.push()
    isDirty.value = true
    return
  }
  // Checkbox cells need a concrete value to render as unchecked and to feed
  // formulas (SUM / COUNTIF) right away — fill blanks with FALSE, à la Sheets.
  // The rule and these values are one op, so one undo reverts both.
  const inputs = await _readIds(ids, sn)
  const beforeValidation = {}
  const afterValidation = {}
  for (const id of ids) {
    beforeValidation[id] = validation.get(id, sn) || null
    validation.set(id, rule, sn)
    afterValidation[id] = rule
  }
  const blanks = ids.filter((id) => (inputs[id] ?? '') === '')
  const before = Object.fromEntries(blanks.map((id) => [id, '']))
  const after = Object.fromEntries(blanks.map((id) => [id, 'FALSE']))
  if (blanks.length) _writeInputs(sn, after)
  const op = {
    opType: 'edit',
    subSheet: sn,
    cellRefs: blanks,
    before,
    after,
    beforeValidation,
    afterValidation,
    summary: 'Insert checkboxes',
  }
  if (blanks.length) {
    _queueOp(op)
    broadcastBatchChange(
      sn,
      blanks.map((id) => ({ id, value: 'FALSE' })),
    )
  }
  history.pushOp(op)
  grid?.render()
  syncFlags()
  isDirty.value = true
}
function removeValidation() {
  const ids = selectionIds()
  const sn = currentSheet.value
  for (const id of ids) validation.clear(id, sn)
  grid?.render()
  history.push()
  isDirty.value = true
}
function openDropdown(id, rule, pos = {}) {
  if (rule?.type !== 'list') return
  dropdownPanel.id = id
  dropdownPanel.options = rule.options
  dropdownPanel.rule = rule
  dropdownPanel.value = _inputAt(id) ?? ''
  dropdownPanel.x = pos.x ?? 0
  dropdownPanel.y = pos.y ?? 0
  dropdownPanel.w = pos.w ?? 120
  dropdownPanel.open = true
}
async function pickDropdownOption(opt) {
  const id = dropdownPanel.id
  const sn = currentSheet.value
  dropdownPanel.open = false
  if (_cellBlocked(id, sn)) return
  const before = { [id]: await _readInput(id, sn) }
  const after = { [id]: String(opt) }
  _writeInputs(sn, after)
  _pushEditOp(sn, before, after, 'Edit cell')
  recomputePivotsForSheet(sn)
}

// Clicking a checkbox cell's tickbox flips TRUE ↔ FALSE (empty → TRUE). Routed
// through the same edit-op path as a dropdown pick so undo + collab match.
async function toggleCheckbox(id) {
  const sn = currentSheet.value
  const before = { [id]: await _readInput(id, sn) }
  const after = { [id]: before[id].toUpperCase() === 'TRUE' ? 'FALSE' : 'TRUE' }
  _writeInputs(sn, after)
  _pushEditOp(sn, before, after, 'Toggle checkbox')
  recomputePivotsForSheet(sn)
}

// ── Conditional formatting ────────────────────────────────────────────────────
// The dialog is ConditionalFormatDialog.vue; it brackets each rule change
// with before-change / changed so undo gets a step on each side.

const cfDialogRef = ref(null)
function openCfDialog(existingId) {
  cfDialogRef.value?.open(existingId, grid?.getSelection())
}
function _onCfChanged() {
  history.push()
  syncFlags()
  grid?.render()
  isDirty.value = true
}

// ── Cell edit history ─────────────────────────────────────────────────────────

async function openCellHistory() {
  contextMenu.open = false
  if (props.id === 'new') return
  const id = activeCell.value
  cellHistory.cell = id
  cellHistory.open = true
  cellHistory.loading = true
  cellHistory.error = ''
  cellHistory.entries = []
  try {
    cellHistory.entries = await fetchCellHistory(props.id, id, currentSheet.value, {
      context: props.requestContext,
    })
  } catch (err) {
    cellHistory.error = err.message || 'Failed to load cell history'
  } finally {
    cellHistory.loading = false
  }
}

// ── Find & Replace ────────────────────────────────────────────────────────────

// Cells on the open sheet whose input contains `query`, as [{ id, input }].
async function _findCells(query) {
  if (!_client()) return []
  const { cells } = await _client().findCells({ sheet: currentSheet.value, query })
  return cells.map(({ row, col, input }) => ({ id: cellId(row - 1, col - 1), input }))
}
// Replacements as one write and one undo step.
function _replaceCells(before, after) {
  const sn = currentSheet.value
  _writeInputs(sn, after)
  _pushEditOp(sn, before, after, 'Replace')
}
function closeFindReplace() {
  showFindReplace.value = false
  canvasRef.value?.focus?.()
}
function onNavigateTo(id) {
  if (!grid) return
  const p = parseCellId(id)
  if (!p) return
  grid.moveTo(p.row, p.col)
}

// ── Slicers ────────────────────────────────────────────────────────────────
// Floating value-filter controls (see useSlicers.js).
const {
  slicerVersion,
  activeSlicers,
  insertSlicer,
  removeSlicer,
  toggleSlicerValue,
  selectAllSlicer,
  clearSlicerValues,
  changeSlicerColumn,
  startSlicerDrag,
} = useSlicers({
  sortFilter,
  slicers,
  currentSheet,
  activeCell,
  contextMenu,
  history,
  getGrid: () => grid,
  detectContiguousBlock: _detectContiguousBlock,
  repopulateGrid: () => _repopulateGrid(),
  applyHiddenRows: () => _applyHiddenRows(),
  markDirty: () => {
    isDirty.value = true
  },
})

// ── Context menu ──────────────────────────────────────────────────────────────

const showRenameDialog = ref(false)
const renameValue = ref('')
const renameError = ref('')
const renameInputRef = ref(null)
let _renameTarget = ''
function openRenameDialog(name) {
  // Reachable via dbl-click on the tab even when the menu is suppressed — gate
  // here so rename is denied for viewers regardless of entry point.
  if (readOnly.value) return
  tabMenu.open = false
  _renameTarget = name
  renameValue.value = name
  renameError.value = ''
  showRenameDialog.value = true
  // Dialog mounts the input asynchronously — focus + select on the next two
  // ticks so the user can type immediately instead of clicking the field.
  nextTick(() =>
    nextTick(() => {
      const el =
        renameInputRef.value?.$el?.querySelector?.('input') ??
        renameInputRef.value?.input ??
        renameInputRef.value
      if (el?.focus) {
        el.focus()
        el.select?.()
      }
    }),
  )
}
function confirmRename() {
  const oldName = _renameTarget
  const newName = renameValue.value
  const ok = _renameSheet(oldName, newName)
  if (!ok) {
    renameError.value = 'Name is empty or already used.'
    return
  }
  // Keep named-range bindings pointed at the renamed sheet — without this,
  // `=Revenue` defined on "Sheet1" breaks after renaming Sheet1.
  namedRanges.renameSheet(oldName, newName)
  _syncDefinedNames()
  showRenameDialog.value = false
  history.push()
  isDirty.value = true
}
function doDuplicateSheet(name) {
  tabMenu.open = false
  _duplicateSheet(name)
  history.push()
  isDirty.value = true
}
function doDeleteSheet(name) {
  tabMenu.open = false
  if (_deleteSheet(name)) {
    history.push()
    isDirty.value = true
  }
}
function _onDocMouseDown(e) {
  // Close context menus only when clicking OUTSIDE them. Never close on
  // mousedown when clicking a button inside — that would remove the element
  // before its click event fires, making every menu item a no-op.
  const menus = document.querySelectorAll(
    '.sn-ctx-menu, .sn-comment-panel, .sn-dropdown-panel, .sn-sp-pop',
  )
  let inside = false
  for (const el of menus)
    if (el.contains(e.target)) {
      inside = true
      break
    }
  if (!inside) {
    contextMenu.open = false
    tabMenu.open = false
    dropdownPanel.open = false
    // Split-text outside-click is treated as Cancel — preview is reverted
    // because the user never explicitly committed to the result.
    if (splitText.open) {
      _revertSplitPreview()
      _closeSplit()
    }
  }
}

// ── Row / column insert, delete, move ──────────────────────────────────────
// The op machinery (side-engine remap, undo, redo) is in useHistory.js.

function _afterStructural(sn) {
  _repopulateGrid()
  _applyHiddenRows()
  grid?.render?.()
  recomputePivotsForSheet(sn)
}

function doInsertRow(below = false, count = 1) {
  contextMenu.open = false
  const atRow = contextMenu.targetRow + (below ? 1 : 0)
  _structural(
    'row',
    insertMap(atRow, count),
    { type: 'insertRows', payload: { row: atRow + 1, count } },
    { type: 'deleteRows', payload: { row: atRow + 1, count } },
  )
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
const zoomLevel = ref(1)
function zoomBy(delta) {
  const next = Math.round(((grid?.getZoom() ?? 1) + delta) * 10) / 10
  grid?.setZoom(next)
  zoomLevel.value = grid?.getZoom() ?? 1
}
function resetZoom() {
  grid?.setZoom(1)
  zoomLevel.value = 1
}

// ── Font size / family ────────────────────────────────────────────────────────
function setFontFamily(keyOrStack) {
  // Accept either a short key ('inter', 'mono', …) from the toolbar select or
  // a raw CSS font-family stack (used by F4 replay). Normalize to the stack.
  const stack = FONT_FAMILY_STACK[keyOrStack] || keyOrStack
  _recordScopedFormatOp(
    _patchFmtOps({
      fontFamily: stack,
    }),
  )
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('setFontFamily', [stack])
  isDirty.value = true
}

// Mutation triple ({ cols, rows, cells }) that applies a visual format patch at
// whichever scope the selection implies.
function _patchFmtOps(patch) {
  return {
    cols: (cols, sn) => formats.applyToColumns(cols, patch, sn),
    rows: (rows, sn) => formats.applyToRows(rows, patch, sn),
    cells: (ids, sn) => formats.applyToRange(ids, patch, sn),
  }
}
const _clampFont = (v) => Math.max(8, Math.min(72, v))
function adjustFontSize(delta) {
  _recordScopedFormatOp({
    cols: (cols, sn) => {
      for (const c of cols)
        formats.setCol(
          c,
          {
            fontSize: _clampFont((formats.getCol(c, sn).fontSize || 13) + delta),
          },
          sn,
        )
    },
    rows: (rows, sn) => {
      for (const r of rows)
        formats.setRow(
          r,
          {
            fontSize: _clampFont((formats.getRow(r, sn).fontSize || 13) + delta),
          },
          sn,
        )
    },
    cells: (ids, sn) => {
      for (const id of ids)
        formats.applyToRange(
          [id],
          {
            fontSize: _clampFont((formats.get(id, sn).fontSize || 13) + delta),
          },
          sn,
        )
    },
  })
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('adjustFontSize', [delta])
  isDirty.value = true
}

// Set font size on the selection directly to whatever the user typed. Clamped
// to [8, 72] to match adjustFontSize. Called from the toolbar's font-size
// input on commit (Enter / blur).
function setFontSize(px) {
  const n = _clampFont(parseInt(px, 10) || 13)
  _recordScopedFormatOp(
    _patchFmtOps({
      fontSize: n,
    }),
  )
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('setFontSize', [n])
  isDirty.value = true
}
function onFontSizeInput(e) {
  setFontSize(e.target.value)
  // Snap the displayed value back to the clamped result.
  e.target.value = activeFormat.value.fontSize || 13
  e.target.blur()
}

// ── Hyperlink ─────────────────────────────────────────────────────────────────

// Google-Sheets URL auto-detection: after a typed edit commits, a whole-cell
// URL gets fmt.hyperlink set on it. Recorded as its OWN format op after the
// edit op, so the first Ctrl+Z strips just the link and the second undoes the
// text — matching Google's "undo removes the auto-link" behavior. The inverse
// also runs: editing an auto-linked cell (text === its URL) to a non-URL
// drops the stale link; custom display text set via Ctrl+L keeps it.

// The hyperlink patch a committed edit implies for one cell, or null.
function _autoLinkChange(id, value, before, sn) {
  const url = detectHyperlink(String(value ?? ''))
  const prev = formats.getCellFormat(id, sn).hyperlink || null
  if (url)
    return prev === url
      ? null
      : {
          id,
          url,
        }
  return prev && isAutoLinkText(before, prev)
    ? {
        id,
        url: null,
      }
    : null
}

// cells: [{ id, value, before }] — single-cell commits and Ctrl+Enter batch
// commits share this; a batch records ONE format op so one undo strips all.
function _maybeAutoLink(cells, sn) {
  const changes = cells.map((c) => _autoLinkChange(c.id, c.value, c.before, sn)).filter(Boolean)
  if (!changes.length) return
  _recordFormatOp(
    changes.map((c) => c.id),
    sn,
    () => {
      for (const { id, url } of changes)
        formats.applyToRange(
          [id],
          {
            hyperlink: url,
          },
          sn,
        )
    },
  )
  refreshActiveFormat()
  grid?.render()
  syncFlags()
}
// The form is HyperlinkDialog.vue; it hands back the text and the link, and
// this applies them to the active cell.
const hyperlinkDialogRef = ref(null)
function openHyperlinkDialog() {
  const id = activeCell.value
  const fmt = formats.get(id, currentSheet.value)
  hyperlinkDialogRef.value?.open(_inputAt(id) ?? '', fmt.hyperlink || '')
}
async function confirmHyperlink({ text, url: rawUrl }) {
  const url = (rawUrl || '').trim()
  if (!url) return
  const id = activeCell.value
  const sh = currentSheet.value
  if (_cellBlocked(id, sh)) return
  // The text and the link are one undo step.
  const before = { [id]: await _readInput(id, sh) }
  const after = { [id]: text }
  const fmtOf = () => {
    const f = formats.getCellFormat(id, sh)
    return f ? { ...f } : null
  }
  const beforeFormats = { [id]: fmtOf() }
  if (text !== before[id]) _writeInputs(sh, after)
  formats.applyToRange(
    [id],
    {
      hyperlink: url,
    },
    sh,
  )
  const op = {
    opType: 'edit',
    subSheet: sh,
    cellRefs: [id],
    before,
    after,
    beforeFormats,
    afterFormats: { [id]: fmtOf() },
    summary: 'Insert link',
  }
  _queueOp(op)
  history.pushOp(op)
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  isDirty.value = true
}
function removeHyperlink() {
  const id = activeCell.value
  const sh = currentSheet.value
  formats.applyToRange(
    [id],
    {
      hyperlink: null,
    },
    sh,
  )
  history.push() // post-mutate
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  isDirty.value = true
}

// ── Link hover card ───────────────────────────────────────────────────────────
// The preview card over a linked cell and its actions (see useLinkCard.js).
const {
  linkCard,
  onLinkHover: _onLinkHover,
  onLinkCardEnter,
  onLinkCardLeave,
  openLinkCardUrl,
  editLinkCardCell,
  unlinkLinkCardCell,
  replaceLinkWithTitle,
} = useLinkCard({
  formats,
  currentSheet,
  activeCell,
  formulaValue,
  readOnly,
  gridWrapRef,
  getGrid: () => grid,
  inputAt: _inputAt,
  readInput: _readInput,
  writeInputs: _writeInputs,
  cellBlocked: (id, sn) => _cellBlocked(id, sn),
  cellSilentlyProtected: (id, sn) => _cellSilentlyProtected(id, sn),
  recordFormatOp: (ids, sn, mutate) => _recordFormatOp(ids, sn, mutate),
  pushEditOp: (sn, before, after, summary, extra) => _pushEditOp(sn, before, after, summary, extra),
  refreshActiveFormat: () => refreshActiveFormat(),
  syncFlags: () => syncFlags(),
  markDirty: () => {
    isDirty.value = true
  },
  openHyperlinkDialog: () => openHyperlinkDialog(),
})

function openInsertMany(kind, below = false) {
  contextMenu.open = false
  insertMany.kind = kind
  insertMany.below = below
  insertMany.count = 5
  showInsertManyDialog.value = true
}
function confirmInsertMany() {
  const n = Math.max(1, Math.min(1000, parseInt(insertMany.count, 10) || 1))
  showInsertManyDialog.value = false
  if (insertMany.kind === 'row') doInsertRow(insertMany.below, n)
  else doInsertCol(insertMany.below, n)
}
function doDeleteRow() {
  contextMenu.open = false
  // Same span logic as doDeleteCol: delete the whole selected row block when
  // the right-clicked row falls inside it, else just the targeted row. Only a
  // real row span counts — in 'col'/'all' selections getSelection() reports
  // r1 = last row, which would otherwise delete every row below the target.
  const sel = grid.getSelection()
  const rowSpan = sel && (sel.mode === 'row' || sel.mode === 'cell')
  const within = rowSpan && contextMenu.targetRow >= sel.r0 && contextMenu.targetRow <= sel.r1
  const start = within ? sel.r0 : contextMenu.targetRow
  const count = within ? sel.r1 - sel.r0 + 1 : 1
  _structural('row', deleteMap(start, count), {
    type: 'deleteRows',
    payload: { row: start + 1, count },
  })
}

function doInsertCol(right = false, count = 1) {
  contextMenu.open = false
  const atCol = contextMenu.targetCol + (right ? 1 : 0)
  _structural(
    'col',
    insertMap(atCol, count),
    { type: 'insertColumns', payload: { col: atCol + 1, count } },
    { type: 'deleteColumns', payload: { col: atCol + 1, count } },
  )
}
function doDeleteCol() {
  contextMenu.open = false
  // When the right-clicked column is inside a multi-column selection, delete
  // every selected column; otherwise just the targeted one.
  // Only a real column span counts — in 'row'/'all' selections getSelection()
  // reports c1 = last col, which would otherwise delete every column to the right.
  const sel = grid.getSelection()
  const colSpan = sel && (sel.mode === 'col' || sel.mode === 'cell')
  const within = colSpan && contextMenu.targetCol >= sel.c0 && contextMenu.targetCol <= sel.c1
  const start = within ? sel.c0 : contextMenu.targetCol
  const count = within ? sel.c1 - sel.c0 + 1 : 1
  _structural('col', deleteMap(start, count), {
    type: 'deleteColumns',
    payload: { col: start + 1, count },
  })
}

// Move a column block so its new start sits before column `toCol` (an index in
// the pre-move space, the drop target). No-op when dropped inside its own span.
function doMoveCol(fromCol, toCol, count = 1) {
  contextMenu.open = false
  if (toCol >= fromCol && toCol <= fromCol + count) return
  const dest = toCol <= fromCol ? toCol : toCol - count
  const delta = dest - fromCol
  _structural(
    'col',
    moveMap(fromCol, toCol, count),
    { type: 'moveColumns', payload: { col: fromCol + 1, count, delta } },
    { type: 'moveColumns', payload: { col: dest + 1, count, delta: -delta } },
  )
  // Keep the moved column(s) selected at their new home (Google behaviour), so
  // the header highlight and the status-bar summary track the data that moved.
  grid.setSelection({
    r0: 0,
    c0: dest,
    r1: 1e7,
    c1: dest + count - 1,
    mode: 'col',
  })
}

// Menu / palette: nudge the targeted column one position. Left drops it before
// its left neighbour; right drops it after its right neighbour (toCol is a
// pre-move "insert before" index, so right is targetCol + 2).
function doMoveColLeft() {
  const c = contextMenu.targetCol
  if (c > 0) doMoveCol(c, c - 1, 1)
}
function doMoveColRight() {
  const c = contextMenu.targetCol
  doMoveCol(c, c + 2, 1)
}
function doAutoFitCol() {
  contextMenu.open = false
  grid?.autoFitCol(contextMenu.targetCol)
  history.push()
  isDirty.value = true
}
function doAutoFitRow() {
  contextMenu.open = false
  grid?.autoFitRow(contextMenu.targetRow)
  history.push()
  isDirty.value = true
}

// ── Borders ───────────────────────────────────────────────────────────────────

function applyBorder(preset) {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  const sheetName = currentSheet.value
  const b = {
    style: borderStyle.value,
    color: borderColor.value,
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const id = colLabel(c) + (r + 1)
      const isTop = r === r0,
        isBottom = r === r1
      const isLeft = c === c0,
        isRight = c === c1
      let upd = {}
      if (preset === 'none') {
        upd = {
          borderTop: null,
          borderBottom: null,
          borderLeft: null,
          borderRight: null,
        }
      } else if (preset === 'all') {
        upd = {
          borderTop: b,
          borderBottom: b,
          borderLeft: b,
          borderRight: b,
        }
      } else if (preset === 'outside') {
        if (isTop) upd.borderTop = b
        if (isBottom) upd.borderBottom = b
        if (isLeft) upd.borderLeft = b
        if (isRight) upd.borderRight = b
      } else if (preset === 'inner') {
        if (!isTop) upd.borderTop = b
        if (!isBottom) upd.borderBottom = b
        if (!isLeft) upd.borderLeft = b
        if (!isRight) upd.borderRight = b
      } else if (preset === 'top') {
        upd.borderTop = b
      } else if (preset === 'bottom') {
        upd.borderBottom = b
      } else if (preset === 'left') {
        upd.borderLeft = b
      } else if (preset === 'right') {
        upd.borderRight = b
      }
      if (Object.keys(upd).length) formats.applyToRange([id], upd, sheetName)
    }
  }
  markEdited()
  grid.render()
}

// ── Merge ─────────────────────────────────────────────────────────────────────

function toggleMerge() {
  if (!grid) return
  const sn = currentSheet.value
  const { r0, c0, r1, c1 } = grid.getSelection()
  // Resolve the anchor cell to its master — clicking inside the merged
  // region (slave or master) should target the existing merge so the
  // user can unmerge by single-clicking and hitting the toolbar button.
  const anchor = colLabel(c0) + (r0 + 1)
  const masterId = merge.resolveId(anchor, sn)
  const wasMaster = merge.isMaster(masterId, sn)
  const beforeMerge = merge.snapshot()
  if (wasMaster) {
    // Always allow unmerge, even on a 1×1 selection. Use the master's
    // actual span rather than the user's selection — the selection is
    // often just the master cell coords and would miss the slaves.
    const info = merge.getMasterInfo(masterId, sn)
    merge.unmerge(info.r, info.c, info.r + info.rowSpan - 1, info.c + info.colSpan - 1, sn)
  } else {
    if (r0 === r1 && c0 === c1) return // nothing to merge in a single cell
    merge.merge(r0, c0, r1, c1, sn)
  }
  const afterMerge = merge.snapshot()
  // No structural change (rare — defensive) — skip the history entry.
  if (JSON.stringify(beforeMerge) === JSON.stringify(afterMerge)) {
    grid.render()
    return
  }
  // Route through op-based history so undo restores the exact previous
  // merge map. The merge engine's snapshot/restore round-trip is what
  // revertOp/applyOp call when an op carries beforeMerge/afterMerge.
  // Cell values aren't affected (merge.merge doesn't clobber them), so
  // before/after for cell values are intentionally empty maps.
  const op = {
    opType: wasMaster ? 'unmerge' : 'merge',
    subSheet: sn,
    cellRefs: [],
    before: {},
    after: {},
    beforeMerge,
    afterMerge,
    summary: wasMaster ? 'Unmerged cells' : 'Merged cells',
  }
  history.pushOp(op)
  syncFlags()
  isDirty.value = true
  grid.render()
}

// ── Freeze ────────────────────────────────────────────────────────────────────

function doFreezeRow() {
  contextMenu.open = false
  freezeRows.value = contextMenu.targetRow + 1
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push()
  isDirty.value = true
}
function doFreezeCol() {
  contextMenu.open = false
  freezeCols.value = contextMenu.targetCol + 1
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push()
  isDirty.value = true
}
function doUnfreezeRows() {
  contextMenu.open = false
  freezeRows.value = 0
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push()
  isDirty.value = true
}
function doUnfreezeCols() {
  contextMenu.open = false
  freezeCols.value = 0
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push()
  isDirty.value = true
}

// ── Hide / unhide rows & cols ─────────────────────────────────────────────────

// Manual hides kept in reactive state so the context menu can conditionally
// render "Unhide all". Filter hides live in sortFilter; we merge both when
// pushing to the canvas via _applyHiddenRows().
const manualHiddenRows = reactive(new Set())
const manualHiddenCols = reactive(new Set())
// Re-reads the filter range's values, then repaints the hidden rows.
function _applyHiddenRows() {
  const sn = currentSheet.value
  sortFilter
    .refresh(sn)
    .then(() => {
      if (currentSheet.value === sn) _paintHiddenRows()
    })
    .catch((e) => console.error('[sheets] filter refresh failed', e))
}
function _paintHiddenRows() {
  const filterHidden = sortFilter.computeHiddenRows(currentSheet.value)
  const union = new Set([...filterHidden, ...manualHiddenRows])
  grid?.setHiddenRows(union)
  // Tag the filter subset so grid-painter can render those gaps with the
  // regular gridline color instead of the bold "rows hidden here" stroke.
  grid?.setFilterHiddenRows(filterHidden)
  // The filter state just changed (panel, sort, undo, sheet switch, or a
  // slicer) — refresh any open slicer's checklist so both controls agree.
  slicerVersion.value++
}
function _applyHiddenCols() {
  grid?.setHiddenCols(new Set(manualHiddenCols))
}
function doHideRows() {
  contextMenu.open = false
  if (!grid) return
  const { r0, r1 } = grid.getSelection()
  for (let r = r0; r <= r1; r++) manualHiddenRows.add(r)
  _applyHiddenRows()
  history.push()
  isDirty.value = true
}
function doHideCols() {
  contextMenu.open = false
  if (!grid) return
  const { c0, c1 } = grid.getSelection()
  for (let c = c0; c <= c1; c++) manualHiddenCols.add(c)
  _applyHiddenCols()
  history.push()
  isDirty.value = true
}
function doUnhideAllRows() {
  contextMenu.open = false
  manualHiddenRows.clear()
  _applyHiddenRows()
  history.push()
  isDirty.value = true
}
function doUnhideAllCols() {
  contextMenu.open = false
  manualHiddenCols.clear()
  _applyHiddenCols()
  history.push()
  isDirty.value = true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns { before, after, refs } for cells whose value actually changed.
// Separating diff from mutation keeps onBatchCommit readable and testable.
function diffCells(cells, getCell) {
  const before = {},
    after = {}
  for (const { id, value } of cells) {
    const previous = getCell(id)
    if (previous !== value) {
      before[id] = previous
      after[id] = value
    }
  }
  return {
    before,
    after,
    refs: Object.keys(after),
  }
}

// Snapshot the undo history, sync undo/redo button state, and flag the doc dirty.
// Called after every user mutation that should be undoable and trigger auto-save.
function markEdited() {
  history.push()
  syncFlags()
  isDirty.value = true
}

// pushEditOp is the diff-and-record helper for cell-edit paths
// (formula bar, Ctrl+D / Ctrl+R, cut, dropdown pick). Lives in
// ./useEditOps.js so the contract is unit-testable in isolation;
// see that file for the rationale on op-based vs snapshot history.
const { pushEditOp: _pushEditOp } = useEditOps({
  currentSheet,
  history,
  queueOp: _queueOp,
  broadcastBatchChange: (sn, cells) => broadcastBatchChange(sn, cells),
  syncFlags,
  isDirty,
  refitRowsFor: _refitRowsFor,
})

// ── Repopulate ────────────────────────────────────────────────────────────────

// Display string for a single cell — the formatted value the canvas paints.
// Single source of truth shared by the eager repopulate (below), the per-cell
// onCellChanged repaint, and the lazy render path (grid `getDisplay`), so all
// three render identical pixels. showFormulas mode paints raw formula text.
function _cellDisplay(id) {
  // The fresh input, or the last one painted while it is re-read (asking
  // for it is what queues the read), so the mode doesn't flash blank.
  if (showFormulas.value) return _inputAt(id) ?? _paintedInput(id) ?? ''
  // A sparkline paints a chart, not IronCalc's #NAME?.
  if (parseSparkline(_paintedInput(id))) return ''
  const sn = currentSheet.value
  const fmt = formats.get(id, sn)
  const dv = _displayValue(id, sn)
  return fmt.numberFormat ? applyNumberFmt(dv, fmt.numberFormat) : dv
}

// ── IronCalc ─────────────────────────────────────────────────────────────────
// The workbook itself is in useWorkbook.js. What follows reacts to it: the
// formula bar, the grid's extent and sparklines.

// After every applied edit.
function _onEngineVersion() {
  // Range rules (colour scales, data bars) cache min/max, and charts
  // cache their source matrix: both are stale after any edit.
  condFormat?.invalidate()
  chartDataVersion.value++
  _refreshUsedCells()
  computeSelectionStats() // the selected cells' values may have changed
  _refreshFormulaBar() // an import, pivot or undo may have changed the active cell
  // Edits change the values a filter's lists show.
  const sn = currentSheet.value
  if (!sortFilter.hasFilter(sn)) return
  sortFilter
    .refresh(sn)
    .then(() => slicerVersion.value++)
    .catch(() => {}) // the next filter action reads again
}

// Shows a cell's input in the formula bar. A cell off screen (a jump to a far
// cell) takes one round trip to the worker.
function _showInputInFormulaBar(id, sn = currentSheet.value) {
  const known = _inputAt(id, sn)
  if (known !== undefined) {
    formulaValue.value = known
    return
  }
  formulaValue.value = ''
  const p = parseCellId(id)
  if (!p || !_client()) return
  _client()
    .readCells({ sheet: sn, cells: [{ row: p.row + 1, col: p.col + 1 }], what: ['input'] })
    .then(({ cells }) => {
      // Still the active cell, and nobody has started typing into it.
      if (activeCell.value === id && currentSheet.value === sn && !_typedCell) {
        formulaValue.value = cells[0]?.input ?? ''
      }
    })
    .catch((e) => {
      // Stopping the engine (leaving the page) rejects reads still in flight.
      if (_client()) console.error('[sheets] readCells failed', e)
    })
}

// Re-reads the active cell's input after an edit that may have written it
// (an import, a pivot, an undo). The bar changes only when the read lands, so
// it never blanks in between, and never while someone is typing.
function _refreshFormulaBar() {
  const id = activeCell.value
  const sn = currentSheet.value
  const p = parseCellId(id)
  if (!p || !_client() || _typedCell) return
  _client()
    .readCells({ sheet: sn, cells: [{ row: p.row + 1, col: p.col + 1 }], what: ['input'] })
    .then(({ cells }) => {
      if (activeCell.value === id && currentSheet.value === sn && !_typedCell) {
        formulaValue.value = cells[0]?.input ?? ''
      }
    })
    .catch(() => {}) // the next selection change shows it
}

// Grow the grid's scrollable area to cover a sheet's used extent so the user
// can scroll to their data. Shared by the eager and lazy repopulate paths.
function _expandGridTo(maxCol, maxRow) {
  const neededCols = maxCol + 1
  const neededRows = maxRow + 1
  if (grid.getTotalCols && grid.expandCols && neededCols > grid.getTotalCols())
    grid.expandCols(neededCols - grid.getTotalCols())
  if (grid.getTotalRows && grid.expandRows && neededRows > grid.getTotalRows())
    grid.expandRows(neededRows - grid.getTotalRows())
}

// Repaints the grid and re-reads where the data is. The grid pulls each
// visible cell's display on demand (lazy values), so nothing is copied in.
function _repopulateGrid() {
  if (!grid) return
  grid.render?.()
  _refreshUsedCells()
}

// =SPARKLINE(...) cells: IronCalc has no such function (the cell computes to
// #NAME?), so the editor reads the range itself and hands the painter the
// spec. One read per cell per data version; the grid repaints when it lands.
const _sparks = new Map() // 'sheet\0id' → { key, spec, reading }
function _sparklineAt(id) {
  const sn = currentSheet.value
  const input = _paintedInput(id, sn)
  const ref = parseSparkline(input)
  if (!ref || !_client()) return null
  const key = `${input}\0${_client().getVersion()}`
  const hit = _sparks.get(`${sn}\0${id}`)
  if (hit && (hit.key === key || hit.reading)) return hit.spec
  const entry = { key, spec: hit?.spec ?? null, reading: true }
  _sparks.set(`${sn}\0${id}`, entry)
  _readRect(ref.sheet ?? sn, ref)
    .then(({ displays }) => {
      entry.spec = sparkSpec(displays.flat(), ref.type, ref.color)
      grid?.render?.()
    })
    .catch((e) => console.error('[sheets] sparkline read failed', e))
    .finally(() => {
      entry.reading = false
    })
  return entry.spec
}
function toggleShowFormulas() {
  showFormulas.value = !showFormulas.value
  _repopulateGrid()
}
</script>

<style scoped src="./SheetEditor.css"></style>

<!-- Unscoped rules for menus and popovers frappe-ui teleports to <body>. -->
<style src="./SheetEditor.global.css"></style>
